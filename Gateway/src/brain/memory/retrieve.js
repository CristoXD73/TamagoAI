// Retrieval: a handful of relevant memories, never the whole database.
// FTS5 (porter stemming) + importance/strength/recency. Embeddings only if
// retrieval quality ever demands them.

const DAY = 86_400_000;

export function retrieveMemories(db, { keywords = [], limit = 5, now = Date.now() } = {}) {
  const picked = new Map();
  if (keywords.length) {
    const q = keywords.map((k) => `"${k.replace(/"/g, '')}"`).join(' OR ');
    const rows = db.prepare(`SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts
        JOIN memories m ON m.id = memories_fts.rowid
        WHERE memories_fts MATCH ? AND m.superseded_by IS NULL ORDER BY rank LIMIT 20`).all(q);
    for (const r of rows) {
      const recency = Math.exp(-(now - r.updated_at) / (30 * DAY));
      r.score = -r.rank * 10 + r.importance + 0.1 * Math.min(r.strength, 5) + 0.3 * recency;
      r.matched = true;
      picked.set(r.id, r);
    }
  }
  // Style preferences shape every reply, so the strongest few always come along.
  for (const r of db.prepare(`SELECT *, 0 AS rank FROM memories WHERE type = 'preference' AND superseded_by IS NULL
      ORDER BY importance DESC, strength DESC LIMIT 2`).all()) {
    if (!picked.has(r.id)) picked.set(r.id, { ...r, score: r.importance });
  }
  const out = [...picked.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  const touch = db.prepare('UPDATE memories SET last_used_at = ? WHERE id = ?');
  for (const r of out) touch.run(now, r.id);
  return out.map(({ id, type, text, subject, relation, value, score, matched }) => ({ id, type, text, subject, relation, value, score, matched: !!matched }));
}

/** The strongest facts Tamago holds, for "what do you know about me?" (preferences excluded). */
export function topMemories(db, { limit = 3 } = {}) {
  return db.prepare(`SELECT id, type, text, subject, relation, value, importance AS score FROM memories
      WHERE superseded_by IS NULL AND type != 'preference' ORDER BY importance DESC, strength DESC, updated_at DESC LIMIT ?`)
    .all(limit).map((m) => ({ ...m, matched: true }));
}

export function forgetMatching(db, keywords) {
  if (!keywords.length) return [];
  const q = keywords.map((k) => `"${k.replace(/"/g, '')}"`).join(' OR ');
  const rows = db.prepare(`SELECT m.id, m.text FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
      WHERE memories_fts MATCH ? AND m.superseded_by IS NULL`).all(q);
  const del = db.prepare('DELETE FROM memories WHERE id = ? OR superseded_by = ?');
  for (const r of rows) del.run(r.id, r.id);
  return rows;
}
