// Tamago's hands (D-128, docs/TAMAGO_HANDS.md): the tools, the Ollama tool loop, spoken confirmation, the
// router and the brain hook. A stubbed exec and a stubbed model: nothing runs on the Mac in these tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTools, matchApp, toolSchemas } from '../src/hands/tools.js';
import { createHands } from '../src/hands/agent.js';
import { classify } from '../src/brain/routing/intent-router.js';
import { chooseRoute } from '../src/brain/routing/model-router.js';
import { createBrain } from '../src/brain/orchestrator.js';

const APPS = [{ name: 'Steam', path: '/Applications/Steam.app' }, { name: 'Calculator', path: '/System/Applications/Calculator.app' },
  { name: 'Dolphin', path: '/Applications/Dolphin.app' }, { name: 'Safari', path: '/Applications/Safari.app' }];

function fakeExec(outputs = {}) {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    const key = Object.keys(outputs).find((k) => [file, ...args].join(' ').includes(k));
    return { code: 0, out: key ? outputs[key] : '', err: '' };
  };
  return { exec, calls };
}

/** A model that replays scripted replies: each is { tool: [name, args] } or { say: 'text' }. */
function scriptedModel(script) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body);
    const next = script.shift() ?? { say: 'Done.' };
    const message = next.tool
      ? { role: 'assistant', content: '', tool_calls: [{ function: { name: next.tool[0], arguments: next.tool[1] } }] }
      : { role: 'assistant', content: next.say };
    return { ok: true, json: async () => ({ message }) };
  };
  return { fetchImpl, seen };
}

test('tools: app names match loosely but only installed apps; arguments are validated', async () => {
  assert.equal(matchApp('steam', APPS).name, 'Steam');
  assert.equal(matchApp('the calculator app', APPS).name, 'Calculator');
  assert.equal(matchApp('dolphin emulator', APPS).name, 'Dolphin');
  assert.equal(matchApp('photoshop', APPS), null);

  const { exec, calls } = fakeExec();
  const tools = createTools({ exec, apps: () => APPS });
  assert.equal((await tools.open_app.run({ name: 'steam' })).ok, true);
  assert.deepEqual(calls.at(-1), ['/usr/bin/open', '-a', '/Applications/Steam.app']);
  assert.equal((await tools.open_app.run({ name: 'photoshop' })).ok, false);

  await tools.set_volume.run({ percent: 250 });
  assert.deepEqual(calls.at(-1), ['/usr/bin/osascript', '-e', 'set volume output volume 100'], 'clamped to 100');
  assert.equal((await tools.open_url.run({ url: 'file:///etc/passwd' })).ok, false, 'only http(s) links');
  assert.equal((await tools.open_url.run({ url: 'https://example.com; rm -rf ~' })).ok, false, 'no spaces or shell tricks');
  assert.equal((await tools.find_files.run({ query: 'a' })).ok, false, 'too-short searches refused');

  // Every tool's schema is well-formed for Ollama, and only quitting and Shortcuts need a "yes".
  const schemas = toolSchemas(tools);
  assert.ok(schemas.every((s) => s.type === 'function' && s.function.parameters.type === 'object'));
  assert.deepEqual(Object.values(tools).filter((t) => t.risk === 'confirm').map((t) => t.name).sort(), ['quit_app', 'run_shortcut']);
  for (const banned of ['delete', 'trash', 'sudo', 'install', 'send', 'shell', 'run_command']) {
    assert.ok(!Object.keys(tools).some((n) => n.includes(banned)), `no ${banned} tool`);
  }
});

test('hands: a safe tool runs, the model sees the result and answers; every call is audited', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hands-'));
  try {
    const { exec, calls } = fakeExec();
    const model = scriptedModel([{ tool: ['set_volume', { percent: 30 }] }, { say: 'Volume is at 30 now.' }]);
    const hands = createHands({ model: 'm', tools: createTools({ exec, apps: () => APPS }), fetchImpl: model.fetchImpl, auditLog: join(dir, 'hands.log') });
    const out = await hands.handle('set the volume to 30', classify('set the volume to 30'));
    assert.equal(out.speech, 'Volume is at 30 now.');
    assert.deepEqual(calls[0], ['/usr/bin/osascript', '-e', 'set volume output volume 30']);
    assert.equal(model.seen[0].think, false, 'no hidden thinking');
    assert.ok(model.seen[0].tools.length >= 10, 'the model is offered the tools');
    assert.equal(model.seen[1].messages.at(-1).role, 'tool', 'the tool result goes back to the model');
    const log = readFileSync(join(dir, 'hands.log'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual([log[0].tool, log[0].how, log[0].ok], ['set_volume', 'auto', true]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hands: risky tools wait for a spoken yes; no, or a new request, drops them', async () => {
  const { exec, calls } = fakeExec({ '/bin/ps': '/Applications/Safari.app/Contents/MacOS/Safari\n' });
  const tools = createTools({ exec, apps: () => APPS });
  let t = 0;
  const now = () => t;
  const model = scriptedModel([{ tool: ['quit_app', { name: 'Safari' }] }, { tool: ['quit_app', { name: 'Safari' }] }, { tool: ['quit_app', { name: 'Safari' }] }]);
  const hands = createHands({ model: 'm', tools, fetchImpl: model.fetchImpl, now });

  const ask = await hands.handle('quit safari', classify('quit safari'));
  assert.equal(ask.speech, 'Quit Safari? Say yes to go.');
  assert.equal(ask.followUpExpected, true);
  assert.equal(calls.length, 0, 'nothing ran before the yes');
  const done = await hands.handle('yes', classify('yes'));
  assert.equal(done.speech, 'Safari is closing.');
  assert.deepEqual(calls.at(-1), ['/usr/bin/osascript', '-e', 'quit app "Safari"']);

  await hands.handle('quit safari', classify('quit safari'));
  const no = await hands.handle('no', classify('no'));
  assert.equal(no.speech, "Okay. I won't.");
  assert.equal(calls.filter((c) => c[1] === '-e' && c[2].startsWith('quit')).length, 1, 'declined: not run');

  await hands.handle('quit safari', classify('quit safari'));
  t += 61_000;
  assert.equal(hands.pending, null, 'a confirmation expires after 60 s');
  // Review round 2 (X3): a late yes is still about that confirmation: it runs nothing and says it timed out.
  assert.equal((await hands.handle('yes', classify('yes'))).speech, "That one timed out, so I didn't do it. Ask me again.");
  assert.equal(calls.filter((c) => c[1] === '-e' && c[2].startsWith('quit')).length, 1, 'a late yes runs nothing');
});

test('hands: unknown tools are refused; a runaway loop stops after 4 steps; conversation passes through', async () => {
  const { exec } = fakeExec();
  const model = scriptedModel([{ tool: ['run_command', { cmd: 'rm -rf ~' }] }, { say: "I can't do that." }]);
  const hands = createHands({ model: 'm', tools: createTools({ exec, apps: () => APPS }), fetchImpl: model.fetchImpl });
  const out = await hands.handle('open steam', classify('open steam'));
  assert.equal(out.speech, "I can't do that.");
  assert.match(model.seen[1].messages.at(-1).content, /no tool called run_command/);

  const loop = scriptedModel(Array.from({ length: 10 }, () => ({ tool: ['running_apps', {}] })));
  const busy = createHands({ model: 'm', tools: createTools({ exec, apps: () => APPS }), fetchImpl: loop.fetchImpl });
  await busy.handle('what apps are open', classify('what apps are open'));
  assert.equal(loop.seen.length, 4, 'at most 4 model turns');

  assert.equal(await hands.handle('how are you?', classify('how are you?')), null, 'small talk is not for the hands');
});

test('router: Mac commands go to the hands; talk and old tool requests do not', () => {
  for (const t of ['Open Steam', 'Tamago, open Steam', 'turn the volume down', 'set the volume to 30', 'mute',
    "what's using my memory?", 'how much space is left?', 'lock the screen', 'find my resume', 'what apps are open?',
    'start game mode', 'run my movie night shortcut', 'quit Safari', 'is it plugged in?']) {
    const c = classify(t);
    assert.equal(c.kind, 'hands', t);
    assert.equal(chooseRoute(c), 'rule', `${t}: no conversation model`);
  }
  for (const t of ['How are you today?', 'What is an octopus?', 'My dog is named Pixel.', 'Thanks.']) {
    assert.notEqual(classify(t).kind, 'hands', t);
  }
  assert.equal(classify('Restart Jellyfin.').kind, 'tool_request');
});

test('brain: the hands answer commands; with no hands the honest rule answer stays', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hands-brain-'));
  try {
    const fakeHands = { pending: null, handle: async (text, cls) => (cls.kind === 'hands' ? { speech: 'Steam is opening.', emotion: 'content', behavior: 'settle', steps: [{ tool: 'open_app' }] } : null) };
    const brain = await createBrain({ dbPath: join(dir, 'b.sqlite'), hands: fakeHands });
    const r = await brain.handle('open steam');
    assert.equal(r.intent.speech, 'Steam is opening.');
    assert.equal(r.trace.route, 'hands');
    assert.notEqual((await brain.handle('how are you?')).trace.route, 'hands');
    brain.close();

    const plain = await createBrain({ dbPath: join(dir, 'c.sqlite') });
    assert.equal((await plain.handle('open steam')).intent.speech, "I can't do that yet.");
    plain.close();

    const broken = await createBrain({ dbPath: join(dir, 'd.sqlite'), hands: { pending: null, handle: async () => { throw new Error('Ollama HTTP 500'); } } });
    assert.equal((await broken.handle('open steam')).intent.speech, "My hands aren't answering right now.");
    broken.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
