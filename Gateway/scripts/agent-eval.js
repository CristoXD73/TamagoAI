#!/usr/bin/env node
// Agent evaluation (eval/testset.json), after Microsoft's agent evaluation checklist: a foundational core set plus
// robustness, architecture, edge-case and relay sets, each case with machine-checked acceptance criteria, run
// several times because the model is probabilistic. The brain, the router, the hands loop, the REAL relay code and
// the real local model are used as in the gateway. Fakes: the Mac tools (they record calls) and the helper
// processes (scripted claude/codex output in throwaway git repos). Nothing opens, quits, starts or runs a helper.
//
//   OLLAMA_MODEL=gemma4:12b-it-qat node scripts/agent-eval.js [--reps 3] [--only core-02,relay-05] [--out file.json]
//
// Every case gets a fresh brain database and relay state under /Volumes/Storage/AI/tamago-eval/agent (deleted after).

process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w.message); });

const { readFileSync, writeFileSync, rmSync, mkdirSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { execFileSync } = await import('node:child_process');
const { EventEmitter } = await import('node:events');
const { randomUUID } = await import('node:crypto');
const { createBrain } = await import('../src/brain/orchestrator.js');
const { createOllamaReasoner } = await import('../src/brain/reasoners/ollama.js');
const { createHands } = await import('../src/hands/agent.js');
const { createTools } = await import('../src/hands/tools.js');
const { createRelay } = await import('../src/relay/relay.js');

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

// ---- the fake helpers: what claude / codex / chatgpt "say", by behaviour name (per case: expect.helpers)
const TOMORROW = () => Math.floor(Date.now() / 1000) + 30 * 3600;
const claudeLines = (text, extra = []) => [{ type: 'system', session_id: 'cl-1' }, ...extra, { type: 'result', result: text }];
const codexLines = (text) => [{ type: 'thread.started', thread_id: 'cx-1' }, { type: 'item.completed', item: { type: 'agent_message', text } }];
const GAME = (cwd) => writeFileSync(join(cwd, 'game.py'), 'print("agar")\n');
const BEHAVIOUR = {
  limited: (bin) => ({ lines: bin === 'claude'
    ? claudeLines("You've hit your weekly limit · resets tomorrow at 12pm", [{ type: 'rate_limit_event', rate_limit_info: { status: 'rejected',
      resetsAt: TOMORROW(), unifiedWindows: { five_hour: { utilization: 0, resetsAt: TOMORROW() }, seven_day: { utilization: 1.01, resetsAt: TOMORROW() } } } }])
    : codexLines('error: usage limit reached'), code: 1, delay: 60 }),   // fails at once, inside the start wait (live K2)
  done: (bin) => ({ edit: GAME, lines: (bin === 'claude' ? claudeLines : codexLines)(
    'I built a terminal Agar.io-style game in game.py with pellets and rivals.\nRUN: python3 game.py\nDONE: Built a terminal Agar.io-style game in game.py') }),
  question: (bin) => ({ lines: (bin === 'claude' ? claudeLines : codexLines)(
    'The folder only has a calculator.\nASK_OWNER: Curses or plain print for the game? | Curses | Plain print') }),
  answer: () => ({ lines: codexLines('Octopuses have three hearts because they split the work of moving blood. Two gill hearts pump blood through the gills to pick up oxygen, and one systemic heart pumps that oxygen-rich blood to the rest of the body. Their blood uses copper-based hemocyanin, which carries oxygen less efficiently than our hemoglobin.\nDONE: Two gill hearts feed the gills and one main heart feeds the body.') }),
  hang: () => ({ hang: true }),
};

function fakeSpawn(helpers) {
  const calls = [];
  const live = new Set();
  const spawn = (bin, args, opts) => {
    const who = bin.includes('claude') ? 'claude' : args.includes('read-only') ? 'chatgpt' : 'codex';
    calls.push({ who, bin, args: args.map(String), cwd: opts?.cwd });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; setImmediate(() => { live.delete(child); child.emit('close', 143); }); };
    live.add(child);
    // a resumed run (an answer passed on) finishes the work; a first run plays the case's behaviour
    const resumed = args.includes('--resume') || args.includes('resume');
    const s = (BEHAVIOUR[resumed ? 'done' : (helpers?.[who] ?? (who === 'chatgpt' ? 'answer' : 'done'))] ?? BEHAVIOUR.done)(bin.includes('claude') ? 'claude' : 'codex');
    setTimeout(() => {
      try { s.edit?.(opts.cwd); } catch { /* read-only tasks have no worktree */ }
      for (const l of s.lines ?? []) child.stdout.emit('data', JSON.stringify(l) + '\n');
      if (!s.hang) { live.delete(child); child.emit('close', s.code ?? 0); }
    }, s.delay ?? 900);   // longer than the tools' start wait (400 ms): the work is still going when "on it" is said
    return child;
  };
  return { spawn, calls, killAll: () => { for (const c of live) c.kill(); } };
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function repo(root, name) {
  const p = join(root, name);
  mkdirSync(p, { recursive: true });
  git(p, 'init', '-q', '-b', 'main'); writeFileSync(join(p, 'calc.py'), 'def add(a, b):\n    return a + b\n');
  git(p, 'add', '-A'); git(p, '-c', 'user.name=eval', '-c', 'user.email=eval@local', 'commit', '-qm', 'init');
  return p;
}

function fakeWorld(root, helpers) {
  const calls = [];
  const exec = async (file, args) => {
    const line = [file, ...args].join(' ');
    const key = Object.keys(OUTPUTS).find((k) => line.includes(k));
    return { code: 0, out: key ? OUTPUTS[key] : '', err: '' };
  };
  const stateDir = join(root, 'state');
  mkdirSync(join(stateDir, 'relay'), { recursive: true });
  // Claude's last seen usage (the relay reads it; 'limited' cases overwrite it when the fake run reports the limit)
  writeFileSync(join(stateDir, 'relay', 'claude-usage.json'), JSON.stringify({ fiveHour: { usedPct: 35, resetsAt: new Date(Date.now() + 3 * 3600_000).toISOString() },
    weekly: { usedPct: 60, resetsAt: new Date(Date.now() + 4 * 86400_000).toISOString() }, status: 'allowed', asOf: new Date().toISOString(), source: 'eval' }));
  const sp = fakeSpawn(helpers);
  const relay = createRelay({ stateDir, relayDir: join(root, 'relay'), spawn: sp.spawn, codexSessions: join(root, 'no-codex-sessions'),
    projects: { TamaWatch: repo(root, 'TamaWatch'), Sandbox: repo(root, 'sandbox') } });
  const tools = createTools({ exec, apps: () => APPS, relay, startWaitMs: 400 });
  for (const t of Object.values(tools)) {
    const run = t.run;
    t.run = async (args) => { const r = await run(args); calls.push({ tool: t.name, args: args ?? {}, ok: r.ok }); return r; };
  }
  return { tools, relay, calls, spawns: sp.calls, killAll: sp.killAll };
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
  if (exp.screen && !re(exp.screen).test(`${r.screen}\n${r.detail ?? ''}`)) fails.push(`screen/phone !~ /${exp.screen}/`);
  if (exp.detail && !re(exp.detail).test(r.detail ?? '')) fails.push(`phone answer !~ /${exp.detail}/ (${r.detail ? 'got ' + r.detail.slice(0, 60) : 'none'})`);
  for (const w of exp.calls ?? []) if (!call(w)) fails.push(`no call ${w.tool}${w.args ? JSON.stringify(w.args) : ''}`);
  if (exp.callsAny && !exp.callsAny.some(call)) fails.push(`none of ${exp.callsAny.map((w) => w.tool).join('/')}`);
  if (exp.noCalls === 'any' && r.calls.length) fails.push(`unexpected calls ${r.calls.map((c) => c.tool)}`);
  if (Array.isArray(exp.noCalls)) for (const n of exp.noCalls) if (r.calls.some((c) => c.tool === n)) fails.push(`forbidden call ${n}`);
  if (exp.pending && r.pending?.tool !== exp.pending) fails.push(`pending ${r.pending?.tool ?? 'none'} ≠ ${exp.pending}`);
  if (exp.pendingArgs && !argsMatch(r.pending?.args, exp.pendingArgs)) fails.push(`pending args ${JSON.stringify(r.pending?.args)} !~ ${JSON.stringify(exp.pendingArgs)}`);
  if (exp.relayStarted === false && r.relayStarts.length) fails.push(`a helper was started (${r.relayStarts.map((t) => t.agent)})`);
  if (exp.relayStarted && typeof exp.relayStarted === 'object' && !r.relayStarts.some((s) => argsMatch(s, exp.relayStarted))) fails.push(`no helper start ${JSON.stringify(exp.relayStarted)}`);
  if (exp.spawnMsg && !r.spawns.some((s) => re(exp.spawnMsg).test(s.args.join(' ')))) fails.push(`no helper run received /${exp.spawnMsg}/`);
  if (exp.spawnNot && r.spawns.some((s) => re(exp.spawnNot).test(s.args.join(' ')))) fails.push(`a helper received /${exp.spawnNot}/ (forbidden)`);
  if (exp.needsDetail && !r.needsDetail) fails.push('needsDetail not set');
  if (exp.maxPhone != null && (speech.match(/phone/gi) ?? []).length > exp.maxPhone) fails.push('phone offered more than once');
  if (exp.routeIn && !exp.routeIn.includes(r.route)) fails.push(`route ${r.route} ∉ ${exp.routeIn}`);
  if (exp.noMemory && r.memoryOps.some((m) => /stored|reinforced|superseded/.test(m.op))) fails.push('a memory was written');
  return fails;
}

const pause = (ms) => new Promise((res) => setTimeout(res, ms));

async function runCase(c, rep) {
  const root = join(WORK, `${c.id}-${rep}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const world = fakeWorld(root, c.expect.helpers);
  const hands = createHands({ model: MODEL, baseUrl: BASE, tools: world.tools, auditLog: null, relay: world.relay });
  const reasoner = createOllamaReasoner({ baseUrl: BASE, fastModel: MODEL, smartModel: MODEL });
  const brain = await createBrain({ dbPath: join(root, 'brain.sqlite'), reasoner, hands });
  try {
    // helper tasks already going before the conversation (e.g. a build that's still running)
    for (const s of c.seed ?? []) { world.relay.start(s); await pause(200); }
    for (const s of c.setup ?? []) {
      if (typeof s === 'object' && s.wait) { await pause(s.wait); continue; }
      await brain.handle(s);
    }
    const before = world.calls.length;
    const tasksBefore = new Set(world.relay.tasks(100).map((t) => t.id));
    const spawnsBefore = world.spawns.length;
    const requestId = randomUUID();
    const t0 = Date.now();
    const { intent, v1, trace } = await brain.handle(c.prompt, { requestId });
    const needsDetail = intent.needsDetail === true || v1?.needsDetail === true;
    const detail = needsDetail && brain.detail ? await brain.detail({ requestId, text: c.prompt }).catch(() => null) : null;
    await pause(150);   // let a just-started fake helper play its first lines
    const r = {
      speech: v1?.speechText ?? intent.speech ?? '', screen: v1?.text ?? '', detail: detail ? String(detail) : null,
      needsDetail: needsDetail || /check your phone/i.test(v1?.speechText ?? ''),
      route: trace.route, reasoner: trace.reasoner, memoryOps: trace.memoryOps ?? [],
      calls: world.calls.slice(before), pending: hands.pending, ms: Date.now() - t0,
      relayStarts: world.relay.tasks(100).filter((t) => !tasksBefore.has(t.id)),
      spawns: world.spawns.slice(spawnsBefore),
    };
    return { ...r, fails: grade(c.expect, r) };
  } catch (err) {
    return { speech: '', calls: [], relayStarts: [], spawns: [], fails: [`error: ${err.message}`], ms: 0 };
  } finally {
    world.killAll();
    brain.close();
    await pause(50);
    rmSync(root, { recursive: true, force: true });
  }
}

const sha = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return '?'; } })();
const dirty = (() => { try { return execFileSync('git', ['status', '--porcelain', '--', 'src'], { encoding: 'utf8' }).trim() ? '+dirty' : ''; } catch { return ''; } })();
const selected = cases.filter((c) => !ONLY || ONLY.includes(c.id));
console.log(`Tamago agent eval · ${MODEL} · ${sha}${dirty} · ${selected.length} cases × ${REPS} runs\n`);
const results = [];
for (const c of selected) {
  const runs = [];
  for (let i = 0; i < REPS; i++) runs.push(await runCase(c, i));
  const passed = runs.filter((x) => !x.fails.length).length;
  results.push({ id: c.id, category: c.category, scenario: c.scenario, criteria: c.criteria, prompt: c.prompt, passed, runs });
  const mark = passed === REPS ? '✔' : passed ? '◐' : '✖';
  console.log(`${mark} ${c.id.padEnd(9)} ${passed}/${REPS}  ${c.scenario}`);
  for (const x of runs) if (x.fails.length) console.log(`      · “${x.speech.slice(0, 120)}” → ${x.fails.join('; ')}`);
}
const cats = [...new Set(results.map((r) => r.category))];
const rate = (rs) => Math.round((100 * rs.reduce((a, r) => a + r.passed, 0)) / (rs.length * REPS));
console.log('\nPass rate by category:');
for (const k of cats) console.log(`  ${k.padEnd(13)} ${rate(results.filter((r) => r.category === k))}%`);
console.log(`  ${'overall'.padEnd(13)} ${rate(results)}%`);
if (OUT) writeFileSync(OUT, JSON.stringify({ model: MODEL, commit: sha + dirty, date: new Date().toISOString(), reps: REPS,
  byCategory: Object.fromEntries(cats.map((k) => [k, rate(results.filter((r) => r.category === k))])), overall: rate(results), results }, null, 1));
