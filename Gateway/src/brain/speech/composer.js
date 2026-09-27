// Final pass before TTS: short, spoken, in character. The model's wording is a
// draft; this enforces the Watch's constraints no matter which model ran.

import { TAMAGO_PROFILE } from '../personality/profile.js';

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

function sentences(s) {
  return s.match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
}

/**
 * @returns {{speech: string|null, text: string|null, changed: string[]}}
 */
export function composeSpeech(raw, profile = TAMAGO_PROFILE) {
  const changed = [];
  if (raw === null || raw === undefined) return { speech: null, text: null, changed };
  let s = String(raw);
  const before = s;
  s = s.replace(/```[\s\S]*?```/g, ' ')              // code blocks never get spoken
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')        // markdown links -> label
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[*_#>]+/g, ' ')
    .replace(/^\s*[-•\d]+[.)]?\s+/gm, '')
    .replace(EMOJI, '');
  for (const re of ASSISTANTISMS) s = s.replace(re, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s !== before.trim()) changed.push('cleaned');
  // The model reads "Owner's X" in its context; Tamago speaks to the owner as "you".
  // Only the possessive is rewritten: "the owner likes" -> "you likes" would be worse than the prompt rule alone.
  const addressed = s.replace(/\b(the )?owner's\b/gi, (m) => (m[0] === m[0].toUpperCase() ? 'Your' : 'your'));
  if (addressed !== s) changed.push('addressed');
  s = addressed;

  const text = truncate(s, profile.communication.maxTextChars);
  let speech = sentences(s).slice(0, 2).join(' ');
  if (speech.length > profile.communication.maxSpeechChars) {
    speech = sentences(s)[0] ?? speech;
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
