// Memory persistence with de-duplication and supersession.

const words = (s) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter((w) => w.length > 2));
function jaccard(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Stores an accepted candidate. Returns { action, id, previousId? } where action is
 * 'stored' | 'reinforced' (same fact again) | 'superseded' (same key, new value).
 */
export function upsertMemory(db, c, now) {
  if (c.key) {
    const existing = db.prepare('SELECT * FROM memories WHERE key = ? AND superseded_by IS NULL').get(c.key);
    if (existing) {
      if ((existing.value ?? '').toLowerCase() === (c.value ?? '').toLowerCase()) {
        db.prepare('UPDATE memories SET strength = strength + 1, updated_at = ?, confidence = MAX(confidence, ?) WHERE id = ?')
          .run(now, c.confidence, existing.id);
        return { action: 'reinforced', id: existing.id };
      }
      const id = insert(db, c, now);
      db.prepare('UPDATE memories SET superseded_by = ?, updated_at = ? WHERE id = ?').run(id, now, existing.id);
      return { action: 'superseded', id, previousId: existing.id };
    }
  } else {
    const active = db.prepare('SELECT id, text FROM memories WHERE superseded_by IS NULL AND type = ?').all(c.type);
    const dup = active.find((m) => jaccard(m.text, c.text) >= 0.8);
    if (dup) {
      db.prepare('UPDATE memories SET strength = strength + 1, updated_at = ? WHERE id = ?').run(now, dup.id);
      return { action: 'reinforced', id: dup.id };
    }
  }
  return { action: 'stored', id: insert(db, c, now) };
}

function insert(db, c, now) {
  const r = db.prepare(`INSERT INTO memories (type, key, subject, relation, value, text, confidence, importance, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.type, c.key ?? null, c.subject ?? null, c.relation ?? null, c.value ?? null, c.text, c.confidence, c.importance,
      c.source ?? 'rule', now, now);
  return Number(r.lastInsertRowid);
}

export function listMemories(db, { includeSuperseded = false } = {}) {
  return db.prepare(`SELECT id, type, key, subject, relation, value, text, confidence, importance, strength, source,
      created_at, updated_at, last_used_at, superseded_by FROM memories
      ${includeSuperseded ? '' : 'WHERE superseded_by IS NULL'} ORDER BY updated_at DESC`).all();
}

export function deleteMemory(db, id) {
  db.prepare('UPDATE memories SET superseded_by = NULL WHERE superseded_by = ?').run(id);
  return db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
}
