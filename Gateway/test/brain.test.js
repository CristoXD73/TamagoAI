// Tamago brain: unit + integration tests. No model, no network: the
// deterministic reasoner and stubbed Ollama replies stand in (UNIT_TESTED_ONLY).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrain } from '../src/brain/orchestrator.js';
import { classify } from '../src/brain/routing/intent-router.js';
import { chooseRoute } from '../src/brain/routing/model-router.js';
import { extractCandidates } from '../src/brain/memory/extractor.js';
import { gateCandidate } from '../src/brain/memory/gate.js';
import { composeSpeech } from '../src/brain/speech/composer.js';
import { validateIntent, toV1Result, makeIntent } from '../src/brain/response-schema.js';
import { stageFor } from '../src/brain/relationship/model.js';
import { buildContext, CONTEXT_BUDGET_CHARS } from '../src/brain/context-builder.js';
import { createOllamaReasoner } from '../src/brain/reasoners/ollama.js';
import { renderSystemPrompt } from '../src/brain/personality/profile.js';
import { buildOkResponse, validateResponse } from '../src/protocol.js';
import { ID } from './helpers.js';

const DAY = 86_400_000;
const T0 = new Date(2026, 8, 27, 10, 0, 0).getTime(); // 10:00 local

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'tamago-brain-'));
  return { path: join(dir, 'brain.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function clock(start = T0) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

// ---------------------------------------------------------------- the milestone
test('milestone: learns a fact, survives a restart, recalls it, thanks is nonverbal', async () => {
  const db = tmpDb();
  const now = clock();
  try {
    let brain = await createBrain({ dbPath: db.path, now });
    const taught = await brain.handle('Hey, my Jellyfin runs on this Mac.');
    assert.equal(taught.intent.speech, 'Got it.');
    assert.deepEqual(taught.trace.memoryOps.map((o) => o.op), ['stored']);
    brain.close();

    now.advance(60_000);
    brain = await createBrain({ dbPath: db.path, now }); // "restart process"
    const recalled = await brain.handle('Where does my Jellyfin run?');
    assert.equal(recalled.intent.speech, 'On this Mac.');
    assert.equal(recalled.trace.route, 'fast');

    const thanks = await brain.handle('Thanks.');
    assert.equal(thanks.intent.speech, null);
    assert.equal(thanks.trace.route, 'rule');
    assert.equal(thanks.v1.nonverbal, true);
    const env = buildOkResponse(ID(1), thanks.v1);
    assert.equal(env.text, '');
    assert.equal(env.speechText, '');
    assert.deepEqual(validateResponse(env), []);

    const trace = brain.lastTrace();
    for (const k of ['route', 'reasoner', 'intent', 'v1', 'relationshipAfter', 'steps']) assert.ok(k in trace, k);
    brain.close();
  } finally {
    db.cleanup();
  }
});

test('session: a pronoun borrows the last real topic ("it" = Jellyfin), across a "Thanks."', async () => {
  const db = tmpDb();
  try {
    const brain = await createBrain({ dbPath: db.path, now: clock() });
    await brain.handle('My Jellyfin runs on the NAS.');
    await brain.handle('Thanks.');
    const r = await brain.handle('Where does it run?');
    assert.deepEqual(r.trace.steps.find((s) => s.name === 'retrieve').focusKeywords.includes('jellyfin'), true);
    assert.equal(r.intent.speech, 'On the NAS.');
    brain.close();
  } finally {
    db.cleanup();
  }
});

test('session: idle timeout starts a new session and runs maintenance', async () => {
  const db = tmpDb();
  const now = clock();
  try {
    const brain = await createBrain({ dbPath: db.path, now });
    const a = await brain.handle('hi');
    now.advance(16 * 60_000);
    const b = await brain.handle('hi');
    const sa = a.trace.steps.find((s) => s.name === 'session');
    const sb = b.trace.steps.find((s) => s.name === 'session');
    assert.notEqual(sa.id, sb.id);
    assert.ok(b.trace.steps.some((s) => s.name === 'maintenance'));
    brain.close();
  } finally {
    db.cleanup();
  }
});

// ---------------------------------------------------------------- memory
test('memory: same fact reinforces, new value supersedes, secrets and off-the-record are refused', async () => {
  const db = tmpDb();
  try {
    const brain = await createBrain({ dbPath: db.path, now: clock() });
    await brain.handle('My Jellyfin runs on this Mac.');
    const again = await brain.handle('My Jellyfin runs on this Mac.');
    assert.equal(again.trace.memoryOps[0].op, 'reinforced');
    const moved = await brain.handle('My Jellyfin runs on the NAS now.');
    assert.equal(moved.trace.memoryOps[0].op, 'superseded');
    assert.equal(brain.memories().length, 1);
    assert.match(brain.memories()[0].text, /NAS/);

    const secret = await brain.handle('My wifi password is hunter2');
    assert.equal(secret.intent.speech, "I don't keep secrets like that.");
    assert.equal(secret.trace.memoryOps.length, 0);

    const offRecord = await brain.handle("My favorite color is teal, but don't remember that");
    assert.equal(offRecord.trace.memoryOps.length, 0);
    assert.equal(brain.memories().length, 1);
    brain.close();
  } finally {
    db.cleanup();
  }
});

test('memory: forget by voice removes matching memories (and their history)', async () => {
  const db = tmpDb();
  try {
    const brain = await createBrain({ dbPath: db.path, now: clock() });
    await brain.handle('My Jellyfin runs on this Mac.');
    await brain.handle('My Jellyfin runs on the NAS.');
    const f = await brain.handle('Forget what I told you about Jellyfin.');
    assert.equal(f.intent.speech, 'Okay. Forgotten.');
    assert.equal(brain.memories({ includeSuperseded: true }).length, 0);
    const r = await brain.handle('Where does my Jellyfin run?');
    assert.equal(r.intent.speech, "I don't know that yet.");
    brain.close();
  } finally {
    db.cleanup();
  }
});

test('memory: preferences always reach the context; retrieval is a handful, not the database', async () => {
  const db = tmpDb();
  try {
    const brain = await createBrain({ dbPath: db.path, now: clock() });
    await brain.handle('Always answer me briefly.');
    for (let i = 0; i < 12; i++) await brain.handle(`Remember that project ${i} uses the blue folder number ${i}`);
    const r = await brain.handle('What is an octopus?');
    const ret = r.trace.steps.find((s) => s.name === 'retrieve');
    assert.ok(ret.memories.some((m) => /short, direct/.test(m.text)));
    assert.ok(ret.memories.length <= 5);
    brain.close();
  } finally {
    db.cleanup();
  }
});

test('extractor + gate unit behavior', () => {
  assert.equal(extractCandidates('I ate pizza').length, 0);
  assert.equal(extractCandidates('Where does my Jellyfin run?', { isQuestion: true }).length, 0);
  const [pref] = extractCandidates('Always answer me briefly when I am on the Watch.');
  assert.equal(pref.key, 'owner|response_length');
  assert.equal(gateCandidate(pref).decision, 'accept');
  const [secret] = extractCandidates('My api key is sk-abcdefghijklmnopqrstuvwxyz123456');
  assert.equal(gateCandidate(secret).decision, 'discard');
  assert.equal(gateCandidate({ text: 'Owner likes tea a lot', type: 'semantic', confidence: 0.75, importance: 0.9, source: 'llm' }).decision, 'discard');
  assert.equal(gateCandidate({ text: 'Owner had a sandwich today', type: 'episodic', confidence: 0.95, importance: 0.4, source: 'llm' }).decision, 'discard');
});

// ---------------------------------------------------------------- relationship
test('relationship: familiarity grows by days, not volume, and never decreases', async () => {
  const db = tmpDb();
  const now = clock();
  try {
    const brain = await createBrain({ dbPath: db.path, now });
    for (let i = 0; i < 50; i++) await brain.handle('Thanks.');
    assert.equal(brain.relationship().stage, 'new', '50 interactions in one day do not buy familiarity');
    for (let d = 1; d <= 5; d++) {
      now.advance(DAY);
      await brain.handle('hi');
    }
    assert.equal(brain.relationship().stage, 'familiar');
    const before = brain.relationship().credits;
    now.advance(90 * DAY); // three months away
    assert.equal(brain.relationship().stage, 'familiar');
    assert.equal(brain.relationship().credits, before);
    brain.close();
  } finally {
    db.cleanup();
  }
  assert.equal(stageFor(0), 'new');
  assert.equal(stageFor(14), 'bonded');
});

test('behavior policy: greeting is watchful when new, verbal once acquainted; familiar learning is nonverbal', async () => {
  const db = tmpDb();
  const now = clock();
  try {
    const brain = await createBrain({ dbPath: db.path, now });
    const first = await brain.handle('Hi Tamago');
    assert.equal(first.intent.speech, null);
    assert.equal(first.intent.behavior, 'inspect_owner');
    for (let d = 1; d <= 6; d++) {
      now.advance(DAY);
      await brain.handle('hello');
    }
    const later = await brain.handle('Hey');
    assert.ok(later.intent.speech);
    const learned = await brain.handle('My name is Cristo.');
    assert.equal(learned.intent.speech, null, 'a familiar Tamago acknowledges without words');
    assert.equal(learned.trace.memoryOps[0].op, 'stored');
    brain.close();
  } finally {
    db.cleanup();
  }
});

// ---------------------------------------------------------------- routing / honesty
test('routing: taps of language that need no model never reach one', () => {
  for (const [text, kind, route] of [
    ['Thanks, buddy.', 'gratitude', 'rule'], ['ok', 'affirmation', 'rule'], ['Hi Tamago', 'greeting', 'rule'],
    ['Restart Jellyfin.', 'tool_request', 'rule'], ['Where does my Jellyfin run?', 'recall', 'fast'],
    ['Why is my Jellyfin transcoding so slowly?', 'recall', 'smart'], ['What is an octopus?', 'question', 'fast'],
  ]) {
    const c = classify(text);
    assert.equal(c.kind, kind, text);
    assert.equal(chooseRoute(c), route, text);
  }
});

test('tools are not faked before Brain E', async () => {
  const db = tmpDb();
  try {
    const brain = await createBrain({ dbPath: db.path, now: clock() });
    assert.equal((await brain.handle('Restart Jellyfin.')).intent.speech, "I can't do that yet.");
    assert.equal((await brain.handle('Is Jellyfin running?')).intent.speech, "I can't check that yet.");
    brain.close();
  } finally {
    db.cleanup();
  }
});

test('an aborted interaction commits nothing', async () => {
  const db = tmpDb();
  try {
    const slow = { name: 'slow', available: true, reason: (_, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) };
    const brain = await createBrain({ dbPath: db.path, now: clock(), reasoner: slow });
    const c = new AbortController();
    const p = brain.handle('What is an octopus?', { signal: c.signal });
    c.abort();
    await assert.rejects(p);
    assert.equal(brain.lastTrace(), null);
    assert.equal(brain.relationship().meaningfulInteractions, 0);
    brain.close();
  } finally {
    db.cleanup();
  }
});

// ---------------------------------------------------------------- schema / speech / context
test('intent schema validates, rejects unknown enums, and maps to V1 reaction states', () => {
  assert.equal(validateIntent({ speech: 'hi', emotion: 'ecstatic', haptic: 'none', behavior: 'none', followUpExpected: false }).ok, false);
  const ok = validateIntent({ speech: '  ', emotion: 'pleased', haptic: 'success', behavior: 'settle', followUpExpected: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.intent.speech, null, 'blank speech is silence');
  assert.equal(toV1Result(ok.intent).characterState, 'happy');
  assert.equal(toV1Result(makeIntent({ speech: 'Hmm.', emotion: 'uncertain' })).characterState, 'confused');
  assert.equal(toV1Result(makeIntent({ speech: 'x', emotion: 'concerned' })).characterState, 'error');
});

test('speech composer: short, spoken, never an assistant', () => {
  const r = composeSpeech('Great question! The **Jellyfin** server is running on port 8096 and looks healthy. It restarted at 3pm. ' +
    'Everything else is fine. Let me know if you need anything else! 😊');
  assert.doesNotMatch(r.speech, /great question|let me know|\*|😊/i);
  assert.ok(r.speech.length <= 140);
  assert.ok(r.speech.split(/[.!?]/).filter((s) => s.trim()).length <= 2);
  assert.equal(composeSpeech(null).speech, null);
  assert.equal(composeSpeech('As an AI, I am here to help.').speech, null, 'pure assistant filler becomes silence');
});

test('context builder stays within budget and system prompt is compact', () => {
  const turns = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'tamago' : 'owner', text: 'x'.repeat(300) }));
  const memories = Array.from({ length: 5 }, (_, i) => ({ id: i, text: `Memory ${i} ${'y'.repeat(200)}` }));
  const ctx = buildContext({
    text: 'What now?', cls: classify('What now?'), route: 'fast', memories, turns,
    relationship: { stage: 'familiar', daysKnown: 6, lastSeenAgoSec: 30 }, world: { timeOfDay: 'evening', localTime: '20:00', energy: 0.5 },
  });
  assert.ok(ctx.prompt.length <= CONTEXT_BUDGET_CHARS + 700);
  assert.ok(renderSystemPrompt().length < 1200);
});

// ---------------------------------------------------------------- Ollama reasoner (stubbed; UNVERIFIED_LOCAL_PROVIDER)
function ollamaStub(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [] }) };
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return { ok: true, status: 200, json: async () => ({ message: { content: typeof next === 'string' ? next : JSON.stringify(next) } }) };
  };
  return { fetchImpl, calls };
}

test('ollama reasoner: structured-output request, fast vs smart model routing', async () => {
  const { fetchImpl, calls } = ollamaStub([
    { speech: 'Octopuses have three hearts.', emotion: 'curious', haptic: 'none', behavior: 'perk_up', followUpExpected: false },
    { speech: 'Probably the transcoder.', emotion: 'focused', haptic: 'none', behavior: 'settle', followUpExpected: false },
  ]);
  const db = tmpDb();
  try {
    const reasoner = createOllamaReasoner({ fastModel: 'small', smartModel: 'big', fetchImpl });
    const brain = await createBrain({ dbPath: db.path, now: clock(), reasoner });
    const a = await brain.handle('What is an octopus?');
    assert.equal(a.intent.speech, 'Octopuses have three hearts.');
    const b = await brain.handle('Why is my Jellyfin transcoding so slowly?');
    assert.equal(b.trace.route, 'smart');
    const chats = calls.filter((c) => c.url.endsWith('/api/chat'));
    assert.equal(chats[0].body.model, 'small');
    assert.equal(chats[1].body.model, 'big');
    assert.equal(chats[0].body.stream, false);
    assert.equal(chats[0].body.format.type, 'object');
    assert.match(chats[0].body.messages[1].content, /OWNER SAYS: What is an octopus\?/);
    brain.close();
  } finally {
    db.cleanup();
  }
});

test('ollama reasoner: repairs invalid JSON once, and model memory proposals face the gate', async () => {
  const { fetchImpl, calls } = ollamaStub([
    'not json at all',
    { speech: 'Noted.', emotion: 'content', haptic: 'click', behavior: 'settle', followUpExpected: false,
      memoryCandidates: [
        { text: 'Owner is rebuilding TamagoAI in Blender', type: 'episodic', confidence: 0.9, importance: 0.8 },
        { text: 'Owner ate pizza', type: 'episodic', confidence: 0.9, importance: 0.2 },
      ] },
  ]);
  const db = tmpDb();
  try {
    const brain = await createBrain({ dbPath: db.path, now: clock(), reasoner: createOllamaReasoner({ fastModel: 'm', fetchImpl }) });
    const r = await brain.handle('Working on the Blender model tonight, ate pizza earlier');
    assert.equal(r.trace.steps.find((s) => s.name === 'reason').attempts, 2);
    assert.match(calls.at(-1).body.messages.at(-1).content, /Invalid reply/);
    assert.deepEqual(brain.memories().map((m) => m.text), ['Owner is rebuilding TamagoAI in Blender']);
    brain.close();
  } finally {
    db.cleanup();
  }
});

test('ollama reasoner: model down → honest offline fallback, not an invented answer', async () => {
  const { fetchImpl } = ollamaStub([new TypeError('fetch failed')]);
  const db = tmpDb();
  try {
    const brain = await createBrain({ dbPath: db.path, now: clock(), reasoner: createOllamaReasoner({ fastModel: 'm', fetchImpl }) });
    const r = await brain.handle('What is an octopus?');
    assert.match(r.trace.reasoner, /deterministic \(model unavailable\)/);
    assert.equal(r.intent.speech, "I don't know that yet.");
    brain.close();
  } finally {
    db.cleanup();
  }
});

test('ollama reasoner: invalid twice → structured provider_error (never raw model text to the Watch)', async () => {
  const { fetchImpl } = ollamaStub(['{"speech": 5}', 'still bad']);
  const db = tmpDb();
  try {
    const brain = await createBrain({ dbPath: db.path, now: clock(), reasoner: createOllamaReasoner({ fastModel: 'm', fetchImpl }) });
    await assert.rejects(brain.handle('What is an octopus?'), (e) => e.code === 'provider_error');
    brain.close();
  } finally {
    db.cleanup();
  }
});
