// Relay R2 (D-129): Tamago hands work to Claude Code / Codex. Fake agent processes that print the real stream formats
// recorded in the R0 spike (docs/relay/R0_SPIKE.md); a real git repository in a temp folder for the worktree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay, readEnding, codexUsage } from '../src/relay/relay.js';
import { createTools, describeUsage } from '../src/hands/tools.js';
import { classify } from '../src/brain/routing/intent-router.js';

function repo(root) {
  const p = join(root, 'proj');
  mkdirSync(p);
  const g = (...a) => execFileSync('git', a, { cwd: p });
  g('init', '-q', '-b', 'main'); writeFileSync(join(p, 'a.txt'), 'a\n');
  g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return p;
}

/** spawn() stand-in: records the call and plays the given stdout lines, then exits. */
function fakeSpawn(scripts) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', 143)); };
    const lines = scripts.shift() ?? [];
    setImmediate(() => { for (const l of lines) child.stdout.emit('data', JSON.stringify(l) + '\n'); child.emit('close', 0); });
    return child;
  };
  return { spawn, calls };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test('endings: ASK_OWNER and DONE lines are read from the end of a reply', () => {
  assert.deepEqual(readEnding('Needs your input.\nASK_OWNER: Rename calc.py to what? | arithmetic.py | math_ops.py'),
    { kind: 'question', question: 'Rename calc.py to what?', options: ['arithmetic.py', 'math_ops.py'] });
  assert.deepEqual(readEnding('Fixed it.\n\nDONE: Fixed add() and ran the test.'), { kind: 'done', summary: 'Fixed add() and ran the test.' });
  assert.equal(readEnding('I did some things').kind, 'unclear');
});

test('relay: a Claude task runs on its own branch in a worktree, records usage, and finishes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-'));
  try {
    const proj = repo(root);
    const f = fakeSpawn([[
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', unifiedWindows: { five_hour: { utilization: 0.65, resetsAt: 1790517600 }, seven_day: { utilization: 0.58, resetsAt: 1790956800 } } } },
      { type: 'result', subtype: 'success', result: 'Fixed.\nDONE: Fixed add() so the test passes.' },
    ]]);
    const relay = createRelay({ stateDir: join(root, 'state'), relayDir: join(root, 'relay'), projects: { Sandbox: proj }, spawn: f.spawn });
    const t = relay.start({ agent: 'claude', project: 'sandbox', text: 'fix the failing test' });
    assert.match(t.branch, /^tamago\/fix-the-failing-test-/);
    assert.ok(t.cwd.startsWith(join(root, 'relay', 'worktrees')), 'never the project checkout itself');
    assert.ok(existsSync(join(t.cwd, 'a.txt')), 'the worktree has the project files');
    const call = f.calls[0];
    assert.equal(call.bin, 'claude');
    assert.ok(call.args.includes('--permission-mode') && call.args.includes('acceptEdits'));
    assert.ok(!call.args.some((a) => /dangerously|skip-permissions/.test(a)), 'never skips permissions');
    assert.equal(call.opts.env.CLAUDECODE, undefined, 'a clean environment');
    await settle();
    const done = relay.tasks(1)[0];
    assert.deepEqual([done.state, done.result, done.session], ['done', 'Fixed add() so the test passes.', 'sess-1']);
    const u = relay.usage().claude;
    assert.deepEqual([u.fiveHour.usedPct, u.weekly.usedPct], [65, 58]);
    assert.match(describeUsage('Claude', u, Date.parse(u.asOf)), /Claude: 35% of its five-hour window left .*42% of the week left/);
    assert.throws(() => relay.start({ agent: 'claude', project: 'Photoshop', text: 'x' }), /isn't one of your projects/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('relay: a question waits for the owner, the answer resumes the same session; stop works', async () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-'));
  try {
    const proj = repo(root);
    const f = fakeSpawn([
      [{ type: 'system', session_id: 'sess-2' }, { type: 'result', result: 'ASK_OWNER: Which name? | arithmetic.py | math_ops.py' }],
      [{ type: 'system', session_id: 'sess-2' }, { type: 'result', result: 'DONE: Renamed to math_ops.py.' }],
    ]);
    const relay = createRelay({ stateDir: join(root, 'state'), relayDir: join(root, 'relay'), projects: { Sandbox: proj }, spawn: f.spawn });
    relay.start({ agent: 'claude', project: 'Sandbox', text: 'rename calc.py' });
    await settle();
    let t = relay.tasks(1)[0];
    assert.deepEqual([t.state, t.question, t.options], ['question', 'Which name?', ['arithmetic.py', 'math_ops.py']]);
    assert.throws(() => relay.start({ agent: 'claude', project: 'Sandbox', text: 'something else' }), /already has a task/);
    relay.answer('the second one');
    assert.deepEqual(f.calls[1].args.slice(-2), ['--resume', 'sess-2']);
    assert.match(f.calls[1].args[1], /Owner answered by voice: the second one/);
    await settle();
    t = relay.tasks(1)[0];
    assert.deepEqual([t.state, t.result], ['done', 'Renamed to math_ops.py.']);
    assert.equal(relay.stop(), null, 'nothing left to stop');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('relay: Codex runs sandboxed and its work is committed by the relay; ChatGPT only answers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'relay-'));
  try {
    const proj = repo(root);
    const f = fakeSpawn([
      [{ type: 'thread.started', thread_id: 'th-1' }, { type: 'item.completed', item: { type: 'agent_message', text: 'DONE: Added a README line.' } }],
      [{ type: 'item.completed', item: { type: 'agent_message', text: 'arithmetic.py is clearer.' } }],
    ]);
    const relay = createRelay({ stateDir: join(root, 'state'), relayDir: join(root, 'relay'), projects: { Sandbox: proj }, spawn: f.spawn });
    const t = relay.start({ agent: 'codex', project: 'Sandbox', text: 'add a readme line' });
    assert.deepEqual(f.calls[0].args.slice(0, 2), ['exec', '--json']);
    assert.ok(f.calls[0].args.includes('workspace-write'));
    writeFileSync(join(t.cwd, 'README.md'), 'hello\n');   // what Codex "did"
    await settle();
    assert.equal(relay.tasks(1)[0].state, 'done');
    assert.match(execFileSync('git', ['log', '--oneline', '-1'], { cwd: t.cwd, encoding: 'utf8' }), /Added a README line/);

    const q = relay.start({ agent: 'chatgpt', project: 'Sandbox', text: 'which module name is clearer?' });
    assert.equal(q.branch, null, 'answer-only: no branch');
    assert.ok(f.calls[1].args.includes('read-only'));
    await settle();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('relay tools: start waits for a yes; status, answer and usage speak plainly; router sends helper talk to the hands', async () => {
  const relay = {
    projects: () => ['TamaWatch', 'Sandbox'], matchProject: (p) => p,
    start: ({ agent, project }) => ({ agent, project, branch: 'tamago/x' }),
    tasks: () => [{ agent: 'claude', state: 'question', question: 'Which name?', options: ['a', 'b'], text: 'rename', startedAt: new Date().toISOString() }],
    answer: () => ({ agent: 'claude' }), stop: () => null,
    usage: () => ({ claude: null, codex: { fiveHour: { usedPct: 97, resetsAt: null }, weekly: { usedPct: 37 }, asOf: new Date().toISOString() } }),
  };
  const tools = createTools({ relay });
  assert.equal(tools.relay_start.risk, 'confirm');
  assert.equal(tools.relay_start.confirmText({ agent: 'claude', project: 'TamaWatch', task: 'fix the widget' }), 'Claude, TamaWatch: fix the widget.');
  assert.match((await tools.relay_status.run({})).say, /Claude asks: Which name\? Options: a or b/);
  assert.match((await tools.helpers_usage.run({})).say, /I haven't seen Claude's numbers yet.*Codex \(and ChatGPT\): 3% of its five-hour window left/);
  for (const t of ['Tell Claude to fix the widget on TamaWatch', 'can you talk to claude for me?', "what's codex doing?", 'ask chat gpt why the sky is blue', 'how much claude do I have left?']) {
    assert.equal(classify(t).kind, 'hands', t);
  }
  // Owner, 2026-10-01: "Can you build me a game that runs on terminal" got "I cannot build software".
  for (const t of ['Can you build me a game that runs on terminal. Agario like', 'write me a python script that renames photos', 'fix the bug in my app']) {
    assert.equal(classify(t).kind, 'hands', t);
  }
  for (const t of ['how do I make pasta', 'What can you do?', 'What is the capital of France?']) {
    assert.notEqual(classify(t).kind, 'hands', t);
  }
});

test('codex usage is read from its session files without running anything', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-'));
  try {
    const d = join(root, '2026', '09', '28'); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'rollout-x.jsonl'), JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 40, window_minutes: 300, resets_at: 1790531384 }, secondary: { used_percent: 12 } } } }) + '\n');
    const u = codexUsage(root);
    assert.deepEqual([u.fiveHour.usedPct, u.weekly.usedPct], [40, 12]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('hands: while a helper waits for an answer, a plain reply goes to it by rule (never a model claim)', async () => {
  const { createHands } = await import('../src/hands/agent.js');
  const answered = [];
  const relay = { tasks: () => [{ agent: 'claude', state: 'question', question: 'Which name?', updatedAt: new Date().toISOString() }],
    answer: (a) => { answered.push(a); return { agent: 'claude' }; } };
  const hands = createHands({ model: 'm', relay, tools: {}, fetchImpl: async () => { throw new Error('no model call expected'); } });
  const out = await hands.handle('call it say_hello', classify('call it say_hello'));
  assert.equal(out.speech, 'Told Claude: call it say_hello.');
  assert.deepEqual(answered, ['call it say_hello']);
  assert.equal(await hands.handle('how are you?', classify('how are you?')), null, 'a question is not an answer');
});
