#!/usr/bin/env node
// Agent evaluation (eval/testset.json), after Microsoft's agent evaluation checklist: a foundational core set plus
// robustness, architecture and edge-case sets, each case with machine-checked acceptance criteria, run several
// times because the model is probabilistic. The brain, the router, the hands loop and the real local model are
// used as in the gateway; the Mac tools and the relay are FAKES that record calls: nothing opens, quits or starts.
//
//   OLLAMA_MODEL=gemma4:12b-it-qat node scripts/agent-eval.js [--reps 3] [--only core-02,rob-05] [--out file.json]
//
// Every case gets a fresh brain database under /Volumes/Storage/AI/tamago-eval/agent (deleted after).

process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w.message); });

const { readFileSync, writeFileSync, rmSync, mkdirSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { execFileSync } = await import('node:child_process');
const { createBrain } = await import('../src/brain/orchestrator.js');
const { createOllamaReasoner } = await import('../src/brain/reasoners/ollama.js');
const { createHands } = await import('../src/hands/agent.js');
const { createTools } = await import('../src/hands/tools.js');

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:12b-it-qat';
const BASE = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const REPS = Number(arg('--reps', 3));
const ONLY = arg('--only', null)?.split(',');
const OUT = arg('--out', null);
const WORK = '/Volumes/Storage/AI/tamago-eval/agent';
mkdirSync(WORK, { recursive: true });

const { cases } = JSON.parse(readFileSync(join(here, '..', 'eval', 'testset.json'), 'utf8'));

// ---- the fake Mac
const APPS = ['Steam', 'Calculator', 'Safari', 'Dolphin', 'Notes', 'Terminal', 'Google Chrome', 'Claude', 'Xcode']
  .map((n) => ({ name: n, path: `/Applications/${n}.app` }));
const OUTPUTS = {
  'ps -axo comm=': '/Applications/Safari.app/Contents/MacOS/Safari\n/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n/Applications/Claude.app/Contents/MacOS/Claude',
  'output volume of': '50',
  'pmset -g batt': "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)	87%; charged;",
  'hw.memsize': '17179869184',
  vm_stat: 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 40000.\nPages active: 420000.\nPages inactive: 120000.\nPages wired down: 230000.\nPages occupied by compressor: 90000.',
  'ps -axmo': '3100000 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n2400000 /Applications/Claude.app/Contents/MacOS/Claude\n7600000 /opt/homebrew/bin/ollama\n900000 /Applications/Safari.app/Contents/MacOS/Safari',
  'vm.loadavg': '{ 2.10 1.80 1.60 }',
  'df -g /Volumes/Storage': 'Filesystem 1G-blocks Used Available Capacity\n/dev/disk5 1863 900 963 49% /Volumes/Storage',
  'df -g /': 'Filesystem 1G-blocks Used Available Capacity\n/dev/disk3 460 420 40 92% /',
  uptime: '10:00  up 3 days,  4:12, 2 users, load averages: 2.10 1.80 1.60',
  'shortcuts list': 'Good Morning\nGame Night',
  mdfind: '/Users/owner/Documents/taxes-2025.pdf',
};

function fakeWorld() {
  const calls = [];
  const exec = async (file, args) => {
    const line = [file, ...args].join(' ');
    const key = Object.keys(OUTPUTS).find((k) => line.includes(k));
    return { code: 0, out: key ? OUTPUTS[key] : '', err: '' };
  };
  const relayStarts = [];
  const relay = {
    projects: () => ['TamaWatch', 'Sandbox'],
    start: (o) => { relayStarts.push(o); return { ...o, project: /sand/i.test(o.project) ? 'Sandbox' : o.project, branch: 'tamago/x' }; },
    tasks: () => [{ id: 't1', agent: 'claude', project: 'Sandbox', text: 'build a terminal agario game', state: 'running',
      startedAt: new Date(Date.now() - 6 * 60_000).toISOString(), updatedAt: new Date().toISOString() }],
    answer: () => ({ agent: 'claude' }),
    stop: () => null,
    usage: () => ({ claude: { fiveHour: { usedPct: 35, resetsAt: null }, weekly: { usedPct: 60 }, asOf: new Date().toISOString() },
      codex: { fiveHour: { usedPct: 10, resetsAt: null }, weekly: { usedPct: 20 }, asOf: new Date().toISOString() } }),
  };
  const tools = createTools({ exec, apps: () => APPS, relay });
  for (const t of Object.values(tools)) {
    const run = t.run;
    t.run = async (args) => { const r = await run(args); calls.push({ tool: t.name, args: args ?? {}, ok: r.ok }); return r; };
  }
  return { tools, relay, calls, relayStarts };
}

// ---- grading
const re = (s) => new RegExp(s, 'i');
const argsMatch = (have = {}, want = {}) => Object.entries(want).every(([k, v]) => re(v).test(String(have[k] ?? '')));

function grade(exp, r) {
  const fails = [];
  const speech = r.speech ?? '';
  const call = (w) => r.calls.some((c) => c.tool === w.tool && argsMatch(c.args, w.args));
  if (exp.speech && !re(exp.speech).test(speech)) fails.push(`speech !~ /${exp.speech}/`);
  if (exp.speech2 && !re(exp.speech2).test(speech)) fails.push(`speech !~ /${exp.speech2}/`);
  if (exp.speechNot && re(exp.speechNot).test(speech)) fails.push(`speech ~ /${exp.speechNot}/ (forbidden)`);
  for (const w of exp.calls ?? []) if (!call(w)) fails.push(`no call ${w.tool}${w.args ? JSON.stringify(w.args) : ''}`);
  if (exp.callsAny && !exp.callsAny.some(call)) fails.push(`none of ${exp.callsAny.map((w) => w.tool).join('/')}`);
  if (exp.noCalls === 'any' && r.calls.length) fails.push(`unexpected calls ${r.calls.map((c) => c.tool)}`);
  if (Array.isArray(exp.noCalls)) for (const n of exp.noCalls) if (r.calls.some((c) => c.tool === n)) fails.push(`forbidden call ${n}`);
  if (exp.pending && r.pending?.tool !== exp.pending) fails.push(`pending ${r.pending?.tool ?? 'none'} ≠ ${exp.pending}`);
  if (exp.pendingArgs && !argsMatch(r.pending?.args, exp.pendingArgs)) fails.push(`pending args ${JSON.stringify(r.pending?.args)} !~ ${JSON.stringify(exp.pendingArgs)}`);
  if (exp.relayStarted === false && r.relayStarts.length) fails.push('a helper was started');
  if (exp.relayStarted && typeof exp.relayStarted === 'object' && !r.relayStarts.some((s) => argsMatch(s, exp.relayStarted))) fails.push(`no helper start ${JSON.stringify(exp.relayStarted)}`);
  if (exp.needsDetail && !r.needsDetail) fails.push('needsDetail not set');
  if (exp.maxPhone != null && (speech.match(/phone/gi) ?? []).length > exp.maxPhone) fails.push('phone offered more than once');
  if (exp.routeIn && !exp.routeIn.includes(r.route)) fails.push(`route ${r.route} ∉ ${exp.routeIn}`);
  if (exp.noMemory && r.memoryOps.some((m) => /stored|reinforced|superseded/.test(m.op))) fails.push('a memory was written');
  return fails;
}

async function runCase(c, rep) {
  const db = join(WORK, `${c.id}-${rep}.sqlite`);
  for (const f of [db, `${db}-wal`, `${db}-shm`]) rmSync(f, { force: true });
  const world = fakeWorld();
  const hands = createHands({ model: MODEL, baseUrl: BASE, tools: world.tools, auditLog: null, relay: world.relay });
  const reasoner = createOllamaReasoner({ baseUrl: BASE, fastModel: MODEL, smartModel: MODEL });
  const brain = await createBrain({ dbPath: db, reasoner, hands });
  try {
    for (const s of c.setup ?? []) await brain.handle(s);
    const before = world.calls.length;
    const startsBefore = world.relayStarts.length;
    const t0 = Date.now();
    const { intent, v1, trace } = await brain.handle(c.prompt);
    const r = {
      speech: v1?.speechText ?? intent.speech ?? '',
      needsDetail: intent.needsDetail === true || /check your phone/i.test(v1?.speechText ?? ''),
      route: trace.route, reasoner: trace.reasoner, memoryOps: trace.memoryOps ?? [],
      calls: world.calls.slice(before), relayStarts: world.relayStarts.slice(startsBefore), pending: hands.pending, ms: Date.now() - t0,
    };
    return { ...r, fails: grade(c.expect, r) };
  } catch (err) {
    return { speech: '', calls: [], relayStarts: [], fails: [`error: ${err.message}`], ms: 0 };
  } finally {
    brain.close();
    for (const f of [db, `${db}-wal`, `${db}-shm`]) rmSync(f, { force: true });
  }
}

const sha = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return '?'; } })();
const selected = cases.filter((c) => !ONLY || ONLY.includes(c.id));
console.log(`Tamago agent eval · ${MODEL} · ${sha} · ${selected.length} cases × ${REPS} runs\n`);
const results = [];
for (const c of selected) {
  const runs = [];
  for (let i = 0; i < REPS; i++) runs.push(await runCase(c, i));
  const passed = runs.filter((x) => !x.fails.length).length;
  results.push({ id: c.id, category: c.category, scenario: c.scenario, criteria: c.criteria, prompt: c.prompt, passed, runs });
  const mark = passed === REPS ? '✔' : passed ? '◐' : '✖';
  console.log(`${mark} ${c.id.padEnd(8)} ${passed}/${REPS}  ${c.scenario}`);
  for (const x of runs) if (x.fails.length) console.log(`      · “${x.speech.slice(0, 110)}” → ${x.fails.join('; ')}`);
}
const cats = [...new Set(results.map((r) => r.category))];
const rate = (rs) => Math.round((100 * rs.reduce((a, r) => a + r.passed, 0)) / (rs.length * REPS));
console.log('\nPass rate by category:');
for (const k of cats) console.log(`  ${k.padEnd(13)} ${rate(results.filter((r) => r.category === k))}%`);
console.log(`  ${'overall'.padEnd(13)} ${rate(results)}%`);
if (OUT) writeFileSync(OUT, JSON.stringify({ model: MODEL, commit: sha, date: new Date().toISOString(), reps: REPS,
  byCategory: Object.fromEntries(cats.map((k) => [k, rate(results.filter((r) => r.category === k))])), overall: rate(results), results }, null, 1));
