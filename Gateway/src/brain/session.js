// Session state: minutes-to-hours of conversation, so "it" can mean Jellyfin.
import { randomUUID } from 'node:crypto';

export const SESSION_IDLE_MS = 15 * 60 * 1000;

export function currentSession(db, now, idleMs = SESSION_IDLE_MS) {
  const s = db.prepare('SELECT * FROM sessions WHERE closed_at IS NULL ORDER BY last_at DESC LIMIT 1').get();
  if (s && now - s.last_at <= idleMs) return { session: s, started: false, closed: null };
  let closed = null;
  if (s) {
    db.prepare('UPDATE sessions SET closed_at = ? WHERE id = ?').run(s.last_at, s.id);
    closed = s;
  }
  const id = randomUUID();
  db.prepare('INSERT INTO sessions (id, started_at, last_at, turns) VALUES (?, ?, ?, 0)').run(id, now, now);
  return { session: { id, started_at: now, last_at: now, turns: 0 }, started: true, closed };
}

export function recentTurns(db, sessionId, limit = 6) {
  return db.prepare('SELECT role, text, at FROM messages WHERE session_id = ? ORDER BY at DESC, id DESC LIMIT ?')
    .all(sessionId, limit).reverse();
}

export function appendTurn(db, sessionId, now, ownerText, tamagoText, meta) {
  const ins = db.prepare('INSERT INTO messages (session_id, at, role, text, meta) VALUES (?, ?, ?, ?, ?)');
  ins.run(sessionId, now, 'owner', ownerText, null);
  ins.run(sessionId, now, 'tamago', tamagoText, JSON.stringify(meta));
  db.prepare('UPDATE sessions SET last_at = ?, turns = turns + 1 WHERE id = ?').run(now, sessionId);
}
