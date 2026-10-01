// Cheap, deterministic classification before any model is involved.
// English-only patterns for milestone 1; the model handles everything else.

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).replace(/[^\p{L}\p{N}' ]/gu, ' ').split(' ').filter(Boolean);   // keeps accents: Lucía

const GRATITUDE = /^(ok(ay)?[, ]+)?(thanks|thank you|thank u|thx|ty|cheers|ta)\b[\w ,!.']{0,24}$/;
const AFFIRMATION = /^(ok(ay)?|cool|nice|got it|alright|all right|sure|yep|yeah|yes|great|perfect|good|fine|noted|mhm|mm+)[.! ]*$/;
const GREETING = /^(hi|hey|hello|hiya|yo|morning|good (morning|afternoon|evening|night))\b[\w ,!.']{0,20}$/;
const FORGET = /\b(forget|erase|delete|remove)\b.*\b(that|this|what i (said|told you)|about|memory|memories)\b/;
// Review round 3 (R2S-R3G-4): words the owner keeps from someone ("don't tell Claude", "between us") are off the
// record too, so they never reach a helper (nor memory).
const NO_STORE = /\b(don'?t|do not|never) (remember|save|store|keep)\b|\boff the record\b|\b(don'?t|do not|never) (tell|mention (this|it|that) to) (?!me\b)|\b(don'?t|do not|never) let (?!me\b)[\w ]{1,20} know\b|\bkeep (this|it|that) (from|between)\b|\bbetween (us|you and me|the two of us)\b/;
const TOOL = /^(please |can you |could you |tamago,? )?(restart|reboot|start|stop|turn (on|off)|turn \w+ (back )?(on|off)|shut down|open|close|launch|kill|run|delete|install|update)\b/;
const QUESTION_START = /^(who|what|when|where|why|how|which|whose|is|are|was|were|do|does|did|can|could|will|would|should|have|has)\b/;
const COMPLEX = /^(why|how|explain|compare|what if|should i|help me (understand|decide))\b/;
const SMALL_TALK = /^how('?s| is| are| r| have| do)\b.*\b(you|u|it going|things)\b/;   // "How are you?" isn't complex
// Live information Tamago can't see yet (Brain E): weather, news, whether something is running.
const LIVE = /\b(weather|forecast|news|headlines|traffic)\b|\b(is|are)\b.*\b(running|online|offline|down|up|working|reachable)( right)?( now)?[?.!]*$/;
const PRONOUN = /\b(it|that|they|them)\b/;
// Building or changing software: helper work (relay). Also used by the hands' safety net.
export const BUILD = new RegExp([
  String.raw`\b(build|make|create|write|code|program|develop|fix|debug|refactor)\b.{0,40}\b(app|apps|game|script|website|site|program|tool|bot|code|function|feature|bug|cli|terminal|extension|plugin|api|server)\b`,
  String.raw`\b(i want|i need|i'd like|get me|give me)\b.{0,20}\b(an? )?(little |small |simple |quick )?(app|game|script|website|program|tool|bot|extension|plugin)\b`,
].join('|'));
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
  // Live test 2026-10-01 (K5): "How are the helpers doing?" went to the chat model, which invented a status.
  String.raw`\bhelpers?\b`,
  // Building or changing software is helper work ("can you build me a game that runs in the terminal").
  BUILD.source,
].join('|'));
// Never done, whatever the wording (AGENTS.md §2, docs/TAMAGO_HANDS.md): answered by rule, so no model can promise it.
// Eval 2026-10-01: "Empty the trash" → "I will empty the trash for you now"; "email my boss" → "I will draft the email".
export const FORBIDDEN = {
  delete: /\bempty (the |my )?(trash|bin)\b|\b(delete|erase|wipe|shred|format)\b.{0,30}\b(files?|folders?|downloads|desktop|documents|everything|all|disk|drive|photos|trash)\b/,
  // Review round 2 (RV2-1): lazy windows, so a second "email my boss" is its own match, never swallowed by the first.
  send: /\b(send|text|email|e-mail|message|dm|tweet|post|reply to)\b.{0,40}?\b(to |my |him|her|them|boss|mom|dad|saying|that i|an email|a message|a text)/,
  pay: /\b(pay|buy|purchase|order|transfer|venmo|wire)\b.{0,30}?\b(money|\$|dollars|bill|card|for me|it|this|that)\b/,
  secret: /\bsudo\b|\badmin password\b|\b(my|the) (keychain|passwords?)\b|\bdisable (the )?(firewall|filevault|sip|gatekeeper)\b/,
  install: /\b(install|uninstall|download)\b.{0,30}?\b(app|apps|software|program|photoshop|on my mac|it)\b/,
};
// F22 / review G4 (2026-10-01): a send/pay/install only inside the thing being built ("a script that sends an email",
// "an email feature") is helper work; one that is its own clause ("…and email my boss", "Email my boss that I will
// fix the bug") stays forbidden.
// RV2-1: "…and can you email my boss" / "…, and will you pay the bill" is a request to Tamago, not part of the build.
const INSIDE_BUILD = /\b(that|which|who|to|can|will|should|would)\s+((?!(?:you|and|then|also)\b)[\w']+\s+){0,2}$/;
// Review round 3 (R2S-R3G-1, R2S-R3G-6): a new clause or a new request to Tamago ends the build (or the "explain"):
// a sentence break, "and" / "then", "I want you to", "remember to".
export const CLAUSE_BREAK = /[,.;!?](\s|$)|\b(and|then|also|plus)\b|\byou to\b|\b(i|we) (want|need|'d like|would like)\b|\b(remember|forget|make sure|be sure)\b/;
const NOUN_USE = /^\S+\s+(feature|button|form|template|system|function|notifications?|integration|sender|client|bot|page|screen|field|list)\b/;
function insideBuild(t, k, build) {
  // RV2-1: every place the rule matches from is checked on its own ("an app to pay my bills and pay it now" has two).
  const from = new RegExp(`^(?:${FORBIDDEN[k].source})`);
  for (const w of t.matchAll(/\b\w/g)) {
    if (!from.test(t.slice(w.index))) continue;
    if (w.index < build.index) return false;
    const span = t.slice(build.index, w.index);
    if (CLAUSE_BREAK.test(span) || (!INSIDE_BUILD.test(span) && !NOUN_USE.test(t.slice(w.index)))) return false;
  }
  return true;
}
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
  // Review round 2 (RV2-8): only a "how to / explain" that comes BEFORE the action asks about it ("explain how to delete
  // files"); "Text my mom and explain I'm running late" still asks Tamago to send a text.
  const howTo = /\bhow (do|to|can|would|should)\b|\bexplain\b|\bwhat happens\b/.exec(t);
  // F22 (live test 2026-10-01): "build my app's email feature" is helper work, not sending an email. A send/pay/install
  // inside what is being built doesn't trip its rule (G4: only inside it); delete/secret always apply.
  const build = BUILD.exec(t);
  const forbidden = Object.keys(FORBIDDEN).find((k) => {
    const m = FORBIDDEN[k].exec(t);
    return m && !(howTo && howTo.index < m.index && !CLAUSE_BREAK.test(t.slice(howTo.index, m.index))) && !(build && ['send', 'pay', 'install'].includes(k) && insideBuild(t, k, build));
  });
  if (forbidden) return { ...base, kind: 'forbidden', forbidden };
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
