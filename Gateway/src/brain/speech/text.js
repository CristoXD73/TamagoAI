// Plain-text helpers shared by the speech composer and the relay (live test 2026-10-01: K1, K4/N5, K8, F12, F23).
//
// Sentences end only at . ! ? followed by a space or the end, so "Agar.io", "agario.py", "1.2" and "2.1.283" stay
// whole, and never after "e.g." / "i.e." / "Dr.". Markdown is removed for speech and gists, but snake_case words keep
// their underscores (say_hello, math_ops.py).

const NEVER_ENDS = /^\(?(e\.g|i\.e|mr|mrs|ms|dr|st|cf|approx|incl)\.$/i;   // "e.g. a list", "Dr. Who"
const ENDS_IF_CAPITAL = /^(etc|vs)\.$/i;                                 // "…and so on etc. The next" ends, "vs. that" doesn't

/** Sentences of a text, whitespace collapsed. */
export function splitSentences(text) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const ends = /[.!?]+["'”’)\]]*$/.test(w)
      && !NEVER_ENDS.test(w)
      && !(ENDS_IF_CAPITAL.test(w) && next && !/^\p{Lu}/u.test(next));
    if (ends) { out.push(cur.join(' ')); cur = []; }
  });
  if (cur.length) out.push(cur.join(' '));
  return out;
}

/** Markdown → plain text (code blocks dropped, links → label, emphasis and list markers removed). */
export function stripMarkdown(s) {
  return String(s ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*•+]|\d+[.)])\s+/gm, '')
    .replace(/\*+/g, '')
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '')   // _emphasis_, not snake_case
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')                      // table rules
    .replace(/[ \t]+/g, ' ');
}

/** The first whole sentences that fit in `max` characters, markdown-free (F12: never cut mid-word). */
export function gist(s, max = 200) {
  const sentences = splitSentences(stripMarkdown(s));
  let out = '';
  for (const sen of sentences) {
    const next = out ? `${out} ${sen}` : sen;
    if (next.length > max) break;
    out = next;
  }
  if (!out && sentences[0]) out = cutWords(sentences[0], max);
  return out;
}

/** One clause, for quoting the owner's words inside a sentence (K1): inner sentence ends become commas. */
export function clause(s, max = 80) {
  const parts = splitSentences(stripMarkdown(s)).map((p) => p.replace(/[.!?]+["'”’)\]]*$/, '').trim()).filter(Boolean);
  return cutWords(parts.join(', '), max);
}

/** Cut at a word boundary with an ellipsis. */
export function cutWords(s, max) {
  const t = String(s ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.4 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, '')}…`;
}

/** Ends with . ! ? (or …), adding a period when it doesn't. */
export function endSentence(s) {
  const t = String(s ?? '').trim();
  return !t || /[.!?…]["'”’)\]]*$/.test(t) ? t : `${t}.`;
}
