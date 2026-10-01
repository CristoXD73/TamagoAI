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
import { createTools, toolSchemas, describeNews, outUntil, when } from './tools.js';
import { BUILD } from '../brain/routing/intent-router.js';
import { normalizeAgent, AGENT_NAMES, ACTIVE, RECENT_MS } from '../relay/relay.js';
import { clause } from '../brain/speech/text.js';

const MAX_STEPS = 4;
const CONFIRM_MS = 60_000;
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
const EXISTING = /\b(see|show|play|open|try|look at)\s+(me\s+)?(the|that|this|it|its|what)\b/;
const aboutExisting = (said) => { const t = norm(said); return (HELPER.test(t) && ABOUT_DONE.test(t)) || EXISTING.test(t); };

/** relay_start arguments for a request the model only offered to hand over, or null when it wasn't an offer. */
export function proposal(said, reply) {
  if (!OFFERED.test(reply)) return null;
  const build = BUILD.test(said.toLowerCase()) && !asksHowTo(said);
  const named = helperIn(said);
  // F19: build work never goes to read-only ChatGPT, even when the owner named it.
  const agent = named === 'chatgpt' ? (build ? 'claude' : 'chatgpt') : named ?? (!build && /chat ?gpt/i.test(reply) ? 'chatgpt' : 'claude');
  const project = /\b(tamago|tamawatch|the watch app|this app)\b/i.test(said) ? 'TamaWatch' : 'Sandbox';
  return { agent, project, task: said.slice(0, 500), ...(agent === 'chatgpt' ? { question_only: true } : {}) };
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
function optionIn(t, o) {
  const want = norm(o).replace(/[.!?]+$/, '');
  if (want.length < 2) return false;
  const e = escapeRe(want);
  if (new RegExp(`^${e}(?![\\p{L}\\p{N}])`, 'u').test(t)) return true;
  return (want.length >= 6 || /\s/.test(want)) && new RegExp(`(?<![\\p{L}\\p{N}])${e}(?![\\p{L}\\p{N}])`, 'u').test(t);
}
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

  /** Holds a confirm tool for the owner's yes; the spoken text always ends with "Say yes to go." (K1). */
  function hold(tool, args, how, steps = [], why = '') {
    // SM5: a handoff carries the task its confirmation names, so "yes" hands over that task and no other.
    if (tool.name === 'relay_handoff' && relay?.handable && !(args?.id && relay.tasks?.(50)?.some((x) => x.id === args.id))) {
      const prev = relay.handable({ to: normalizeAgent(args?.agent) });
      if (prev) args = { ...args, id: prev.id };
    }
    pending = { tool, args, at: now() };
    audit({ tool: tool.name, args, how });
    return { speech: `${why ? `${why} ` : ''}${tool.confirmText(args)} Say yes to go.`, emotion: 'curious', behavior: 'inspect_owner',
      thought: `Holding ${tool.name}(${JSON.stringify(args)}) for the owner's yes.`, steps, followUpExpected: true };
  }

  /** A tool result as Tamago's reply: its own words, plus screen text / a long answer for the phone. */
  function reply(name, args, r, how) {
    const out = { speech: r.say, emotion: r.ok ? 'content' : 'uncertain', behavior: r.ok ? 'settle' : 'look_away',
      thought: `${how} ${name}(${JSON.stringify(args ?? {})}): ${r.ok ? 'done' : 'failed'}.`, steps: [{ tool: name, args, ok: r.ok }],
      ...(r.screen ? { screen: r.screen } : {}), ...(r.detail ? { detail: r.detail } : {}) };
    // K2: an early ending offers the other helper; the owner's next "yes" hands it over.
    if (r.propose && tools[r.propose.tool]) {
      pending = { tool: tools[r.propose.tool], args: r.propose.args, at: now() };
      audit({ tool: r.propose.tool, args: r.propose.args, how: 'asked owner (offered after an early ending)' });
      return { ...out, speech: `${r.say} Say yes to go.`, emotion: 'curious', behavior: 'inspect_owner', followUpExpected: true };
    }
    return out;
  }

  async function forward(said, t, answer) {
    const a = relay.answer(answer, { id: t.id, agent: t.agent });
    const who = AGENT_NAMES[a?.agent ?? t.agent] ?? t.agent;
    audit({ tool: 'relay_answer', args: { answer, agent: t.agent }, how: 'rule (reply to a waiting question)', ok: true });
    return { speech: `Told ${who}: ${answer.replace(/[.!]+$/, '')}.`, emotion: 'content', behavior: 'settle',
      thought: `Answered ${who}'s question "${t.question}".`, steps: [{ tool: 'relay_answer', ok: true }] };
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
    const waiting = (relay?.tasks?.(50) ?? []).filter((t) => t.state === 'question' && !t.handedTo);
    if (!waiting.length || said.length < 2) return null;
    if (['forbidden', 'forget', 'gratitude', 'greeting'].includes(cls?.kind) || cls?.noStore) return null;
    const t = norm(said);
    const bare = t.replace(/[.!?]+$/, '');
    const exact = waiting.some((w) => (w.options ?? []).some((o) => norm(o).replace(/[.!?]+$/, '') === bare));
    if (!exact && (HANDOFF.test(t) || (STOP.test(t) && (helperIn(t) || /\b(the )?(task|helpers?|job)\b/.test(t))))) return null;
    const addressed = /^(?:tell|answer|for|to)\s+(claude|clawed|codex|code x|chat ?gpt)\b[\s,:]*(?:that\s+|to\s+)?(.*)$/i.exec(said)
      ?? /^(claude|clawed|codex|code x|chat ?gpt)\s*[,:]\s*(.+)$/i.exec(said);
    if (addressed) {
      const rest = norm(addressed[2]);
      if (BUILD.test(rest) && NEW_BUILD.test(rest)) return null;   // G2: "Tell Claude to make a snake game" is new work
      const a = normalizeAgent(addressed[1]);
      const w = waiting.filter((x) => x.agent === a).at(-1);
      return w && addressed[2].trim() ? { task: w, answer: addressed[2].trim() } : null;   // not waiting: a new request
    }
    const optionHit = waiting.filter((w) => (w.options ?? []).some((o) => optionIn(t, o)));
    const named = helperIn(t);
    if (named && !waiting.some((w) => w.agent === named)) return null;   // G6: names a helper that isn't waiting
    if (!optionHit.length) {
      if (strict) return null;
      if (MAC_COMMAND.test(t) || NEW_TASK.test(t) || RESULT.test(t)) return null;
      if ((HELPER.test(t) || /\bhelpers?\b/.test(t)) && STATUS.test(t)) return null;   // "is Codex done?"
      if (/\?\s*$/.test(said) || ASKS.test(t)) return null;   // F2: "Do it with curses" still counts
      if (BUILD.test(t) && NEW_BUILD.test(t)) return null;   // G2: "Can you build me a snake game"
      // G2: "Volume 30", "Game mode on", "Start Steam": the hands' own commands, unless they name the waiting helper.
      if (['hands', 'tool_request'].includes(cls?.kind) && !BUILD.test(t) && !named) return null;
    }
    // F1: a question the owner hasn't heard yet takes only an option; a heard one takes other replies only within
    // RECENT_MS of when the owner last heard it (G2: a 3-day-old question captured "Volume 30").
    const fresh = (w) => w.announced !== false && now() - Date.parse(w.heardAt ?? w.updatedAt ?? w.startedAt) < RECENT_MS;
    const pool = (named ? waiting.filter((w) => w.agent === named) : optionHit.length ? optionHit : waiting)
      .filter((w) => optionHit.includes(w) || fresh(w));
    if (!pool.length) return null;
    if (pool.length > 1) return { ask: pool };
    return { task: pool[0], answer: said };
  }

  /** SM9: which of the asked-about tasks a short reply picks: a helper name (if only one is its), "the first", or task words. */
  function pick(said, pool) {
    const t = norm(said);
    if (t.split(' ').length > 6) return null;
    const a = /^(?:for |to |tell )?(claude|clawed|codex|code x|chat ?gpt)[\s.!]*$/i.exec(said);
    if (a) { const m = pool.filter((w) => w.agent === normalizeAgent(a[1])); return m.length === 1 ? m[0] : null; }
    const ord = /\b(first|second|third|last)\b/.exec(t)?.[1];
    if (ord) return (ord === 'last' ? pool.at(-1) : pool[['first', 'second', 'third'].indexOf(ord)]) ?? null;
    const words = t.replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter((w) => w.length > 3 && !/^(that|this|with|from|one|ones|the|for)$/.test(w));
    const score = pool.map((w) => words.filter((x) => norm(`${w.text} ${w.project ?? ''} ${w.question ?? ''}`).includes(x)).length);
    const best = Math.max(...score);
    return best > 0 && score.filter((n) => n === best).length === 1 ? pool[score.indexOf(best)] : null;
  }

  /** 1c. Helper work already given, by rule: status, results, handoff, stop (K3, K5, K6, F6, F7). */
  async function relayRule(said, cls) {
    if (!relay || !tools.relay_status || ['forbidden', 'forget', 'gratitude', 'greeting'].includes(cls?.kind)) return null;
    const t = norm(said);
    const name = helperIn(t);
    // "What has Claude done so far?" while Claude still works is a status question, not a finished result.
    const newest = name ? relay.tasks(50).filter((x) => x.agent === name && !x.handedTo).at(-1) : null;
    if (RESULT.test(t) && tools.relay_result && !(newest && ACTIVE.includes(newest.state))) {
      const args = name ? { agent: name } : {};
      return reply('relay_result', args, await runTool(tools.relay_result, args, 'rule'), 'Rule');
    }
    const h = HANDOFF.exec(t);
    const to = h ? normalizeAgent(h[2] ?? h[4] ?? h[6]) : null;
    if (to && tools.relay_handoff) {
      const prev = relay.handable?.({ to });
      if (prev && prev.agent !== to && (REFERS_BACK.test(t) || ['limited', 'failed', 'interrupted'].includes(prev.state))) {
        if (to === 'chatgpt' && !prev.readOnly) {
          return { speech: "ChatGPT only answers questions. Codex or Claude can take build work.", emotion: 'uncertain', behavior: 'look_away', thought: 'Refused a build handoff to ChatGPT (F19).', steps: [] };
        }
        return hold(tools.relay_handoff, { agent: to, id: prev.id }, 'asked owner (rule: handoff)');
      }
    }
    if (STOP.test(t) && tools.relay_stop && (name || /\b(the )?(task|helpers?|job)\b/.test(t))) {
      const active = relay.tasks(50).filter((x) => ACTIVE.includes(x.state) && !x.handedTo && (!name || x.agent === name));
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
      // 1. An answer to "Quit Safari? Say yes to go."
      let dropped = false;
      if (pending) {
        const p = pending; pending = null;
        if (now() - p.at < CONFIRM_MS) {
          if (YES.test(said)) return reply(p.tool.name, p.args, await runTool(p.tool, p.args, 'confirmed'), 'Confirmed');
          if (NO.test(said)) {
            audit({ tool: p.tool.name, args: p.args, how: 'declined' });
            return { speech: "Okay. I won't.", emotion: 'content', behavior: 'settle', thought: `Declined ${p.tool.name}.`, steps: [] };
          }
          audit({ tool: p.tool.name, args: p.args, how: 'dropped (new request)' });
          dropped = true;
        }
      }
      // 1a. F5/SM9: "For Claude or Codex?" → "Codex"; "For Claude's "snake game" or Claude's "widget"?" → "the widget".
      if (held) {
        const h = held; held = null;
        const t = pick(said, h.pool);
        if (now() - h.at < CONFIRM_MS && t) return forward(said, t, h.text);
      }
      // 1b. The reply to a waiting helper question, by rule. The model never gets to claim it passed it on (it did,
      // 2026-09-28: "I told Claude…" while nothing was sent).
      const ans = relay ? answerFor(said, cls, { strict: dropped }) : null;
      if (ans?.ask) {
        held = { text: said, pool: ans.ask, at: now() };
        const byAgent = new Set(ans.ask.map((w) => w.agent)).size === ans.ask.length;
        const names = byAgent ? ans.ask.map((w) => AGENT_NAMES[w.agent]) : ans.ask.map((w) => `${AGENT_NAMES[w.agent]}'s "${clause(w.text, 30)}"`);
        return { speech: `For ${names.slice(0, -1).join(', ')} or ${names.at(-1)}?`, emotion: 'curious', behavior: 'inspect_owner',
          thought: `Several helper questions are waiting; asked which one "${said}" is for.`, steps: [], followUpExpected: true };
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
              steps: steps.map(({ tool, args, ok }) => ({ tool, args, ok })), ...(read.screen ? { screen: read.screen } : {}), ...(read.detail ? { detail: read.detail } : {}) };
          }
          // Safety net (eval 2026-10-01): the model offered a helper in words ("a helper can… would you like me to?")
          // instead of calling relay_start, so nothing waited for the owner's yes. Queue the proposal by rule.
          // Also when it only looked something up first (helpers_usage, relay_status) and then just reported numbers.
          // Live test 2026-10-01 (F7): only for a request, never for a question like "Did Codex build the game yet?".
          const acted = steps.some((st) => !['helpers_usage', 'relay_status', 'running_apps'].includes(st.tool));
          const asBuild = BUILD.test(said.toLowerCase()) ? proposal(said, 'a helper can build it') : null;
          const offer = !tools.relay_start || acted || !isImperative(said, cls) || aboutExisting(said) ? null
            : steps.length ? asBuild : proposal(said, msg.content ?? '') ?? asBuild;
          if (offer) {
            const { args, why } = reroute(offer);
            return hold(tools.relay_start, args, 'asked owner (rule: the model only offered)', steps, why);
          }
          const speech = (msg.content ?? '').trim() || (steps.length ? steps.at(-1).say : "I can't do that yet.");
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
              // K6/N9: the owner's words, never the model's rewording; F19: build work never to read-only ChatGPT.
              args = { ...args, task: ownWords(said, args.task ?? said) };
              // G5: never when the model asked for an answer only, or the owner asked how to build something.
              const answerOnly = args.question_only === true || args.question_only === 'true' || asksHowTo(said);
              if (normalizeAgent(args.agent) === 'chatgpt' && BUILD.test(said.toLowerCase()) && !answerOnly) args = { ...args, agent: 'claude', question_only: false };
              const { args: routed, why } = reroute(args);
              return hold(tool, routed, 'asked owner', steps, why);
            }
            return hold(tool, args, 'asked owner', steps);
          }
          if (readHelper && !FACTS.includes(name)) {
            const what = `${name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}${Object.keys(args).length ? `: ${Object.values(args).join(', ')}` : ''}?`;
            return hold({ ...tool, confirmText: () => what }, args, 'asked owner (an action after reading helper output, G7)', steps);
          }
          const r = await runTool(tool, args, 'auto');
          if (['relay_status', 'relay_result'].includes(name)) readHelper = true;
          steps.push({ tool: name, args, ok: r.ok, say: r.say, ...(r.screen ? { screen: r.screen } : {}), ...(r.detail ? { detail: r.detail } : {}) });
          messages.push({ role: 'tool', content: JSON.stringify({ ok: r.ok, result: r.say, data: r.data ?? null }) });
        }
      }
      return { speech: steps.at(-1)?.say ?? 'I got tangled. Say it more simply?', emotion: 'uncertain', behavior: 'look_away',
        thought: 'Hands: step limit reached.', steps };
    },
  };
}
