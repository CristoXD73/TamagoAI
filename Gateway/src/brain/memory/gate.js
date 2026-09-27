// The memory write gate. The model may *propose*; deterministic rules decide.

const PRIVATE = [
  /\b(password|passcode|passphrase|pin( code)?|api[ _-]?key|secret|token|private key|seed phrase|recovery code)\b/i,
  /\b(social security|ssn|passport number|credit card|card number|cvv|bank account|routing number)\b/i,
  /\b\d{12,19}\b/,                         // card-like / account-like numbers
  /\b[A-Za-z0-9_\-]{32,}\b/,               // long opaque strings (keys, tokens)
];

/** True when text looks like a secret. Such text is never stored anywhere, not even as a conversation turn. */
export function looksPrivate(text) {
  return PRIVATE.some((re) => re.test(text));
}

const MIN_CONFIDENCE = { rule: 0.7, llm: 0.8 };
const MIN_IMPORTANCE = { preference: 0.5, semantic: 0.55, procedural: 0.6, episodic: 0.75 };

/**
 * Decides one candidate. Returns { decision, reason } where decision is
 * 'accept' or 'discard'. Dedup/supersede happens in store.upsertMemory().
 */
export function gateCandidate(c, { noStore = false } = {}) {
  if (noStore) return { decision: 'discard', reason: 'owner asked not to remember' };
  if (looksPrivate(c.text) || (c.value && looksPrivate(c.value))) {
    return { decision: 'discard', reason: 'private/secret-like content' };
  }
  const minC = MIN_CONFIDENCE[c.source] ?? 0.8;
  if (c.confidence < minC) return { decision: 'discard', reason: `confidence ${c.confidence} < ${minC}` };
  const minI = MIN_IMPORTANCE[c.type] ?? 0.7;
  if (c.importance < minI) return { decision: 'discard', reason: `importance ${c.importance} < ${minI}` };
  if (c.text.length < 8) return { decision: 'discard', reason: 'too short to be meaningful' };
  return { decision: 'accept', reason: 'passed gate' };
}
