// Final pass before TTS: short, spoken, in character. The model's wording is a
// draft; this enforces the Watch's constraints no matter which model ran.

import { TAMAGO_PROFILE } from '../personality/profile.js';
import { splitSentences, cutWords } from './text.js';

const ASSISTANTISMS = [
  /\bas an ai\b[^.!?]*[.!?]?/gi,
  /\b(i'?m|i am) (always )?here (to help|for you|if you need)[^.!?]*[.!?]?/gi,
  /\b(let me know|feel free) if[^.!?]*[.!?]?/gi,
  /\b(great|good|excellent) question[.!,]?/gi,
  /\bhow can i (help|assist)[^.!?]*[.!?]?/gi,
  /\b(is there )?anything else[^.!?]*[.!?]?/gi,
  /\bhappy to help[.!]?/gi,
];

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

// Live test 2026-10-01 (K8): "Agar.io" was spoken as "Agar. io". Sentences now split only at . ! ? + space.
const sentences = splitSentences;

// K1: the hands' confirmation ends with this; it is never cut, whatever the request in front of it.
const CONFIRM_TAIL = /\s*Say yes to go\.?\s*$/i;
const CONFIRM = 'Say yes to go.';

/**
 * @returns {{speech: string|null, text: string|null, changed: string[]}}
 */
export function composeSpeech(raw, profile = TAMAGO_PROFILE) {
  if (raw === null || raw === undefined) return { speech: null, text: null, changed: [] };
  if (CONFIRM_TAIL.test(String(raw))) {
    const c = profile.communication;
    const body = compose(String(raw).replace(CONFIRM_TAIL, ''), {
      ...profile, communication: { ...c, maxSpeechChars: c.maxSpeechChars - CONFIRM.length - 1, maxTextChars: c.maxTextChars - CONFIRM.length - 1 },
    }, { keepLast: true });
    return { speech: body.speech ? `${body.speech} ${CONFIRM}` : CONFIRM, text: body.text ? `${body.text} ${CONFIRM}` : CONFIRM, changed: body.changed };
  }
  return compose(raw, profile);
}

/**
 * R3 (review 2026-10-01): in front of "Say yes to go." the LAST sentence is what "yes" does ("Give it to Codex?",
 * "Codex, Sandbox: …"). It is always kept (cut at a word if it alone is too long); earlier sentences fill what is
 * left, in order, and are dropped rather than pushing it out.
 */
function keepingLast(all, max) {
  const last = all.at(-1) ?? '';
  if (last.length >= max) return cutWords(last, max);
  const lead = [];
  for (const sen of all.slice(0, -1)) {
    if ([...lead, sen, last].join(' ').length > max) break;
    lead.push(sen);
  }
  return [...lead, last].join(' ');
}

function compose(raw, profile, { keepLast = false } = {}) {
  const changed = [];
  let s = String(raw);
  const before = s;
  s = s.replace(/```[\s\S]*?```/g, ' ')              // code blocks never get spoken
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')        // markdown links -> label
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[*#>]+/g, ' ')
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, ' ')   // _emphasis_, but snake_case stays on screen (F23)
    .replace(/^\s*[-•]\s+/gm, '')
    // F23: a one-line reply keeps its leading number ("3 apps are open."); only in multi-line text is "1. " a list marker.
    .replace(/^\s*\d+[.)]\s+/gm, (m) => (/\n/.test(before.trim()) ? '' : m))
    .replace(EMOJI, '');
  for (const re of ASSISTANTISMS) s = s.replace(re, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s !== before.trim()) changed.push('cleaned');
  // The model reads "Owner's X" in its context; Tamago speaks to the owner as "you".
  // Only the possessive is rewritten: "the owner likes" -> "you likes" would be worse than the prompt rule alone.
  const addressed = s.replace(/\b(the )?owner's\b/gi, (m) => (m[0] === m[0].toUpperCase() ? 'Your' : 'your'));
  if (addressed !== s) changed.push('addressed');
  s = addressed;
  // gemma4 writes whole replies in lower case ("your dog is named pixel."): sentence starts and "i" get
  // their capitals back. Names inside a sentence are left alone (R1 eval, 2026-09-27).
  const capped = s.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, lead, c) => lead + c.toUpperCase())
    .replace(/\bi(?=\s|['’]|[.,!?]|$)/g, 'I');
  if (capped !== s) changed.push('capitalized');
  s = capped;

  const text = truncate(s, profile.communication.maxTextChars);
  // Spoken only: "say_hello" is read as "say hello"; the screen keeps the underscore (F23).
  const spoken = s.replace(/(?<=[\p{L}\p{N}])_(?=[\p{L}\p{N}])/gu, ' ');
  if (keepLast) {
    const speech = keepingLast(sentences(spoken), profile.communication.maxSpeechChars);
    if (speech !== sentences(spoken).join(' ')) changed.push('shortened');
    return speech ? { speech, text: text || speech, changed } : { speech: null, text: null, changed: [...changed, 'emptied'] };
  }
  let speech = sentences(spoken).slice(0, 2).join(' ');
  if (speech.length > profile.communication.maxSpeechChars) {
    speech = sentences(spoken)[0] ?? speech;
    changed.push('shortened');
  }
  speech = truncate(speech, profile.communication.maxSpeechChars);
  if (!speech) return { speech: null, text: null, changed: [...changed, 'emptied'] };
  return { speech, text: text || speech, changed };
}

function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return at > max * 0.5 ? cut.slice(0, at + 1) : `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).trim()}…`;
}
