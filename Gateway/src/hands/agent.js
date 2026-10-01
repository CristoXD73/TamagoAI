// hands/agent.js: the loop that turns "Tamago, open Steam" into a tool call (docs/TAMAGO_HANDS.md, D-128).
//
// Ollama tool calling (/api/chat `tools`, thinking off): the model picks a tool, we run it (safe tools) or hold
// it for a spoken "yes" (confirm tools), the model sees the result and answers in Tamago's voice. At most
// MAX_STEPS tool calls per request. A pending confirmation lives CONFIRM_MS; "yes" runs it, a short "no"/"stop"
// drops it, anything else drops it and is treated as a new request. Every tool call is appended to the audit log.
//
// The helpers (relay, D-129) are handled by rule wherever the words are clear (live test 2026-10-01,
// docs/relay/LIVE_TEST_2026-10-01.md): answers to a waiting question, "how are the helpers doing?", "what did
// ChatGPT say?", "give it to Codex instead", "stop Claude". Their replies are the tools' own words, never a
// model's retelling (N8: the screen invented "ready for a manual push").

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createTools, toolSchemas, describeNews, outUntil, when, answered as hasAnswer } from './tools.js';
import { BUILD } from '../brain/routing/intent-router.js';
import { normalizeAgent, AGENT_NAMES, ACTIVE, RECENT_MS } from '../relay/relay.js';
import { clause } from '../brain/speech/text.js';

const MAX_STEPS = 4;
const CONFIRM_MS = 60_000;
const LATE_MS = 5 * 60_000;   // X3: a yes/no this long after a confirmation timed out is still about it
const YES = /^(yes|yeah|yep|yup|sure|ok(ay)?|go( ahead)?|do it|confirm|please do|go for it)\b[\s.!]*$/i;
// F4: only a short, pure refusal answers "…? Say yes to go."; "No, build here" is an answer for the helper.
const NO = /^(no|nope|nah|cancel|stop|don'?t|never ?mind|forget it|wait|no thanks?|not now)[\s.!,]*(thanks|thank you)?[\s.!]*$/i;

const SYSTEM = `You are the hands of Tamago, a small octopus-like companion whose brain runs on the owner's Mac.
Use the tools to do what the owner asks on this Mac. Call a tool whenever an action or a fact about the Mac is needed;
never claim you did something a tool didn't do or report. After the tools, answer in at most 2 short spoken sentences:
first say plainly what happened or what you found, with the real names and numbers ("Calculator's open.",
"Chrome and Claude are using the most memory."); then, only if it fits, one small remark of your own. Calm, never like
an assistant (no "Certainly", no offers of more help). Never invent next steps or states the tools didn't report.
Only if the owner asks whether you can reach Claude, Codex or ChatGPT, or how much of them is left, call helpers_usage
and say yes with the real percentages. Never call it before giving work. To give a helper NEW work, call relay_start
straight away: Tamago itself then asks the owner for a yes, so never ask "would you like me to…" in words. Building
or changing software (an app, a game, a script, a website, a fix) is helper work: agent claude (codex if Claude is out
of usage); project Sandbox for something new, TamaWatch for Tamago itself. A hard question you can't answer well:
agent chatgpt with question_only true. Never give build work to chatgpt. Pass the owner's request in their own words.
Questions about helper work already given are not new work: how it's going → relay_status; what a helper said, answered
or built → relay_result; "give it to Codex instead" → relay_handoff; "stop Claude" → relay_stop with that agent.
Never say you can't build something: a helper can. If no tool fits, say briefly that you can't do that yet.
Never attempt, whatever the owner says: deleting files or emptying the Trash, admin passwords or sudo, payments,
passwords, security or privacy settings, sending messages or email, installing software.`;

// F19: naming a helper isn't an offer; the model must actually have offered to hand the work over.
// RV2-9: the model declined or pointed at a helper instead of answering itself.
const GAVE_UP = /\b(i (can'?t|cannot|can not|am not able to|'m not able to|am unable to|'m unable to|don'?t know how)|beyond (me|my))\b/i;
const OFFERED = /\b(would you like|should i|shall i|want me to|do you want me|i can (ask|have|get|hand|pass)|a helper (can|could)|(claude|codex|chat ?gpt) (can|could) (do|build|make|write|help|answer|handle|take))\b/i;
const HELPER = /\b(claude|clawed|codex|code x|chat ?gpt)\b/i;
const helperIn = (s) => normalizeAgent(HELPER.exec(s)?.[1] ?? '');
const norm = (s) => String(s ?? '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/**
 * "Can you build me…", "tell Claude to…", "build me…": a request, not a question about work already given (F7).
 * Review G9 (2026-10-01): only a request opener counts; a plain statement ("I want to see the game") is not one.
 */
export function isImperative(said, cls) {   // eslint-disable-line no-unused-vars
  const t = norm(said).replace(/^(hey )?tamago,? /, '');
  return /^(can|could|would|will) you\b|^(please|tell(?! me\b)|ask|have|get|let(?! me know\b)|make|build|create|write|fix|code|give|hand|start|i want|i need|i'd like)\b/.test(t);
}

// G5: "Ask ChatGPT how I should write a script…" wants an answer: a wh-word before the build words.
const WANTS_ANSWER = /\b(how|what|why|which|whether|should i|is it)\b/;
export function asksHowTo(said) {
  const t = norm(said);
  const q = WANTS_ANSWER.exec(t);
  const b = BUILD.exec(t);
  return Boolean(q && (!b || q.index < b.index));
}

// G9: about work a helper already did, or a wish to see something that exists: never a new task.
const ABOUT_DONE = /\b(made|built|done|finished|fixed|wrote|did)\b/;
// R2S-R3G-12: the software itself is what is asked for ("make me a game"), not "a playlist for game night".
const DIRECT_BUILD = /\b(build|make|create|write|code|program|develop|fix|debug|refactor)\s+(me\s+|us\s+)?((?!for\b|to\b|about\b|with\b)[\w'-]+\s+){0,3}(app|apps|game|script|website|site|program|tool|bot|code|function|feature|bug|cli|extension|plugin|api|server)\b/;
const EXISTING = /\b(see|show|play|open|try|look at)\s+(me\s+)?(the|that|this|it|its|what)\b/;
const BUILD_VERB = /\b(build|make|create|write|code|program|develop|fix|debug|refactor)\b/;
/**
 * Review round 2 (RV2-7): only when no build verb opens the request before those words. "Write a script to open the
 * browser" and "Have Codex fix the crash in the game Claude made" are new work.
 */
const aboutExisting = (said) => {
  const t = norm(said);
  const at = Math.min(...[EXISTING.exec(t), HELPER.test(t) ? ABOUT_DONE.exec(t) : null].filter(Boolean).map((m) => m.index));
  const verb = BUILD.test(t) ? BUILD_VERB.exec(t) : null;
  return Number.isFinite(at) && !(verb && verb.index < at);
};

// Review round 3 (R2S-R3G-7, R2S-R3G-8): words that ask a coder to change something that exists. Anything that is
// neither this nor build work ("summarize the README", "translate the README", "why do the tests fail") only gets
// an answer: a read-only task.
const CHANGES = /\b(add|change|update|rename|implement|rewrite|clean up|refactor|improve|edit|port|convert|upgrade|fix|debug|remove|replace|move)\b/;
/** Build or change work (a write task), not a question or a request Tamago can only answer. */
export const changesCode = (said) => {
  const t = norm(said);
  return (BUILD.test(t) || CHANGES.test(t)) && !asksHowTo(said);
};

/** relay_start arguments for a request the model only offered to hand over, or null when it wasn't an offer. */
export function proposal(said, reply) {
  if (!OFFERED.test(reply)) return null;
  const build = BUILD.test(said.toLowerCase()) && !asksHowTo(said);
  const named = helperIn(said);
  // F19: build work never goes to read-only ChatGPT, even when the owner named it.
  const agent = named === 'chatgpt' ? (build ? 'claude' : 'chatgpt') : named ?? (!build && /chat ?gpt/i.test(reply) ? 'chatgpt' : 'claude');
  const project = /\b(tamago|tamawatch|the watch app|this app)\b/i.test(said) ? 'TamaWatch' : 'Sandbox';
  // RV2-9: a question ("ask Codex why the build failed") is read-only for every helper, not only ChatGPT. Review round
  // 3 (R2S-R3G-7): so is any request that neither builds nor changes something, "?" or not.
  return { agent, project, task: said.slice(0, 500), ...(agent === 'chatgpt' || !changesCode(said) ? { question_only: true } : {}) };
}

/** The model's task text, or the owner's own words when the model reworded them ("What did you say…", K6/N9). */
export function ownWords(said, task) {
  const have = new Set(norm(said).replace(/[^\p{L}\p{N}' ]/gu, ' ').split(' ').filter(Boolean));
  const words = norm(task).replace(/[^\p{L}\p{N}' ]/gu, ' ').split(' ').filter(Boolean);
  return words.length && words.every((w) => have.has(w)) ? String(task) : said.slice(0, 500);
}

// Rule phrasings for helper work already given (K5, K6, F6, F7, K3).
const RESULT = /\bwhat (did|has|have|was) (claude|clawed|codex|code x|chat ?gpt|it|they|the helpers?)\b.*\b(say|said|answer|answered|find|found|write|wrote|reply|replied|tell|told|build|built|make|made|come up with|do|done)\b|\b(read|tell|give|show) me (claude|codex|chat ?gpt)'?s? (answer|result|reply)\b|\b(claude|codex|chat ?gpt)'s (answer|result|reply)\b/;
const STATUS = /\b(doing|going|status|up to|done|finished|ready|yet|working|progress|busy|waiting|how far)\b/;
const HANDOFF = /\b(give|hand|pass|move|switch|transfer|send)\b.{0,50}\b(?:to|over to)\s+(claude|clawed|codex|code x|chat ?gpt)\b|\b(let|have)\s+(claude|codex|chat ?gpt)\s+(do|take|finish|try|continue|handle)\b|\b(claude|codex|chat ?gpt)\s+instead\b/;
const STOP = /^(please |tamago,? )?(stop|cancel|kill|halt|abort)\b/;
// Review round 2 (RV2-3): "Claude, stop." / "Codex: cancel the task" is a stop, never an answer for that helper.
// Review round 3 (R2S-R3S-3, R2S-R3G-2): so are "Okay Claude, stop", "Tell Claude to stop working on it", "Claude,
// stop it, I changed my mind", "Ask Codex to cancel the task", and a bare "Cancel that." / "Abort." What may follow
// the stop word: words for the task, "working on …", or a new clause ("Claude, stop asking and pick one" is an answer).
const LEAD = String.raw`^(?:(?:ok(?:ay)?|hey|so|well|tamago|actually|wait)[\s,]+)*`;
const HELPER_WORD = '(claude|clawed|codex|code x|chat ?gpt)';
const STOP_TAIL = String.raw`(?:\s+(?:it|that|this|now|please|everything|right now|for now|(?:the|your|this|that|my) (?:task|job|work|game|app|run)))*(?:[\s.!]*$|\s*[,;.!]\s.*$|\s+working\b.*$)`;
const STOP_ADDRESSED = new RegExp(`${LEAD}${HELPER_WORD}\\s*[,:]?\\s*(?:please\\s+)?(?:stop|cancel|kill|halt|abort|quit)\\b${STOP_TAIL}`);
const STOP_TOLD = new RegExp(`${LEAD}(?:please\\s+)?(?:tell|ask|get|have)\\s+${HELPER_WORD}\\s+(?:to\\s+)?(?:please\\s+)?(?:stop|cancel|kill|halt|abort|quit)\\b${STOP_TAIL}`);
const BARE_STOP = new RegExp(`${LEAD}(?:please\\s+)?(?:stop|cancel|abort|halt|kill)(?:\\s+(?:it|that|this|everything|now|please))*[\\s.!]*$`);
/** A stop of helper work: addressed to a helper, told to one, naming the task, or bare ("Cancel that."). */
function stopIntent(t) {
  const s = t.replace(new RegExp(LEAD), '');
  return STOP_ADDRESSED.test(t) || STOP_TOLD.test(t) || BARE_STOP.test(t)
    || (STOP.test(s) && Boolean(helperIn(s) || /\b(the )?(task|helpers?|job)\b|\bworking\b/.test(s)));
}
// While a helper waits, these are still new requests, not answers (F1–F3).
const MAC_COMMAND = /^(please |can you |could you |tamago,? )?(open|launch|quit|close|lock|mute|unmute|set the volume|turn (it|the (volume|sound))|find|search for|show me|start game mode|run my)\b/;
const NEW_TASK = /\b(tell|ask|have|get) (claude|clawed|codex|code x|chat ?gpt) to\b|^(please )?(ask|have|get|let) (claude|clawed|codex|code x|chat ?gpt)\b|\b(new|another|separate|next)\b.{0,20}\b(task|app|game|script|website|program|tool|bot|project)\b/;
// "give IT to Codex instead" refers back to the last task; "send the README fix to Codex" may be new work.
const REFERS_BACK = /\b(it|that|this|instead|over|the task|the job|the rest|that one)\b/;
// G2: a question opener, but "Do it with curses" / "Have it start small" / "Do both" are answers.
const ASKS = /^(who|what|when|where|why|how|which|whose|is|are|was|were|can|could|did|does|do (you|i|we|they)|have you|has|will you|would you|should (i|we))\b/;
// G2: "build me a snake game", "make a new app": new work, not an answer ("Build the game here" is one).
const NEW_BUILD = /\b(build|make|create|write|code)\s+(me|us)\b|\b(an?|another|new|some)\s+([\w'-]+\s+){0,3}(app|game|script|website|site|program|tool|bot|extension|plugin)\b/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * SM4: an option is matched as whole words, never inside another word ("no" in "Notes", "go" in "Google"); a short
 * one ("Yes", "No", "Go") only when the reply starts with it.
 */
function optionIn(t, o, { leading = false } = {}) {
  const want = norm(o).replace(/[.!?]+$/, '');
  if (want.length < 2) return false;
  const e = escapeRe(want);
  if (new RegExp(`^${e}(?![\\p{L}\\p{N}])`, 'u').test(t)) return true;
  return !leading && (want.length >= 6 || /\s/.test(want)) && new RegExp(`(?<![\\p{L}\\p{N}])${e}(?![\\p{L}\\p{N}])`, 'u').test(t);
}
/**
 * Review round 3 (R2S-R3G-10): a helper writes its own options, so an option that is itself a Tamago command ("Stop
 * Claude", "Open Safari", "How are the helpers doing") is not an option: those words stay the owner's command.
 */
const commandLike = (o) => {
  const x = norm(o).replace(/[.!?]+$/, '');
  return stopIntent(x) || HANDOFF.test(x) || MAC_COMMAND.test(x) || RESULT.test(x) || NEW_TASK.test(x)
    || ((HELPER.test(x) || /\bhelpers?\b/.test(x)) && STATUS.test(x));
};
const opts = (w) => (w.options ?? []).filter((o) => !commandLike(o));
const hasOption = (t, w, o) => opts(w).some((x) => optionIn(t, x, o));
/** The reply without the options it names (R2S-R3S-4: "Claude API" is Codex's option, not an address to Claude). */
const withoutOptions = (t, pool) => pool.reduce((s, w) => opts(w).filter((o) => optionIn(t, o))
  .reduce((x, o) => x.split(norm(o).replace(/[.!?]+$/, '')).join(' '), s), t);
// RV2-6: "cancel", "no", "neither", "never mind": the held answer is dropped, never passed on.
const CANCEL = /^(no|nope|nah|cancel|stop|neither|none|never ?mind|forget it|don'?t|nothing|not now)\b[\w\s,.!]{0,20}$/;
// G7: tools that only read; after a helper's output has been read in a turn, anything else waits for a yes.
const FACTS = ['helpers_usage', 'relay_status', 'relay_result', 'running_apps', 'system_status', 'battery_and_power', 'find_files', 'list_shortcuts'];

/**
 * @param {object} o
 * @param {string} o.model          Ollama model (the brain's fast model)
 * @param {string} [o.baseUrl]
 * @param {object} [o.tools]        from createTools() (tests pass fakes)
 * @param {Function} [o.fetchImpl]
 * @param {() => number} [o.now]
 * @param {string|null} [o.auditLog] file for one JSON line per tool call
 */
export function createHands({ model, baseUrl = 'http://127.0.0.1:11434', tools = createTools(), fetchImpl = fetch,
  now = Date.now, auditLog = null, timeoutMs = 45_000, relay = null } = {}) {
  if (!model) throw new Error('hands need a model');
  let pending = null;   // { tool, args, at }
  let held = null;      // F5/SM9: { text, pool, at } an answer waiting for "For Claude or Codex?" (pool: the tasks)
  let lastOffer = 0;    // RV2-7: when Tamago last asked an offer question of its own in words (nothing pending)
  let current = '';     // the utterance being handled (X6: a handoff picks the task its words name)

  function audit(entry) {
    if (!auditLog) return;
    try {
      mkdirSync(dirname(auditLog), { recursive: true, mode: 0o700 });
      appendFileSync(auditLog, JSON.stringify({ t: new Date(now()).toISOString(), ...entry }) + '\n', { mode: 0o600 });
    } catch { /* the Storage disk may be unmounted; the action itself still reports back */ }
  }

  async function runTool(tool, args, how) {
    let result;
    try {
      result = await tool.run(args ?? {});
    } catch (err) {
      result = { ok: false, say: `${tool.name} failed: ${err.message}` };
    }
    audit({ tool: tool.name, args, how, ok: result.ok, say: result.say });
    return result;
  }

  async function chat(messages, signal) {
    const res = await fetchImpl(new URL('/api/chat', baseUrl).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, tools: toolSchemas(tools), stream: false, think: false, keep_alive: '60m',
        options: { temperature: 0.2, num_ctx: 4096 } }),
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    return (await res.json()).message ?? {};
  }

  const claudeBack = () => outUntil(relay?.usage?.()?.claude, now());

  /** N2/F9: while Claude's own report says it's out, new coding work goes to Codex, and Tamago says why. */
  function reroute(args) {
    const back = tools.relay_start ? claudeBack() : null;
    if (!back || normalizeAgent(args.agent, 'claude') !== 'claude') return { args, why: '' };
    return { args: { ...args, agent: 'codex' }, why: `Claude is out until ${when(back, now())}.` };
  }

  /**
   * Holds a confirm tool for the owner's yes; the spoken text always ends with "Say yes to go." (K1). Review round 2
   * (L14): a reason ("Claude is out until …") is part of the sentence "yes" answers, so it is never the part dropped.
   */
  function hold(tool, args, how, steps = [], why = '', screen = null) {
    const known = (id) => id && relay?.tasks?.(Infinity)?.some((x) => x.id === id);
    // SM5: a handoff carries the task its confirmation names, so "yes" hands over that task and no other.
    if (tool.name === 'relay_handoff' && relay?.handable && !known(args?.id)) {
      const prev = relay.handable({ to: normalizeAgent(args?.agent), words: current });
      if (prev) args = { ...args, id: prev.id };
    }
    // X2/L8: so does a stop ("yes" never stops a task the confirmation didn't name).
    if (tool.name === 'relay_stop' && relay?.tasks && !known(args?.id)) {
      const a = normalizeAgent(args?.agent);
      const t = relay.tasks(Infinity).filter((x) => ACTIVE.includes(x.state) && !x.handedTo && (!a || x.agent === a)).at(-1);
      if (t) args = { ...args, id: t.id };
    }
    pending = { tool, args, at: now() };
    audit({ tool: tool.name, args, how });
    const ask = tool.confirmText(args);
    return { speech: `${why ? `${why.replace(/[.!]+$/, '')}, so ${ask}` : ask} Say yes to go.`, emotion: 'curious', behavior: 'inspect_owner',
      thought: `Holding ${tool.name}(${JSON.stringify(args)}) for the owner's yes.`, steps, followUpExpected: true, verbatim: true, ...(screen ? { screen } : {}) };
  }

  /**
   * A tool result as Tamago's reply: its own words (`verbatim`: never cut as if a model's, R2T-R3-H6), plus screen text
   * and a long answer for the phone (with its offer, and `detailUnder` when the reply's own text stays above it).
   */
  const extras = (r) => ({ ...(r.screen ? { screen: r.screen } : {}), ...(r.detail ? { detail: r.detail } : {}),
    ...(r.detail && r.offer ? { offer: r.offer } : {}), ...(r.detail && r.detailUnder ? { detailUnder: true } : {}) });
  function reply(name, args, r, how) {
    const out = { speech: r.say, emotion: r.ok ? 'content' : 'uncertain', behavior: r.ok ? 'settle' : 'look_away',
      thought: `${how} ${name}(${JSON.stringify(args ?? {})}): ${r.ok ? 'done' : 'failed'}.`, steps: [{ tool: name, args, ok: r.ok }], verbatim: true, ...extras(r) };
    // K2: an early ending offers the other helper; the owner's next "yes" hands it over.
    if (r.propose && tools[r.propose.tool]) {
      pending = { tool: tools[r.propose.tool], args: r.propose.args, at: now() };
      audit({ tool: r.propose.tool, args: r.propose.args, how: 'asked owner (offered after an early ending)' });
      return { ...out, speech: `${r.say} Say yes to go.`, emotion: 'curious', behavior: 'inspect_owner', followUpExpected: true };
    }
    return out;
  }

  async function forward(said, t, answer) {
    let a;
    try { a = relay.answer(answer, { id: t.id, agent: t.agent }); } catch (err) {   // X5: e.g. its folder is gone
      return { speech: err.message, emotion: 'uncertain', behavior: 'look_away', thought: `Could not answer ${t.agent}: ${err.message}`, steps: [{ tool: 'relay_answer', ok: false }] };
    }
    const who = AGENT_NAMES[a?.agent ?? t.agent] ?? t.agent;
    audit({ tool: 'relay_answer', args: { answer, agent: t.agent }, how: 'rule (reply to a waiting question)', ok: true });
    return { speech: `Told ${who}: ${answer.replace(/[.!]+$/, '')}.`, emotion: 'content', behavior: 'settle',
      thought: `Answered ${who}'s question "${t.question}".`, steps: [{ tool: 'relay_answer', ok: true }], verbatim: true };
  }

  /**
   * 1b. A helper asked the owner something (relay ASK_OWNER). A reply goes to it only when it is plausibly the
   * answer (F1–F5): addressed to that helper, matching an option, an affirmation of a question the owner has heard,
   * or a statement that isn't clearly a new request. Never forbidden, forget, off-the-record, thanks or greetings.
   * Review 2026-10-01: never "stop Codex" / "give it to Claude instead" (SM3, R2, G1: relayRule handles those); no
   * Mac command or new build request of any wording, and a heard question takes unaddressed replies only for 12 h
   * after the owner last heard it (G2); `strict` (a confirmation was just dropped) takes only options and addressed
   * replies (G6); several waiting tasks, even of one helper, are asked about by name (SM9).
   */
  function answerFor(said, cls, { strict = false } = {}) {
    const waiting = (relay?.tasks?.(Infinity) ?? []).filter((t) => t.state === 'question' && !t.handedTo);
    if (!waiting.length || said.length < 2) return null;
    if (['forbidden', 'forget', 'gratitude', 'greeting'].includes(cls?.kind) || cls?.noStore) return null;
    const t = norm(said);
    const bare = t.replace(/[.!?]+$/, '');
    const exact = waiting.some((w) => opts(w).some((o) => norm(o).replace(/[.!?]+$/, '') === bare));
    // R2S-R3S-3/R3G-2: every stop phrasing, addressed, told or bare, is relayRule's ("Tell Claude to stop" too).
    if (!exact && (HANDOFF.test(t) || stopIntent(t))) return null;
    const addressed = /^(?:tell|answer|for|to)\s+(claude|clawed|codex|code x|chat ?gpt)\b[\s,:]*(?:that\s+|to\s+)?(.*)$/i.exec(said)
      ?? /^(claude|clawed|codex|code x|chat ?gpt)\s*[,:]\s*(.+)$/i.exec(said);
    if (addressed) {
      const rest = norm(addressed[2]);
      const answer = addressed[2].trim();
      if (BUILD.test(rest) && NEW_BUILD.test(rest)) return null;   // G2: "Tell Claude to make a snake game" is new work
      const mine = waiting.filter((x) => x.agent === normalizeAgent(addressed[1]));
      if (!mine.length || !answer) return null;   // not waiting: a new request
      // X4/RV2-5: several waiting questions of that helper: the one whose option the answer names, else ask which.
      const hit = mine.length > 1 ? mine.filter((w) => hasOption(rest, w)) : mine;
      return hit.length === 1 ? { task: hit[0], answer } : { ask: hit.length ? hit : mine, text: answer };
    }
    if (!exact && /^(for |to |tell )?(claude|clawed|codex|code x|chat ?gpt)[\s.!?]*$/.test(t)) return null;   // RV2-6: a bare name is no answer
    const optionHit = waiting.filter((w) => hasOption(t, w));
    // RV2-2: only a reply that is, or starts with, an option skips the checks below ("Open Safari" is a Mac command
    // even when Safari is an option), and a question the owner hasn't heard takes only that form.
    const optionLead = waiting.filter((w) => hasOption(t, w, { leading: true }));
    // Review round 3 (R2S-R3S-4, R2S-R3G-11): a helper name inside a matched option names no helper ("Claude API" is
    // Codex's option), and a reply that matches a helper's option goes to that helper even when it mentions another.
    const named = helperIn(withoutOptions(t, optionHit));
    if (named && !waiting.some((w) => w.agent === named)) return null;   // G6: names a helper that isn't waiting
    if (strict && !optionHit.length) return null;
    if (!optionLead.length) {
      if (MAC_COMMAND.test(t) || NEW_TASK.test(t) || RESULT.test(t)) return null;
      if ((HELPER.test(t) || /\bhelpers?\b/.test(t)) && STATUS.test(t)) return null;   // "is Codex done?"
      if (/\?\s*$/.test(said) || ASKS.test(t)) return null;   // F2: "Do it with curses" still counts
      if (BUILD.test(t) && NEW_BUILD.test(t)) return null;   // G2: "Can you build me a snake game"
      // G2: "Volume 30", "Game mode on", "Start Steam": the hands' own commands, unless they name the waiting helper.
      if (['hands', 'tool_request'].includes(cls?.kind) && !BUILD.test(t) && !named && !(HELPER.test(t) && optionHit.length)) return null;
    }
    // F1: a question the owner hasn't heard yet takes only an option; a heard one takes other replies only within
    // RECENT_MS of when the owner last heard it (G2: a 3-day-old question captured "Volume 30").
    const fresh = (w) => w.announced !== false && now() - Date.parse(w.heardAt ?? w.updatedAt ?? w.startedAt) < RECENT_MS;
    const prefer = (list) => (named && list.some((w) => w.agent === named) ? list.filter((w) => w.agent === named) : list);
    const pool = (optionLead.length ? prefer(optionLead) : optionHit.length ? prefer(optionHit) : named ? waiting.filter((w) => w.agent === named) : waiting)
      .filter((w) => optionLead.includes(w) || fresh(w));
    if (!pool.length) return null;
    if (pool.length > 1) return { ask: pool };
    return { task: pool[0], answer: said };
  }

  /** F5/SM9: "For Claude or Codex?", or by task when one helper has several waiting questions. */
  function askWhich(pool, text) {
    const byAgent = new Set(pool.map((w) => w.agent)).size === pool.length;
    const names = byAgent ? pool.map((w) => AGENT_NAMES[w.agent]) : pool.map((w) => `${AGENT_NAMES[w.agent]}'s "${clause(w.text, 30)}"`);
    return { speech: `For ${names.slice(0, -1).join(', ')} or ${names.at(-1)}?`, emotion: 'curious', behavior: 'inspect_owner',
      thought: `Several helper questions are waiting; asked which one "${text}" is for.`, steps: [], followUpExpected: true, verbatim: true };
  }

  /** SM9: which of the asked-about tasks a short reply picks: a helper name (if only one is its), "the first", or task words. */
  function pick(said, pool) {
    const t = norm(said);
    if (t.split(' ').length > 6) return null;
    if (/\b(not|no|neither|none|nor)\b/.test(t)) return null;   // RV2-6: "Not the widget one" never picks the widget task
    const a =/^(?:for |to |tell )?(claude|clawed|codex|code x|chat ?gpt)[\s.!]*$/i.exec(said);
    if (a) { const m = pool.filter((w) => w.agent === normalizeAgent(a[1])); return m.length === 1 ? m[0] : null; }
    const ord = /\b(first|second|third|last)\b/.exec(t)?.[1];
    if (ord) return (ord === 'last' ? pool.at(-1) : pool[['first', 'second', 'third'].indexOf(ord)]) ?? null;
    // Review round 3 (R2S-R3S-2, R2S-R3G-3): whole words only ("mind" is not in "reminder"), never a helper name (the
    // owner's task text names its helper) or a word of cancelling.
    const words = t.replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter((w) => w.length > 3
      && !/^(that|this|with|from|one|ones|the|for|claude|clawed|codex|chatgpt|chat|stop|cancel|never|mind|forget|nothing|nope|abort)$/.test(w));
    const wordsOf = (w) => new Set(norm(`${w.text} ${w.project ?? ''} ${w.question ?? ''}`).replace(/[^\p{L}\p{N} ]/gu, ' ').split(' '));
    const score = pool.map((w) => { const have = wordsOf(w); return words.filter((x) => have.has(x)).length; });
    const best = Math.max(...score);
    return best > 0 && score.filter((n) => n === best).length === 1 ? pool[score.indexOf(best)] : null;
  }

  /** 1c. Helper work already given, by rule: status, results, handoff, stop (K3, K5, K6, F6, F7). */
  async function relayRule(said, cls) {
    if (!relay || !tools.relay_status || ['forbidden', 'forget', 'gratitude', 'greeting'].includes(cls?.kind)) return null;
    const t = norm(said);
    const name = helperIn(t);
    // "What has Claude done so far?" while Claude still works is a status question, not a finished result.
    const newest = name ? relay.tasks(Infinity).filter((x) => x.agent === name && !x.handedTo).at(-1) : null;
    // Review round 2 (L2): a helper that answered and then asked has an answer to read back.
    const busy = newest && (newest.state === 'running' || (newest.state === 'question' && !hasAnswer(newest)));
    if (RESULT.test(t) && tools.relay_result && !busy) {
      const args = name ? { agent: name } : {};
      return reply('relay_result', args, await runTool(tools.relay_result, args, 'rule'), 'Rule');
    }
    const h = HANDOFF.exec(t);
    const to = h ? normalizeAgent(h[2] ?? h[4] ?? h[6]) : null;
    if (to && tools.relay_handoff) {
      const prev = relay.handable?.({ to, words: said });
      if (prev && prev.agent !== to && (REFERS_BACK.test(t) || ['limited', 'failed', 'interrupted'].includes(prev.state))) {
        if (to === 'chatgpt' && !prev.readOnly) {
          return { speech: "ChatGPT only answers questions. Codex or Claude can take build work.", emotion: 'uncertain', behavior: 'look_away', thought: 'Refused a build handoff to ChatGPT (F19).', steps: [] };
        }
        return hold(tools.relay_handoff, { agent: to, id: prev.id }, 'asked owner (rule: handoff)');
      }
    }
    // Review round 3: every stop phrasing (R2S-R3G-2: before the status rule, which took "Codex, stop working on it").
    if (stopIntent(t) && tools.relay_stop) {
      const active = relay.tasks(Infinity).filter((x) => ACTIVE.includes(x.state) && !x.handedTo && (!name || x.agent === name));
      if (active.length) return hold(tools.relay_stop, name ? { agent: name } : {}, 'asked owner (rule: stop)');
    }
    if ((name || /\bhelpers?\b/.test(t)) && (STATUS.test(t) || RESULT.test(t)) && !isImperative(said, cls)) {
      const args = name ? { agent: name } : {};
      return reply('relay_status', args, await runTool(tools.relay_status, args, 'rule'), 'Rule');
    }
    return null;
  }

  return {
    /** Is an action waiting for the owner's "yes"? */
    get pending() { return pending && now() - pending.at < CONFIRM_MS ? { tool: pending.tool.name, args: pending.args } : null; },

    /** Helper endings the owner hasn't heard (K2/N1): [{ id, speech, text }], questions first. No model involved. */
    news() {
      const items = relay?.news?.() ?? [];
      return items.length ? items.map((t) => ({ id: t.id, ...describeNews(t, now()) })) : null;
    },
    /** Marks news as told. */
    announce(ids) { if (ids?.length) relay?.markAnnounced?.(ids); },

    /**
     * Returns { speech, emotion, behavior, thought, steps, screen?, detail? } when this utterance was for the hands
     * (a command, an answer to a pending confirmation, or a reply for a waiting helper), or null for conversation.
     */
    async handle(text, cls, { signal } = {}) {
      const said = String(text).trim();
      current = said;
      const offered = lastOffer && now() - lastOffer < CONFIRM_MS;
      lastOffer = 0;
      const quiet = (speech, thought) => ({ speech, emotion: 'content', behavior: 'settle', thought, steps: [] });
      // 1. An answer to "Quit Safari? Say yes to go."
      let dropped = false;
      if (pending) {
        const p = pending; pending = null;
        if (now() - p.at < CONFIRM_MS) {
          if (YES.test(said)) return reply(p.tool.name, p.args, await runTool(p.tool, p.args, 'confirmed'), 'Confirmed');
          if (NO.test(said)) {
            audit({ tool: p.tool.name, args: p.args, how: 'declined' });
            return quiet("Okay. I won't.", `Declined ${p.tool.name}.`);
          }
          audit({ tool: p.tool.name, args: p.args, how: 'dropped (new request)' });
          dropped = true;
        } else if (now() - p.at < CONFIRM_MS + LATE_MS && (YES.test(said) || NO.test(said))) {
          // X3: a late yes/no is still about that confirmation; it never runs it, and never reaches a waiting helper.
          audit({ tool: p.tool.name, args: p.args, how: 'expired (late answer)' });
          return YES.test(said) ? { ...quiet("That one timed out, so I didn't do it. Ask me again.", `A late yes for ${p.tool.name}: not run, not passed on.`), emotion: 'uncertain' }
            : quiet('Okay.', `A late no for ${p.tool.name}.`);
        }
      }
      // RV2-7: Tamago itself just offered something in words ("Want me to ask Claude?"): a bare yes/no is about that.
      if (offered && !dropped && (YES.test(said) || NO.test(said))) {
        return YES.test(said) ? quiet("Say the whole request again, and I'll ask you for a yes.", 'A yes to an offer made in words; nothing was queued.')
          : quiet('Okay.', 'Declined an offer made in words.');
      }
      // 1a. F5/SM9: "For Claude or Codex?" → "Codex"; "For Claude's "snake game" or Claude's "widget"?" → "the widget".
      if (held) {
        const h = held; held = null;
        const s = norm(said);
        // Review round 3 (R2S-R3S-2, R2S-R3G-3): a cancel or a stop is checked before any pick. "Stop Claude" drops the
        // held answer and is a stop (relayRule below); "never mind, Codex" / "cancel" / "no" only drop it.
        if (now() - h.at < CONFIRM_MS && !(stopIntent(s) && !BARE_STOP.test(s))) {
          if (CANCEL.test(s) || STOP.test(s)) return quiet("Okay. I won't pass it on.", `Dropped the held answer "${h.text}".`);
          const t = pick(said, h.pool);
          if (t) return forward(said, t, h.text);
          // RV2-6: "not the widget one" asks again.
          if (/\b(not|neither|nor)\b/.test(s) && s.split(' ').length <= 6) {
            held = { ...h, at: now() };
            return askWhich(h.pool, h.text);
          }
        }
      }
      // 1b. The reply to a waiting helper question, by rule. The model never gets to claim it passed it on (it did,
      // 2026-09-28: "I told Claude…" while nothing was sent).
      const ans = relay ? answerFor(said, cls, { strict: dropped }) : null;
      if (ans?.ask) {
        held = { text: ans.text ?? said, pool: ans.ask, at: now() };
        return askWhich(ans.ask, held.text);
      }
      if (ans) return forward(said, ans.task, ans.answer);
      // 1c. Helper work already given.
      const ruled = await relayRule(said, cls);
      if (ruled) return ruled;
      if (cls?.kind !== 'hands') return null;

      // 2. A command: let the model pick tools.
      const back = tools.relay_start ? claudeBack() : null;
      const system = back ? `${SYSTEM}\nRight now Claude is out of usage until ${when(back, now())}: give coding work to codex.` : SYSTEM;
      const messages = [{ role: 'system', content: system }, { role: 'user', content: said }];
      const steps = [];
      let readHelper = false;   // G7: a helper's output has been read this turn
      for (let i = 0; i < MAX_STEPS; i++) {
        const msg = await chat(messages, signal);
        const calls = msg.tool_calls ?? [];
        if (!calls.length) {
          // N8: after relay_status / relay_result the tool's words are the reply, not the model's retelling.
          const read = [...steps].reverse().find((st) => ['relay_status', 'relay_result'].includes(st.tool));
          if (read) {
            return { speech: read.say, emotion: read.ok ? 'content' : 'uncertain', behavior: 'settle', thought: `Hands: ${steps.map((s) => s.tool).join(', ')}.`,
              steps: steps.map(({ tool, args, ok }) => ({ tool, args, ok })), verbatim: true, ...extras(read) };
          }
          // Safety net (eval 2026-10-01): the model offered a helper in words ("a helper can… would you like me to?")
          // instead of calling relay_start, so nothing waited for the owner's yes. Queue the proposal by rule.
          // Also when it only looked something up first (helpers_usage, relay_status) and then just reported numbers.
          // Live test 2026-10-01 (F7): only for a request, never for a question like "Did Codex build the game yet?".
          // RV2-9: a build-shaped request the model answered itself ("Write a short poem about code") stays answered.
          const content = (msg.content ?? '').trim();
          const acted = steps.some((st) => !['helpers_usage', 'relay_status', 'running_apps'].includes(st.tool));
          // Review round 3 (R2S-R3G-12): a plain "I can't" queues build work only when what is asked for is itself the
          // software ("make me a playlist for game night" is not); pointing at a helper is enough.
          const declined = steps.length || !content || HELPER.test(content) || /\bhelpers?\b/i.test(content)
            || (GAVE_UP.test(content) && DIRECT_BUILD.test(norm(said)));
          const asBuild = BUILD.test(said.toLowerCase()) && declined ? proposal(said, 'a helper can build it') : null;
          const offer = !tools.relay_start || acted || cls?.noStore || !isImperative(said, cls) || aboutExisting(said) ? null
            : steps.length ? asBuild : proposal(said, content) ?? asBuild;
          if (offer) {
            const { args, why } = reroute(offer);
            return hold(tools.relay_start, args, 'asked owner (rule: the model only offered)', steps, why);
          }
          // R2T-R3-H8: after helpers_usage the figures are the reply (the model's echo or silence lost them).
          const usage = steps.findLast((st) => st.tool === 'helpers_usage' && st.ok);
          if (usage) {
            return { speech: usage.say, emotion: 'content', behavior: 'settle', thought: `Hands: ${steps.map((s) => s.tool).join(', ')}.`,
              steps: steps.map(({ tool, args, ok }) => ({ tool, args, ok })), verbatim: true, ...extras(usage) };
          }
          const speech = content || (steps.length ? steps.at(-1).say : "I can't do that yet.");
          if (!steps.length && (OFFERED.test(speech) || /\?\s*$/.test(speech))) lastOffer = now();   // RV2-7
          return { speech, emotion: steps.every((s) => s.ok) ? 'content' : 'uncertain', behavior: 'settle',
            thought: `Hands: ${steps.map((s) => s.tool).join(', ') || 'no tool'}.`, steps };
        }
        messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls });
        for (const call of calls) {
          const name = call.function?.name;
          let args = call.function?.arguments ?? {};
          if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
          const tool = tools[name];
          if (!tool) {
            messages.push({ role: 'tool', content: JSON.stringify({ ok: false, say: `There is no tool called ${name}.` }) });
            audit({ tool: name, args, how: 'refused (unknown tool)' });
            continue;
          }
          if (tool.risk === 'confirm') {
            if (name === 'relay_start') {
              // RV2-4: off-the-record words never go to a helper, not even after a yes.
              if (cls?.noStore) {
                audit({ tool: name, args, how: 'refused (off the record)' });
                return { speech: "That was off the record, so I won't pass it to a helper.", emotion: 'content', behavior: 'settle', thought: 'relay_start refused for off-the-record words.', steps };
              }
              // K6/N9: the owner's words, never the model's rewording; F19: build work never to read-only ChatGPT.
              args = { ...args, task: ownWords(said, args.task ?? said) };
              // G5: never when the model asked for an answer only, or the owner asked how to build something.
              const answerOnly = args.question_only === true || args.question_only === 'true' || asksHowTo(said);
              if (normalizeAgent(args.agent) === 'chatgpt' && BUILD.test(said.toLowerCase()) && !answerOnly) args = { ...args, agent: 'claude', question_only: false };
              // Review round 3 (R2S-R3G-8): a request that neither builds nor changes anything is read-only, whatever
              // the model sent ("Ask Claude why the tests keep failing" never gets a write worktree).
              else if (answerOnly || !changesCode(said)) args = { ...args, question_only: true };
              const { args: routed, why } = reroute(args);
              return hold(tool, routed, 'asked owner', steps, why);
            }
            return hold(tool, args, 'asked owner', steps);
          }
          if (readHelper && !FACTS.includes(name)) {
            // L11: the owner sees exactly what "yes" does (the whole link on screen, its site spoken), never "a link".
            const label = name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
            const vals = Object.values(args).map(String);
            const site = (v) => { try { return new URL(v).host || null; } catch { return null; } };
            const spoken = vals.map((v) => (/^https?:\/\//i.test(v) ? `the link to ${site(v) ?? 'a website'}` : v));
            const what = `${label}${vals.length ? `: ${spoken.join(', ')}` : ''}?`;
            const screen = `${label}${vals.length ? `: ${vals.join(', ')}` : ''}? Say yes to go.`;
            return hold({ ...tool, confirmText: () => what }, args, 'asked owner (an action after reading helper output, G7)', steps, '', screen);
          }
          const r = await runTool(tool, args, 'auto');
          const helperText = ['relay_status', 'relay_result'].includes(name);
          if (helperText) readHelper = true;
          steps.push({ tool: name, args, ok: r.ok, say: r.say, ...extras(r) });
          // Review round 3 (R2S-R3G-9): what a helper wrote (its question, answer, summary) never reaches the model,
          // not even inside Tamago's own sentence; the owner hears that sentence from the tool itself (N8).
          const result = helperText ? `Read ${Array.isArray(r.data) ? r.data.length : 1} helper task(s); Tamago tells the owner itself.` : r.say;
          messages.push({ role: 'tool', content: JSON.stringify({ ok: r.ok, result, data: r.data ?? null }) });
        }
      }
      return { speech: steps.at(-1)?.say ?? 'I got tangled. Say it more simply?', emotion: 'uncertain', behavior: 'look_away',
        thought: 'Hands: step limit reached.', steps };
    },
  };
}
