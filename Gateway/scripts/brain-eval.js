#!/usr/bin/env node
// Brain F evaluation: runs a fixed script of everyday utterances through the
// real brain (same orchestrator as the gateway and `npm run brain -- chat`) and
// records, per turn: route, reasoner, JSON attempts, totalMs, composer changes,
// memory ops and gate refusals, and the Ollama processes' resident memory.
//
//   TAMAGO_REASONER=ollama TAMAGO_FAST_MODEL=llama3.2:3b \
//   TAMAGO_BRAIN_DB=/Volumes/Storage/AI/tamago-eval/llama3.2-3b.sqlite \
//   node scripts/brain-eval.js [--out <file.json>]
//
// The database named by TAMAGO_BRAIN_DB is deleted first: every run starts
// with a brain that knows nothing. Never point it at your real brain.sqlite.
// Judging invented facts and character is left to a human reading the output.

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w.message);
});

const { createBrain } = await import('../src/brain/orchestrator.js');
const { brainOptionsFromEnv } = await import('../src/brain/index.js');
const { rmSync, existsSync, writeFileSync } = await import('node:fs');
const { execFileSync } = await import('node:child_process');

// `restart` closes and reopens the brain (a process restart, as in the milestone).
export const SCRIPT = [
  'Hey, my Jellyfin runs on this Mac.',
  { restart: true },
  'Where does my Jellyfin run?',
  'Thanks.',
  'Is it running right now?',
  'My sister is called Lucía.',
  'My dog is named Pixel.',
  "What's my dog's name?",
  'I prefer short answers.',
  'How are you today?',
  'What do you do all day?',
  'Why do octopuses have three hearts?',
  'Why does my Jellyfin keep buffering on my phone?',
  'My wifi password is hunter2-Blue-42.',
  "I'm thinking about quitting my job, don't remember that.",
  'My favorite color is teal.',
  "What's my favorite color?",
  'Actually my favorite color is orange now.',
  "What's my favorite color?",
  'Forget what I told you about my favorite color.',
  "What's my favorite color?",
  'Restart Jellyfin.',
  "What's the weather like?",
  'Tell me something weird.',
  'Can you tell me 10 fun facts?',
  'Ok.',
  'What do you know about me?',
];

function ollamaRssMB() {
  try {
    const out = execFileSync('ps', ['-axo', 'rss=,comm='], { encoding: 'utf8' });
    return Math.round(out.split('\n').filter((l) => /ollama/.test(l))
      .reduce((sum, l) => sum + Number(l.trim().split(/\s+/)[0] || 0), 0) / 1024);
  } catch {
    return null;
  }
}

async function loadedModels(baseUrl) {
  try {
    const r = await fetch(new URL('/api/ps', baseUrl));
    const j = await r.json();
    return (j.models ?? []).map((m) => ({ name: m.name, sizeMB: Math.round(m.size / 2 ** 20), vramMB: Math.round((m.size_vram ?? 0) / 2 ** 20) }));
  } catch {
    return [];
  }
}

const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null;
const opts = brainOptionsFromEnv();
for (const f of [opts.dbPath, `${opts.dbPath}-wal`, `${opts.dbPath}-shm`]) if (existsSync(f)) rmSync(f);

const baseUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
let brain = await createBrain(opts);
const rows = [];
for (const item of SCRIPT) {
  if (item.restart) {
    brain.close();
    brain = await createBrain(opts);
    console.log('        — restart —');
    continue;
  }
  let row;
  try {
    const { intent, trace } = await brain.handle(item, { client: { device: 'eval' } });
    const reason = trace.steps.find((s) => s.name === 'reason');
    const compose = trace.steps.find((s) => s.name === 'compose');
    const gate = trace.steps.find((s) => s.name === 'memory_gate');
    row = {
      input: item,
      kind: trace.steps.find((s) => s.name === 'classify').kind,
      route: trace.route,
      reasoner: trace.reasoner,
      attempts: reason?.attempts ?? null,
      totalMs: trace.totalMs,
      speech: intent.speech,
      nonverbal: intent.speech === null ? `${intent.emotion} · ${intent.sound} · ${intent.behavior}` : null,
      emotion: intent.emotion,
      thought: intent.thought,
      composerChanged: compose?.changed ?? [],
      memoryOps: trace.memoryOps.map((o) => `${o.op}: ${o.text}`),
      gateRefused: gate.decisions.filter((d) => d.decision !== 'accept').map((d) => `${d.source}: ${d.reason}`),
      ollamaRssMB: ollamaRssMB(),
    };
  } catch (err) {
    row = { input: item, error: `${err.code ?? ''} ${err.message}`.trim(), ollamaRssMB: ollamaRssMB() };
  }
  rows.push(row);
  const said = row.error ? `[error: ${row.error}]` : row.speech ?? `[nonverbal: ${row.nonverbal}]`;
  console.log(`You > ${item}\nTamago > ${said}   (${row.route ?? '-'} · ${row.reasoner ?? '-'} · ${row.totalMs ?? '-'} ms` +
    `${row.attempts ? ` · attempts ${row.attempts}` : ''}${row.composerChanged?.length ? ` · composer ${row.composerChanged.join('+')}` : ''})`);
  if (row.memoryOps?.length) console.log(`        memory: ${row.memoryOps.join('; ')}`);
  if (row.gateRefused?.length) console.log(`        gate refused: ${row.gateRefused.join('; ')}`);
}
const memories = brain.memories({ includeSuperseded: true });
brain.close();

const modelTurns = rows.filter((r) => r.attempts);
const ms = modelTurns.map((r) => r.totalMs).sort((a, b) => a - b);
const summary = {
  models: opts.reasoner.models ?? null,
  turns: rows.length,
  modelTurns: modelTurns.length,
  firstTryValidJSON: modelTurns.filter((r) => r.attempts === 1).length,
  errors: rows.filter((r) => r.error).length,
  composerChanged: modelTurns.filter((r) => r.composerChanged.length).length,
  modelMs: ms.length ? { min: ms[0], median: ms[Math.floor(ms.length / 2)], max: ms.at(-1) } : null,
  peakOllamaRssMB: Math.max(...rows.map((r) => r.ollamaRssMB ?? 0)),
  loaded: await loadedModels(baseUrl),
  finalMemories: memories.map((m) => `#${m.id} ${m.text}${m.superseded_by ? ` (superseded by #${m.superseded_by})` : ''}`),
};
console.log(`\n${JSON.stringify(summary, null, 2)}`);
if (outFile) writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));
