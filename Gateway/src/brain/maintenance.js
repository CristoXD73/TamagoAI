// Cheap housekeeping, run when a session closes. No background LLM chatter.

const DAY = 86_400_000;

export function runMaintenance(db, now, { messageRetentionDays = 7, keepTraces = 50 } = {}) {
  const cutoff = now - messageRetentionDays * DAY;
  const msgs = db.prepare('DELETE FROM messages WHERE at < ?').run(cutoff).changes;
  db.prepare('DELETE FROM sessions WHERE closed_at IS NOT NULL AND last_at < ? AND id NOT IN (SELECT DISTINCT session_id FROM messages)').run(cutoff);
  const traces = db.prepare('DELETE FROM traces WHERE id NOT IN (SELECT id FROM traces ORDER BY id DESC LIMIT ?)').run(keepTraces).changes;
  db.prepare('DELETE FROM world_events WHERE at < ?').run(now - 30 * DAY);
  return { messagesPruned: msgs, tracesPruned: traces };
}
