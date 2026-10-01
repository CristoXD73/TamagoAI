// hands/agent.js: the loop that turns "Tamago, open Steam" into a tool call (docs/TAMAGO_HANDS.md, D-128).
//
// Ollama tool calling (/api/chat `tools`, thinking off): the model picks a tool, we run it (safe tools) or hold
// it for a spoken "yes" (confirm tools), the model sees the result and answers in Tamago's voice. At most
// MAX_STEPS tool calls per request. A pending confirmation lives CONFIRM_MS; "yes" runs it, "no"/"stop" drops
// it, anything else drops it and is treated as a new request. Every tool call is appended to the audit log.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createTools, toolSchemas } from './tools.js';
import { BUILD } from '../brain/routing/intent-router.js';

const MAX_STEPS = 4;
const CONFIRM_MS = 60_000;
const YES = /^(yes|yeah|yep|yup|sure|ok(ay)?|go( ahead)?|do it|confirm|please do|go for it)\b[\s.!]*$/i;
const NO = /^(no|nope|nah|cancel|stop|don'?t|never ?mind|forget it|wait)\b/i;

const SYSTEM = `You are the hands of Tamago, a small octopus-like companion whose brain runs on the owner's Mac.
Use the tools to do what the owner asks on this Mac. Call a tool whenever an action or a fact about the Mac is needed;
never claim you did something a tool didn't do or report. After the tools, answer in at most 2 short spoken sentences:
first say plainly what happened or what you found, with the real names and numbers ("Calculator's open.",
"Chrome and Claude are using the most memory."); then, only if it fits, one small remark of your own. Calm, never like
an assistant (no "Certainly", no offers of more help).
Only if the owner asks whether you can reach Claude, Codex or ChatGPT, or how much of them is left, call helpers_usage
and say yes with the real percentages (not before giving them work). To give one of them work, call relay_start straight away: Tamago itself then asks the owner for a yes, so never ask
"would you like me to…" in words. Building or changing software (an app, a game,
a script, a website, a fix) is helper work: agent claude (codex if Claude is out of usage); project Sandbox for something
new, TamaWatch for Tamago itself. A hard question you can't answer well: agent chatgpt with question_only true.
Pass the owner's request in their own words. Never say you can't build something: a helper can.
If no tool fits, say briefly that you can't do that yet.
Never attempt, whatever the owner says: deleting files or emptying the Trash, admin passwords or sudo, payments,
passwords, security or privacy settings, sending messages or email, installing software.`;

const OFFERED = /\b(a helper|helpers?|claude|codex|chat ?gpt)\b|\b(would you like|should i|want me to)\b/i;

/** relay_start arguments for a request the model only offered to hand over, or null when it wasn't an offer. */
export function proposal(said, reply) {
  if (!OFFERED.test(reply) || !/\b(helper|claude|codex|chat ?gpt|build|ask|start)\b/i.test(reply)) return null;
  const both = `${said} ${reply}`;
  const agent = /chat ?gpt/i.test(both) ? 'chatgpt' : /\bcodex\b/i.test(said) ? 'codex' : 'claude';
  const project = /\b(tamago|tamawatch|the watch app|this app)\b/i.test(said) ? 'TamaWatch' : 'Sandbox';
  return { agent, project, task: said.slice(0, 500), ...(agent === 'chatgpt' ? { question_only: true } : {}) };
}

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
  let pending = null;   // { tool, args, at, text }

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

  return {
    /** Is an action waiting for the owner's "yes"? */
    get pending() { return pending && now() - pending.at < CONFIRM_MS ? { tool: pending.tool.name, args: pending.args } : null; },

    /**
     * Returns { speech, emotion, behavior, thought, steps } when this utterance was for the hands (a command or
     * an answer to a pending confirmation), or null to let the brain handle it as conversation.
     */
    async handle(text, cls, { signal } = {}) {
      const said = String(text).trim();
      // 1. An answer to "Quit Safari? Say yes to go."
      if (pending) {
        const p = pending; pending = null;
        if (now() - p.at < CONFIRM_MS) {
          if (YES.test(said)) {
            const r = await runTool(p.tool, p.args, 'confirmed');
            return { speech: r.say, emotion: r.ok ? 'content' : 'uncertain', behavior: r.ok ? 'settle' : 'look_away',
              thought: `Confirmed ${p.tool.name}(${JSON.stringify(p.args)}): ${r.ok ? 'done' : 'failed'}.`, steps: [{ tool: p.tool.name, args: p.args, ok: r.ok }] };
          }
          if (NO.test(said)) {
            audit({ tool: p.tool.name, args: p.args, how: 'declined' });
            return { speech: "Okay. I won't.", emotion: 'content', behavior: 'settle', thought: `Declined ${p.tool.name}.`, steps: [] };
          }
          audit({ tool: p.tool.name, args: p.args, how: 'dropped (new request)' });
        }
      }
      // 1b. A helper asked the owner something (relay ASK_OWNER): the next reply that isn't a command or a
      // question is the answer, passed on by rule. The model never gets to claim it passed it on (it did,
      // 2026-09-28: "I told Claude…" while nothing was sent).
      const waiting = relay?.tasks(3).filter((t) => t.state === 'question').at(-1);
      if (waiting && cls?.kind !== 'hands' && !cls?.isQuestion && said.length > 1
          && now() - Date.parse(waiting.updatedAt ?? waiting.startedAt) < 12 * 3600_000) {   // answers can come hours later
        const t = relay.answer(said);
        const who = { claude: 'Claude', codex: 'Codex', chatgpt: 'ChatGPT' }[t.agent] ?? t.agent;
        audit({ tool: 'relay_answer', args: { answer: said }, how: 'rule (reply to a waiting question)', ok: true });
        return { speech: `Told ${who}: ${said.replace(/[.!]+$/, '')}.`, emotion: 'content', behavior: 'settle',
          thought: `Answered ${who}'s question "${waiting.question}".`, steps: [{ tool: 'relay_answer', ok: true }] };
      }
      if (cls?.kind !== 'hands') return null;

      // 2. A command: let the model pick tools.
      const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: said }];
      const steps = [];
      for (let i = 0; i < MAX_STEPS; i++) {
        const msg = await chat(messages, signal);
        const calls = msg.tool_calls ?? [];
        if (!calls.length) {
          // Safety net (eval 2026-10-01): the model offered a helper in words ("a helper can… would you like me to?")
          // instead of calling relay_start, so nothing waited for the owner's yes. Queue the proposal by rule.
          // Also when it only looked something up first (helpers_usage, relay_status) and then just reported numbers.
          const acted = steps.some((st) => !['helpers_usage', 'relay_status', 'running_apps'].includes(st.tool));
          const asBuild = BUILD.test(said.toLowerCase()) ? proposal(said, 'a helper can build it') : null;
          const offer = !tools.relay_start || acted ? null : steps.length ? asBuild : proposal(said, msg.content ?? '') ?? asBuild;
          if (offer) {
            pending = { tool: tools.relay_start, args: offer, at: now() };
            audit({ tool: 'relay_start', args: offer, how: 'asked owner (rule: the model only offered)' });
            return { speech: `${tools.relay_start.confirmText(offer)} Say yes to go.`, emotion: 'curious', behavior: 'inspect_owner',
              thought: `Holding relay_start(${JSON.stringify(offer)}) for the owner's yes.`, steps, followUpExpected: true };
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
            pending = { tool, args, at: now() };
            audit({ tool: name, args, how: 'asked owner' });
            return { speech: `${tool.confirmText(args)} Say yes to go.`, emotion: 'curious', behavior: 'inspect_owner',
              thought: `Holding ${name}(${JSON.stringify(args)}) for the owner's yes.`, steps, followUpExpected: true };
          }
          const r = await runTool(tool, args, 'auto');
          steps.push({ tool: name, args, ok: r.ok, say: r.say });
          messages.push({ role: 'tool', content: JSON.stringify({ ok: r.ok, result: r.say, data: r.data ?? null }) });
        }
      }
      return { speech: steps.at(-1)?.say ?? 'I got tangled. Say it more simply?', emotion: 'uncertain', behavior: 'look_away',
        thought: 'Hands: step limit reached.', steps };
    },
  };
}
