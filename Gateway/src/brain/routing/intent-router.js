// Cheap, deterministic classification before any model is involved.
// English-only patterns for milestone 1; the model handles everything else.

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).replace(/[^\p{L}\p{N}' ]/gu, ' ').split(' ').filter(Boolean);   // keeps accents: Lucía

const GRATITUDE = /^(ok(ay)?[, ]+)?(thanks|thank you|thank u|thx|ty|cheers|ta)\b[\w ,!.']{0,24}$/;
const AFFIRMATION = /^(ok(ay)?|cool|nice|got it|alright|all right|sure|yep|yeah|yes|great|perfect|good|fine|noted|mhm|mm+)[.! ]*$/;
const GREETING = /^(hi|hey|hello|hiya|yo|morning|good (morning|afternoon|evening|night))\b[\w ,!.']{0,20}$/;
const FORGET = /\b(forget|erase|delete|remove)\b.*\b(that|this|what i (said|told you)|about|memory|memories)\b/;
const NO_STORE = /\b(don'?t|do not|never) (remember|save|store|keep)\b|\boff the record\b/;
const TOOL = /^(please |can you |could you |tamago,? )?(restart|reboot|start|stop|turn (on|off)|turn \w+ (back )?(on|off)|shut down|open|close|launch|kill|run|delete|install|update)\b/;
const QUESTION_START = /^(who|what|when|where|why|how|which|whose|is|are|was|were|do|does|did|can|could|will|would|should|have|has)\b/;
const COMPLEX = /^(why|how|explain|compare|what if|should i|help me (understand|decide))\b/;
const SMALL_TALK = /^how('?s| is| are| r| have| do)\b.*\b(you|u|it going|things)\b/;   // "How are you?" isn't complex
// Live information Tamago can't see yet (Brain E): weather, news, whether something is running.
const LIVE = /\b(weather|forecast|news|headlines|traffic)\b|\b(is|are)\b.*\b(running|online|offline|down|up|working|reachable)( right)?( now)?[?.!]*$/;
const PRONOUN = /\b(it|that|they|them)\b/;
// D-128: things Tamago's hands can do on the Mac (docs/TAMAGO_HANDS.md). Checked before questions, so
// "what's using my memory?" is a command for the hands, not small talk.
const HANDS = new RegExp([
  String.raw`^(please |can you |could you |tamago,? |hey tamago,? )*(open|launch|start|quit|close|find|search for|lock|mute|unmute|run|show me)\b`,
  String.raw`\b(volume|louder|quieter|turn (it|the (volume|sound)) (up|down))\b`,
  String.raw`\b(what'?s|what is|what are) (using|eating|hogging) (my |the )?(memory|ram|cpu)\b`,
  String.raw`\bhow much (memory|ram|space|storage|disk)\b`,
  String.raw`\b(what|which) apps? (are|is) (open|running)\b`,
  String.raw`\b(game mode|my shortcuts?|shortcut called)\b`,
  String.raw`\b(battery|plugged in)\b`,
  // D-129: the helpers ("tell Claude to…", "what's Codex doing?", "how much Claude is left?")
  String.raw`\b(claude|clawed|codex|code x|chat ?gpt)\b`,
  // Building or changing software is helper work ("can you build me a game that runs in the terminal").
  String.raw`\b(build|make|create|write|code|program|develop|fix|debug|refactor)\b.{0,40}\b(app|apps|game|script|website|site|program|tool|bot|code|function|feature|bug|cli|terminal|extension|plugin|api|server)\b`,
].join('|'));
// The clock is known locally: answered exactly by rule, never guessed by a model ("06:08" at 07:08, 2026-09-27).
const TIME = /^(so |hey |tamago,? )?(what('?s| is) the time|what time (of day )?is it|do you (know|have) the time|what'?s the time)\b/;

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
    complexity: (COMPLEX.test(t) && !SMALL_TALK.test(t)) || t.length > 90 ? 'complex' : 'simple',
  };
  if (GRATITUDE.test(t) && wordCount <= 5) return { ...base, kind: 'gratitude' };
  if (AFFIRMATION.test(t)) return { ...base, kind: 'affirmation' };
  if (GREETING.test(t) && wordCount <= 4) return { ...base, kind: 'greeting' };
  if (FORGET.test(t)) return { ...base, kind: 'forget' };
  if (HANDS.test(t) && !/\bgame mode\b.*\?$/.test(t)) return { ...base, kind: 'hands' };
  if (TIME.test(t)) return { ...base, kind: 'time' };
  if (TOOL.test(t) && !isQuestion) return { ...base, kind: 'tool_request' };
  if (isQuestion && LIVE.test(t) && !/\byou\b/.test(t)) return { ...base, kind: 'live_info' };
  if (isQuestion) return { ...base, kind: /\b(my|i|me|mine)\b/.test(t) ? 'recall' : 'question' };
  return { ...base, kind: 'statement' };
}

const STOP = new Set(('a an the and or but so to of in on at for with by from is are was were be been am do does did ' +
  'i me my mine you your it its this that these those there here what where when who why how which can could ' +
  'would should will shall just now still again please tamago hey hi okay ok yes no not really very').split(' '));

export function keywords(text) {
  return [...new Set(words(text).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8);
}
