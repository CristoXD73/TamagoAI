// D-127 in the brain: the model flags an answer that needs more than two
// sentences (needsDetail); the gateway asks the same brain for the full answer
// in the background and puts it in the phone's conversation (PROTOCOL_V1 §18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateIntent, toV1Result } from '../src/brain/response-schema.js';
import { createOllamaReasoner } from '../src/brain/reasoners/ollama.js';
import { createDeterministicReasoner } from '../src/brain/reasoners/deterministic.js';
import { createBrainProvider } from '../src/brain/index.js';
import { renderDetailPrompt } from '../src/brain/personality/profile.js';
import { OFFER } from '../src/handoff.js';
import { startGateway, post, textRequest, ID, TOKEN } from './helpers.js';

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'tamago-long-'));
  return { path: join(dir, 'brain.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

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

const FULL = 'You need a starter, flour, water and salt.\n\n1. Mix and rest an hour.\n2. Fold every 30 minutes.\n3. Rise, shape, chill overnight.\n4. Bake hot in a covered pot.';

test('intent: needsDetail is optional, must be a boolean, and reaches the V1 result only when true', () => {
  const base = { speech: 'Hi.', emotion: 'content', haptic: 'none', behavior: 'none', followUpExpected: false };
  assert.equal(validateIntent(base).intent.needsDetail, false);
  assert.equal(validateIntent({ ...base, needsDetail: null }).ok, true);
  assert.deepEqual(validateIntent({ ...base, needsDetail: 'yes' }).errors, ['needsDetail must be a boolean']);
  const flagged = validateIntent({ ...base, needsDetail: true }).intent;
  assert.equal(toV1Result(flagged).needsDetail, true);
  assert.equal('needsDetail' in toV1Result(validateIntent(base).intent), false);
});

test('ollama detail(): plain text from the smart model, with the detail prompt and what it already said', async () => {
  const { fetchImpl, calls } = ollamaStub([`  ${FULL}  `, '   ']);
  const r = createOllamaReasoner({ fastModel: 'small', smartModel: 'big', fetchImpl });
  const text = await r.detail({ question: 'How do I make sourdough?', gist: 'It takes a starter and a day.', context: 'OWNER MEMORY\n- Owner bakes' });
  assert.equal(text, FULL);
  const body = calls[0].body;
  assert.equal(body.model, 'big');
  assert.equal(body.format, undefined, 'no JSON schema: this is prose for the phone');
  assert.equal(body.think, false);
  assert.equal(body.options.num_predict, 400);
  assert.equal(body.messages[0].content, renderDetailPrompt());
  assert.match(body.messages[1].content, /QUESTION: How do I make sourdough\?/);
  assert.match(body.messages[1].content, /YOU ALREADY SAID ALOUD: It takes a starter and a day\./);
  assert.match(body.messages[1].content, /Owner bakes/);
  await assert.rejects(r.detail({ question: 'q', gist: 'g' }), /Empty long answer/);
});

test('brain through the gateway: gist + offer on the Watch, the full answer lands in the conversation', async () => {
  const db = tmpDb();
  const { fetchImpl, calls } = ollamaStub([
    { speech: 'Sourdough takes a starter, flour, water, salt and about a day.', emotion: 'curious', haptic: 'none',
      behavior: 'perk_up', followUpExpected: false, needsDetail: true },
    FULL,
  ]);
  const provider = createBrainProvider({ dbPath: db.path, reasoner: createOllamaReasoner({ fastModel: 'small', smartModel: 'big', fetchImpl }) });
  const gw = await startGateway({ provider });
  try {
    const info = await (await fetch(`${gw.base}/v1/protocol`)).json();
    assert.deepEqual(info.features, ['conversation', 'long-answers']);

    const r = await post(gw.base, textRequest('How do I make sourdough bread at home?', ID(1), { client: { device: 'watch' } }));
    assert.equal(r.status, 200);
    assert.equal(r.body.speechText, `Sourdough takes a starter, flour, water, salt and about a day. ${OFFER}`);
    assert.equal(r.body.followUpExpected, true);
    assert.equal(r.body.longAnswer.status, 'pending');

    let turn;
    for (let i = 0; i < 100 && turn?.long?.status !== 'ready'; i++) {
      await new Promise((res) => setTimeout(res, 10));
      const page = await (await fetch(`${gw.base}/v1/conversation`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
      turn = page.turns[0];
    }
    assert.equal(turn.long.status, 'ready');
    assert.equal(turn.tamago, FULL);
    const detailCall = calls.filter((c) => c.url.endsWith('/api/chat'))[1];
    assert.match(detailCall.body.messages[1].content, /CONTEXT \(what you know\):[\s\S]*RELATIONSHIP/, 'the same context the reply used');
    assert.doesNotMatch(detailCall.body.messages[1].content, /OWNER SAYS/);
  } finally {
    await gw.close();
    await provider.close();
    db.cleanup();
  }
});

test('the deterministic brain offers no long answers', async () => {
  const db = tmpDb();
  const provider = createBrainProvider({ dbPath: db.path, reasoner: createDeterministicReasoner() });
  const gw = await startGateway({ provider });
  try {
    assert.equal(typeof provider.detail, 'undefined');
    const info = await (await fetch(`${gw.base}/v1/protocol`)).json();
    assert.deepEqual(info.features, ['conversation']);
  } finally {
    await gw.close();
    await provider.close();
    db.cleanup();
  }
});
