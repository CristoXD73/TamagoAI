// Cheap, deterministic classification before any model is involved.
// English-only patterns for milestone 1; the model handles everything else.

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).replace(/[^a-z0-9' ]/g, ' ').split(' ').filter(Boolean);

const GRATITUDE = /^(ok(ay)?[, ]+)?(thanks|thank you|thank u|thx|ty|cheers|ta)\b[\w ,!.']{0,24}$/;
const AFFIRMATION = /^(ok(ay)?|cool|nice|got it|alright|all right|sure|yep|yeah|yes|great|perfect|good|fine|noted|mhm|mm+)[.! ]*$/;
const GREETING = /^(hi|hey|hello|hiya|yo|morning|good (morning|afternoon|evening|night))\b[\w ,!.']{0,20}$/;
const FORGET = /\b(forget|erase|delete|remove)\b.*\b(that|this|what i (said|told you)|about|memory|memories)\b/;
const NO_STORE = /\b(don'?t|do not|never) (remember|save|store|keep)\b|\boff the record\b/;
const TOOL = /^(please |can you |could you |tamago,? )?(restart|reboot|start|stop|turn (on|off)|turn \w+ (back )?(on|off)|shut down|open|close|launch|kill|run|delete|install|update)\b/;
const QUESTION_START = /^(who|what|when|where|why|how|which|whose|is|are|was|were|do|does|did|can|could|will|would|should|have|has)\b/;
const COMPLEX = /^(why|how|explain|compare|what if|should i|help me (understand|decide))\b/;
const PRONOUN = /\b(it|that|they|them)\b/;

/**
 * @returns {{kind: string, complexity: 'simple'|'complex', isQuestion: boolean,
 *            noStore: boolean, usesPronoun: boolean, keywords: string[]}}
 */
export function classify(text) {
  const t = norm(text);
  const isQuestion = t.endsWith('?') || QUESTION_START.test(t);
  const wordCount = words(t).length;
  const base = {
    isQuestion,
    noStore: NO_STORE.test(t),
    usesPronoun: PRONOUN.test(t),
    keywords: keywords(t),
    complexity: COMPLEX.test(t) || t.length > 90 ? 'complex' : 'simple',
  };
  if (GRATITUDE.test(t) && wordCount <= 5) return { ...base, kind: 'gratitude' };
  if (AFFIRMATION.test(t)) return { ...base, kind: 'affirmation' };
  if (GREETING.test(t) && wordCount <= 4) return { ...base, kind: 'greeting' };
  if (FORGET.test(t)) return { ...base, kind: 'forget' };
  if (TOOL.test(t) && !isQuestion) return { ...base, kind: 'tool_request' };
  if (isQuestion) return { ...base, kind: /\b(my|i|me|mine)\b/.test(t) ? 'recall' : 'question' };
  return { ...base, kind: 'statement' };
}

const STOP = new Set(('a an the and or but so to of in on at for with by from is are was were be been am do does did ' +
  'i me my mine you your it its this that these those there here what where when who why how which can could ' +
  'would should will shall just now still again please tamago hey hi okay ok yes no not really very').split(' '));

export function keywords(text) {
  return [...new Set(words(text).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8);
}
