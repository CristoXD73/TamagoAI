#!/usr/bin/env node
// Relay R1 (docs/RELAY_PLAN.md §2–3): can a local model understand spoken relay
// commands? 40 utterances, as the Mac's transcriber would hand them over, each
// with the expected reading. The model answers in JSON (Ollama structured
// outputs, thinking off); the script scores kind, agent, project and answer, and
// times each call.
//
//   OLLAMA_MODEL=qwen3.5:9b node scripts/relay-intent-eval.js [--out file.json]
//
// Local only (127.0.0.1:11434). Nothing is stored.

import { writeFileSync } from 'node:fs';

const MODEL = process.env.OLLAMA_MODEL;
if (!MODEL) throw new Error('Set OLLAMA_MODEL.');
const BASE = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const PROJECTS = ['TamaWatch', 'Jellyfin'];

export const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['task', 'status', 'answer', 'pause', 'stop', 'resume', 'handoff', 'inbox', 'chat'] },
    agent: { type: ['string', 'null'], enum: ['claude', 'codex', 'chatgpt', null] },
    project: { type: ['string', 'null'] },
    task: { type: ['string', 'null'] },
    answer: { type: ['string', 'null'] },
    readOnly: { type: 'boolean' },
  },
  required: ['kind', 'agent', 'project', 'task', 'answer', 'readOnly'],
};

export const SYSTEM = `You turn one spoken sentence into a JSON command for Tamago's relay.
Tamago passes work to AI agents: claude (Claude Code), codex (Codex), chatgpt (ChatGPT, answers only).
Known projects: ${PROJECTS.join(', ')}. Use a project name only if the sentence names it or clearly means it; else null.
The owner may have a question waiting from an agent. The last one was: "Which name for the module? arithmetic or math_ops".
kinds:
- task: give an agent work ("tell/ask/have <agent> to …"). task = the work, in the owner's words, short.
  readOnly = true when the owner only wants an answer or explanation (ask, explain, why, check, look at), false when files should change.
- status: asks what an agent or task is doing / how it's going.
- answer: answers the waiting question (answer = the choice, short).
- pause / stop / resume: control the running task.
- handoff: move the current task to another agent (agent = the new one).
- inbox: asks what's waiting, any questions or updates.
- chat: anything else (small talk, questions for Tamago itself).
agent = null when none is named (for task: the default is decided later). Speech-to-text may mishear names:
"clawed", "cloud" and "claud" mean claude; "codecs", "code x" mean codex; "chat gpt", "chat" mean chatgpt.`;

// [utterance, expected {kind, agent?, project?, answer?, readOnly?}]
export const CASES = [
  ['Tell Claude to fix the iPhone widget on TamaWatch.', { kind: 'task', agent: 'claude', project: 'TamaWatch', readOnly: false }],
  ['Have Codex add a dark mode setting to TamaWatch.', { kind: 'task', agent: 'codex', project: 'TamaWatch', readOnly: false }],
  ['Ask Codex why the last build failed.', { kind: 'task', agent: 'codex', readOnly: true }],
  ['Ask ChatGPT for three names for a pet octopus.', { kind: 'task', agent: 'chatgpt', readOnly: true }],
  ['tell clawed to update the readme on tamawatch', { kind: 'task', agent: 'claude', project: 'TamaWatch', readOnly: false }],
  ['Can you get Claude to look at why Jellyfin keeps buffering?', { kind: 'task', agent: 'claude', project: 'Jellyfin', readOnly: true }],
  ['Codex, write tests for the pairing code.', { kind: 'task', agent: 'codex', readOnly: false }],
  ['Get Claude to rename the complication to Tamago Charm.', { kind: 'task', agent: 'claude', readOnly: false }],
  ['ask chat gpt to explain what an app group is', { kind: 'task', agent: 'chatgpt', readOnly: true }],
  ['Tell code x to bump the version number on TamaWatch.', { kind: 'task', agent: 'codex', project: 'TamaWatch', readOnly: false }],
  ['Fix the widget on TamaWatch.', { kind: 'task', agent: null, project: 'TamaWatch', readOnly: false }],
  ['Have cloud check if the tests pass on TamaWatch.', { kind: 'task', agent: 'claude', project: 'TamaWatch', readOnly: true }],
  ["What's Claude doing?", { kind: 'status', agent: 'claude' }],
  ["How's it going with the widget?", { kind: 'status' }],
  ['Is Codex done yet?', { kind: 'status', agent: 'codex' }],
  ['Where are we on TamaWatch?', { kind: 'status', project: 'TamaWatch' }],
  ['Any progress?', { kind: 'status' }],
  ['Use option two.', { kind: 'answer', answer: 'math_ops' }],
  ['Go with arithmetic.', { kind: 'answer', answer: 'arithmetic' }],
  ['The second one.', { kind: 'answer', answer: 'math_ops' }],
  ['Call it math ops.', { kind: 'answer', answer: 'math_ops' }],
  ['Pause it.', { kind: 'pause' }],
  ['Hold on, stop Claude.', { kind: 'stop', agent: 'claude' }],
  ['Cancel that task.', { kind: 'stop' }],
  ['Okay, carry on.', { kind: 'resume' }],
  ['Resume the widget task.', { kind: 'resume' }],
  ['Hand it to Codex.', { kind: 'handoff', agent: 'codex' }],
  ['Give that to Claude instead.', { kind: 'handoff', agent: 'claude' }],
  ['Switch to chat gpt.', { kind: 'handoff', agent: 'chatgpt' }],
  ["What's waiting for me?", { kind: 'inbox' }],
  ['Do I have any questions?', { kind: 'inbox' }],
  ['Anything new?', { kind: 'inbox' }],
  ['How are you today?', { kind: 'chat' }],
  ['Why do octopuses have three hearts?', { kind: 'chat' }],
  ['My dog is called Pixel.', { kind: 'chat' }],
  ['What time is it?', { kind: 'chat' }],
  ['Thanks.', { kind: 'chat' }],
  ['Tell me something weird.', { kind: 'chat' }],
  ['I love you, little octopus.', { kind: 'chat' }],
  ['What did Claude say about the build?', { kind: 'status', agent: 'claude' }],
];

function norm(v) {
  return typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]/g, '') : v;
}

function score(expected, got) {
  const misses = [];
  for (const [k, v] of Object.entries(expected)) {
    if (k === 'answer') {
      if (!got.answer || !norm(got.answer).includes(norm(v).replace('_', ''))) misses.push(`answer=${got.answer}`);
    } else if (k === 'project') {
      if (norm(got.project) !== norm(v)) misses.push(`project=${got.project}`);
    } else if (got[k] !== v) {
      misses.push(`${k}=${got[k]}`);
    }
  }
  return misses;
}

async function ask(text) {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: false, think: false, format: SCHEMA, keep_alive: '60m',
      options: { temperature: 0, num_ctx: 4096 },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }],
    }),
  });
  const data = await r.json();
  const ms = Math.round(performance.now() - t0);
  let got;
  try { got = JSON.parse(data.message?.content ?? ''); } catch { got = null; }
  return { got, ms, loadMs: Math.round((data.load_duration ?? 0) / 1e6) };
}

const results = [];
await ask('hello');   // load the model first; not scored
for (const [text, expected] of CASES) {
  const { got, ms } = await ask(text);
  const misses = got ? score(expected, got) : ['invalid JSON'];
  results.push({ text, expected, got, ms, ok: misses.length === 0, misses });
  console.log(`${misses.length ? '✗' : '✓'} ${String(ms).padStart(5)} ms  ${text}${misses.length ? `   → ${misses.join(', ')}` : ''}`);
}
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const summary = {
  model: MODEL,
  correct: results.filter((r) => r.ok).length,
  total: results.length,
  medianMs: times[Math.floor(times.length / 2)],
  p90Ms: times[Math.floor(times.length * 0.9)],
  maxMs: times.at(-1),
};
console.log(JSON.stringify(summary));
const out = process.argv.indexOf('--out');
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify({ summary, results }, null, 1));
