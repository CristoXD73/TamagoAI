// Rule-based memory candidate extraction from the owner's own words.
// Candidates are only proposals: memory/gate.js decides what is stored.
// A model may add more candidates (source 'llm'); those face a stricter gate.

const clean = (s) => s.replace(/[.!?,;]+$/g, '').replace(/\s+/g, ' ').trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const normPlace = (v) => clean(v).replace(/\b(this|the|my) mac( mini)?\b/i, (m) => m.replace(/mac/i, 'Mac'));

const RULES = [
  { // "my Jellyfin runs on this Mac", "my server is hosted on the NAS"
    re: /\bmy ([\w .'-]{2,40}?) (?:runs|is running|lives|is hosted|is installed|sits|is) (on|in|at) ([\w .'-]{2,40})/i,
    make: (m) => {
      const subject = clean(m[1]).toLowerCase();
      const value = normPlace(`${m[3]}`);
      return { type: 'semantic', subject, relation: 'runs_on', value, prep: m[2].toLowerCase(),
        text: `Owner's ${cap(subject)} runs ${m[2].toLowerCase()} ${value}.`, confidence: 0.92, importance: 0.75 };
    },
  },
  { re: /\b(?:my name is|call me) ([a-z][\w'-]{1,30})\b/i,
    make: (m) => ({ type: 'semantic', subject: 'owner', relation: 'name', value: cap(clean(m[1])),
      text: `Owner's name is ${cap(clean(m[1]))}.`, confidence: 0.95, importance: 0.9 }) },
  { // "always answer me briefly", "keep answers short on the Watch", "I prefer short answers"
    re: /\b(?:(?:please )?always|i prefer|i'd prefer|i like it when you|keep (?:your )?(?:answers|replies)) ([^.!?]{3,120})/i,
    make: (m, text) => {
      const clause = clean(m[1]);
      const brevity = /\b(brief|briefly|short|concise|less|fewer words)\b/i.test(text);
      return { type: 'preference', subject: 'owner', relation: brevity ? 'response_length' : 'prefers',
        value: brevity ? 'short' : clause, text: brevity ? 'Owner prefers short, direct answers.' : `Owner prefers: ${clause}.`,
        confidence: 0.9, importance: 0.8 };
    },
  },
  { re: /\bremember(?: that)? ([^?]{4,160})/i,
    make: (m) => ({ type: 'semantic', subject: null, relation: null, value: null,
      text: `${cap(clean(m[1]).replace(/\bmy\b/gi, "owner's").replace(/\bi\b/g, 'owner'))}.`, confidence: 0.95, importance: 0.7 }) },
  { // generic possessive: "my favorite color is teal"
    re: /\bmy ([\w '-]{2,40}?) (?:is|are) (?!on\b|in\b|at\b)([\w .'-]{1,60})/i,
    make: (m) => ({ type: 'semantic', subject: clean(m[1]).toLowerCase(), relation: 'is', value: clean(m[2]),
      text: `Owner's ${clean(m[1])} is ${clean(m[2])}.`, confidence: 0.85, importance: 0.6 }) },
  { re: /\bi (?:have|own) (?:a|an|two|three) ([\w .'-]{2,50})/i,
    make: (m) => ({ type: 'semantic', subject: 'owner', relation: 'has', value: clean(m[1]),
      text: `Owner has ${m[0].split(/ (?:have|own) /i)[1].replace(/[.!?]+$/, '')}.`, confidence: 0.85, importance: 0.55 }) },
];

export function extractCandidates(text, { isQuestion = false } = {}) {
  if (isQuestion) return [];
  const out = [];
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const c = rule.make(m, text);
    c.key = c.subject && c.relation ? `${c.subject}|${c.relation}` : null;
    c.source = 'rule';
    out.push(c);
    break; // one fact per utterance in milestone 1: first (most specific) rule wins
  }
  return out;
}
