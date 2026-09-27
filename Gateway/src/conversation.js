// The conversation the owner's iPhone shows (PROTOCOL_V1 §18, D-127): every
// exchange with Tamago, from the Watch or the phone, including the full text of
// long answers that are too long to speak on the Watch.
//
// Privacy: this holds the owner's words, like the live dashboard (D-123). It is
// memory only (a restart clears it), bounded (MAX_TURNS, MAX_AGE_MS), served only
// behind the bearer token, never logged, and the owner can clear it from the phone.

export const CONVERSATION_LIMITS = Object.freeze({ maxTurns: 200, maxAgeMs: 24 * 60 * 60 * 1000, pageSize: 100 });

const DEVICES = new Set(['watch', 'phone']);

/**
 * @param {{ now?: () => number, maxTurns?: number, maxAgeMs?: number }} [opts]
 */
export function createConversation({ now = Date.now, maxTurns = CONVERSATION_LIMITS.maxTurns,
  maxAgeMs = CONVERSATION_LIMITS.maxAgeMs } = {}) {
  /** @type {Array<object>} oldest first */
  let turns = [];
  let seq = 0;

  function prune() {
    const cutoff = now() - maxAgeMs;
    turns = turns.filter((t) => t.at >= cutoff);
    if (turns.length > maxTurns) turns = turns.slice(turns.length - maxTurns);
  }

  return {
    /**
     * Records one exchange and returns its sequence number (monotonic; the phone
     * pages with `after`). `said` is what the Watch spoke; `reply` is the full text.
     */
    add({ requestId, from, heard, reply, said, long = null, error = null, note = null, about = null }) {
      prune();
      seq += 1;
      const at = now();
      turns.push({
        seq, requestId, at, updatedAt: at,
        from: DEVICES.has(from) ? from : 'watch',
        you: String(heard ?? ''),
        tamago: String(reply ?? ''),
        said: String(said ?? ''),
        long,
        error,
        note,     // 'read_aloud' | 'phone': the owner's answer to a long-answer offer (D-127)
        about,    // the seq of the long answer a note refers to
      });
      return seq;
    },
    /** A long answer finished (or failed): the turn changes, and phones that paged past it see it again. */
    update(turnSeq, patch) {
      const t = turns.find((x) => x.seq === turnSeq);
      if (!t) return false;
      Object.assign(t, patch, { updatedAt: now() });
      // Moving the turn to a new sequence number lets `after` pick up the change.
      seq += 1;
      t.rev = seq;
      return true;
    },
    /**
     * Turns created or changed after `after` (a sequence number), oldest first.
     * `latest` is the value to pass as `after` next time.
     */
    page(after = 0) {
      prune();
      const changed = turns.filter((t) => (t.rev ?? t.seq) > after);
      return { turns: changed.slice(-CONVERSATION_LIMITS.pageSize).map(publicTurn), latest: seq };
    },
    clear() {
      turns = [];
      return seq;
    },
    get size() {
      return turns.length;
    },
  };
}

function publicTurn(t) {
  return {
    seq: t.seq,
    rev: t.rev ?? t.seq,
    requestId: t.requestId,
    at: new Date(t.at).toISOString(),
    from: t.from,
    you: t.you,
    tamago: t.tamago,
    said: t.said,
    ...(t.long ? { long: t.long } : {}),
    ...(t.error ? { error: t.error } : {}),
    ...(t.note ? { note: t.note, about: t.about } : {}),
  };
}
