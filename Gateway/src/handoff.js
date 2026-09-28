// Long answers (D-127): the Watch speaks a one-line gist and offers the rest;
// the full answer lands on the owner's iPhone (PROTOCOL_V1 §18). If the owner
// says "say it all", the Watch reads it. Provider-agnostic: any provider can
// set `needsDetail` and implement `detail()` (the brain does, D-127).

/**
 * Spoken after the gist on the Watch. The owner's idea ("you might wanna check your phone for this… or would you
 * like me to say it all?"), kept short: gist + offer must stay one quick Mac synthesis (~2.5 s Watch wait, D-121).
 */
export const OFFER = "That one's long. Check your phone, or should I say it all?";
export const PHONE_OK = "Okay. It's on your phone.";
export const PHONE_SOON = "Okay. I'll put it on your phone.";
export const STILL_WRITING = "It's still coming. I'll put it on your phone.";
export const DETAIL_FAILED = "I couldn't write the rest. Try asking again.";

export const HANDOFF_LIMITS = Object.freeze({
  followUpMs: 3 * 60 * 1000,   // how long "say it all" refers to the last long answer
  detailTimeoutMs: 120_000,    // a full answer on the owner's 16 GB Mac can take a while
  maxDetailChars: 1500,
});

// Answers to the offer. Short, whole-utterance matches only: anything else is a new question.
const READ_ALL = /^(?:ok(?:ay)?[, ]+)?(?:yes|yeah|yep|sure|please|go ahead|go on|say it(?: all)?|read it(?: all| to me| out)?|tell me(?: all| everything| the rest)?|all of it|the whole thing|say everything|read everything|say it here|here)(?:[, ]+please)?[.!]?$/i;
const USE_PHONE = /^(?:ok(?:ay)?[, ]+)?(?:no(?: thanks| thank you)?|nope|phone|(?:on )?(?:my|the) phone|check (?:my|the) phone|i'?ll (?:check|read) (?:it|my phone|the phone)(?: later)?|later|not now|send it to (?:my|the) phone|put it on (?:my|the) phone)[.!]?$/i;

/** @returns {'read_all' | 'phone' | null} */
export function classifyFollowUp(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (READ_ALL.test(t)) return 'read_all';
  if (USE_PHONE.test(t)) return 'phone';
  return null;
}

/** The spoken form of a full answer: markdown and list markers become plain speech. */
export function detailToSpeech(detail) {
  return String(detail ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/gm, (_, item) => (/[.!?]$/.test(item.trim()) ? item.trim() : `${item.trim()}.`))
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Light clean-up for the phone: keep markdown, drop emoji and runaway length. */
export function cleanDetail(raw, maxChars = HANDOFF_LIMITS.maxDetailChars) {
  let s = String(raw ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\r/g, '').trim();
  s = s.replace(/\n{3,}/g, '\n\n');
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return `${(at > maxChars * 0.6 ? cut.slice(0, at + 1) : cut).trim()}…`;
}
