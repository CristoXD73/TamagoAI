// PROTOCOL_V1 §18 (the owner's iPhone conversation) and D-127 (long answers:
// the Watch speaks a gist and offers the rest; the full answer lands on the phone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGateway, post, textRequest, ID, TOKEN } from './helpers.js';
import { createMockProvider, MOCK_DETAIL } from '../src/providers/mock.js';
import { createConversation } from '../src/conversation.js';
import {
  OFFER, PHONE_OK, PHONE_SOON, STILL_WRITING, DETAIL_FAILED,
  classifyFollowUp, detailToSpeech, cleanDetail,
} from '../src/handoff.js';

const watch = { device: 'watch', route: 'direct' };
const phone = { device: 'phone', route: 'direct' };
const ask = (base, text, n, client = watch) => post(base, textRequest(text, ID(n), { client }));

async function feed(base, { after, token = TOKEN, method = 'GET' } = {}) {
  const q = after === undefined ? '' : `?after=${encodeURIComponent(after)}`;
  const res = await fetch(`${base}/v1/conversation${q}`, {
    method, headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json() };
}

async function until(fn, ms = 1500) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Mock provider whose detail() waits for a manual release (or never, for timeouts). */
function gatedProvider() {
  const base = createMockProvider();
  let release;
  const gate = new Promise((r) => { release = r; });
  return {
    release: () => release(),
    provider: {
      ...base,
      async detail(request, opts) {
        await gate;
        return base.detail(request, opts);
      },
    },
  };
}

test('conversation: needs the token; validates `after`; GET and DELETE only', async () => {
  const gw = await startGateway();
  try {
    assert.equal((await feed(gw.base, { token: null })).status, 401);
    assert.equal((await feed(gw.base, { token: 'wrong-token-000000000000' })).status, 401);
    for (const bad of ['-1', 'abc', '1.5', '9999999999999']) {
      const r = await feed(gw.base, { after: bad });
      assert.equal(r.status, 400, bad);
      assert.equal(r.body.error.code, 'invalid_request');
    }
    const r = await fetch(`${gw.base}/v1/conversation`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 405);
  } finally {
    await gw.close();
  }
});

test('conversation: records Watch and phone exchanges, once per requestId, and pages with `after`', async () => {
  const gw = await startGateway();
  try {
    await ask(gw.base, 'ping', 1);
    await ask(gw.base, 'ping', 1);               // retry: deduped, not recorded twice
    await ask(gw.base, 'hello there', 2, phone);
    const all = await feed(gw.base);
    assert.equal(all.status, 200);
    assert.equal(all.body.protocolVersion, 1);
    assert.equal(all.body.turns.length, 2);
    const [a, b] = all.body.turns;
    assert.deepEqual([a.from, a.you, a.tamago, a.said], ['watch', 'ping', 'pong', 'pong']);
    assert.deepEqual([b.from, b.you, b.tamago], ['phone', 'hello there', 'You said: hello there']);
    assert.equal(a.requestId, ID(1));
    assert.ok(!Number.isNaN(Date.parse(a.at)));
    assert.ok(b.seq > a.seq);

    const none = await feed(gw.base, { after: all.body.latest });
    assert.deepEqual(none.body.turns, []);
    await ask(gw.base, 'ping', 3);
    const next = await feed(gw.base, { after: all.body.latest });
    assert.deepEqual(next.body.turns.map((t) => t.requestId), [ID(3)]);
  } finally {
    await gw.close();
  }
});

test('conversation: errors are recorded with their code (no words from the error message)', async () => {
  const gw = await startGateway();
  try {
    await ask(gw.base, 'unavailable', 1);
    const [t] = (await feed(gw.base)).body.turns;
    assert.equal(t.error, 'provider_unavailable');
    assert.equal(t.tamago, '');
  } finally {
    await gw.close();
  }
});

test('conversation: DELETE clears it', async () => {
  const gw = await startGateway();
  try {
    await ask(gw.base, 'ping', 1);
    const cleared = await feed(gw.base, { method: 'DELETE' });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.cleared, true);
    assert.deepEqual((await feed(gw.base)).body.turns, []);
  } finally {
    await gw.close();
  }
});

test('conversation: null disables §18 and long answers', async () => {
  const gw = await startGateway({ conversation: null });
  try {
    assert.equal((await feed(gw.base)).status, 404);
    const r = await ask(gw.base, 'long', 1);
    assert.equal(r.body.longAnswer, undefined);
    assert.equal(r.body.speechText, r.body.text, 'no offer without a phone to send it to');
    const info = await (await fetch(`${gw.base}/v1/protocol`)).json();
    assert.deepEqual(info.features, []);
  } finally {
    await gw.close();
  }
});

test('long answer (Watch): gist + offer right away, follow-up expected; the full answer lands on the phone', async () => {
  const g = gatedProvider();
  const gw = await startGateway({ provider: g.provider });
  try {
    const started = Date.now();
    const r = await ask(gw.base, 'long', 1);
    assert.ok(Date.now() - started < 500, 'the reply never waits for the long answer');
    assert.equal(r.status, 200);
    assert.equal(r.body.text, 'Sourdough needs a starter, flour, water and salt, and about a day.');
    assert.equal(r.body.speechText, `${r.body.text} ${OFFER}`);
    assert.equal(r.body.followUpExpected, true);
    assert.equal(r.body.longAnswer.status, 'pending');

    const first = await feed(gw.base);
    const t = first.body.turns[0];
    assert.equal(t.seq, r.body.longAnswer.seq);
    assert.deepEqual(t.long, { status: 'pending' });
    assert.equal(t.said, r.body.speechText);

    g.release();
    const changed = await until(async () => (await feed(gw.base, { after: first.body.latest })).body.turns[0]);
    assert.equal(changed.seq, t.seq, 'same turn, updated');
    assert.ok(changed.rev > first.body.latest, 'a phone that paged past it sees it again');
    assert.deepEqual(changed.long, { status: 'ready' });
    assert.equal(changed.tamago, MOCK_DETAIL);
  } finally {
    await gw.close();
  }
});

test('long answer (phone): no spoken offer, the gist now and the full text in the conversation', async () => {
  const gw = await startGateway();
  try {
    const r = await ask(gw.base, 'long', 1, phone);
    assert.equal(r.body.speechText, r.body.text);
    assert.equal(r.body.followUpExpected, false);
    assert.equal(r.body.longAnswer.status, 'pending');
    const t = await until(async () => (await feed(gw.base)).body.turns.find((x) => x.long?.status === 'ready'));
    assert.equal(t.from, 'phone');
    assert.equal(t.tamago, MOCK_DETAIL);
  } finally {
    await gw.close();
  }
});

test('"say it all": the Watch reads the full answer in its own voice (too long for one Mac synthesis)', async () => {
  const synthesized = [];
  const synthesizer = { engine: 'kokoro', voice: 'af_heart', async synthesize(text) { synthesized.push(text); return Buffer.from('m4a'); }, async check() { return { ok: true }; } };
  const gw = await startGateway({ synthesizer });
  try {
    const offer = await ask(gw.base, 'long', 1);
    assert.ok(offer.body.speechAudio, 'gist + offer fits one synthesis');
    await until(async () => (await feed(gw.base)).body.turns[0].long.status === 'ready');
    const r = await ask(gw.base, 'Say it all.', 2);
    assert.equal(r.status, 200);
    assert.equal(r.body.speechText, detailToSpeech(MOCK_DETAIL));
    assert.ok(r.body.speechText.includes('Feed your starter the night before.'));
    assert.ok(!/^\s*\d\./m.test(r.body.speechText), 'no list numbers read aloud');
    assert.equal(r.body.text, MOCK_DETAIL);
    assert.equal(r.body.speechAudio, undefined, 'no Mac audio that would stop halfway');
    assert.equal(synthesized.length, 1);
    const note = (await feed(gw.base)).body.turns.at(-1);
    assert.deepEqual([note.note, note.about, note.you], ['read_aloud', offer.body.longAnswer.seq, 'Say it all.']);
  } finally {
    await gw.close();
  }
});

test('"say it all" while it is still being written: waits within the timeout, else says it is coming', async () => {
  const g = gatedProvider();
  const gw = await startGateway({ provider: g.provider, timeoutMs: 1600 });
  try {
    await ask(gw.base, 'long', 1);
    setTimeout(() => g.release(), 50);
    const r = await ask(gw.base, 'yes', 2);
    assert.equal(r.body.text, MOCK_DETAIL, 'waited for the long answer');

    const g2 = gatedProvider();
    const gw2 = await startGateway({ provider: g2.provider, timeoutMs: 1600 });
    try {
      await ask(gw2.base, 'long', 1);
      const started = Date.now();
      const late = await ask(gw2.base, 'read it to me', 2);
      assert.equal(late.body.text, STILL_WRITING);
      assert.ok(Date.now() - started < 1600, 'answered inside the request timeout');
    } finally {
      g2.release();
      await gw2.close();
    }
  } finally {
    await gw.close();
  }
});

test('"check my phone": acknowledges, and knows whether it is there yet', async () => {
  const g = gatedProvider();
  const gw = await startGateway({ provider: g.provider });
  try {
    await ask(gw.base, 'long', 1);
    assert.equal((await ask(gw.base, 'phone', 2)).body.text, PHONE_SOON);
    g.release();
    await until(async () => (await feed(gw.base)).body.turns[0].long.status === 'ready');
    await ask(gw.base, 'long', 3);
    await until(async () => (await feed(gw.base)).body.turns.find((t) => t.requestId === ID(3)).long.status === 'ready');
    const r = await ask(gw.base, "No thanks, I'll check my phone later", 4);
    assert.equal(r.body.text, "You said: No thanks, I'll check my phone later", 'long sentences are new questions');
    await ask(gw.base, 'long', 5);
    await until(async () => (await feed(gw.base)).body.turns.find((t) => t.requestId === ID(5)).long.status === 'ready');
    assert.equal((await ask(gw.base, 'Check my phone.', 6)).body.text, PHONE_OK);
  } finally {
    g.release();
    await gw.close();
  }
});

test('the offer ends: a new question, a used answer, or the phone asking does not consume it', async () => {
  const gw = await startGateway();
  try {
    await ask(gw.base, 'long', 1);
    assert.equal((await ask(gw.base, 'yes', 2, phone)).body.text, 'You said: yes', "the phone's words aren't an answer to the Watch");
    await ask(gw.base, 'ping', 3);                          // new question from the Watch: offer over
    assert.equal((await ask(gw.base, 'say it all', 4)).body.text, 'You said: say it all');

    await ask(gw.base, 'long', 5);
    await until(async () => (await feed(gw.base)).body.turns.find((t) => t.requestId === ID(5)).long.status === 'ready');
    assert.equal((await ask(gw.base, 'say it all', 6)).body.text, MOCK_DETAIL);
    assert.equal((await ask(gw.base, 'say it all', 7)).body.text, 'You said: say it all', 'answered once');
  } finally {
    await gw.close();
  }
});

test('a failed long answer: the turn says so, and "say it all" admits it', async () => {
  const gw = await startGateway();
  try {
    await ask(gw.base, 'long fail', 1);
    await until(async () => (await feed(gw.base)).body.turns[0].long.status === 'failed');
    assert.equal((await ask(gw.base, 'say it all', 2)).body.text, DETAIL_FAILED);
  } finally {
    await gw.close();
  }
});

test('voice questions are recorded with what the Mac heard', async () => {
  const transcriber = { name: 'stub', async transcribe() { return 'ping'; } };
  const gw = await startGateway({ transcriber });
  try {
    const r = await fetch(`${gw.base}/v1/audio`, {
      method: 'POST',
      headers: { 'content-type': 'audio/mp4', 'x-tamago-request-id': ID(1), authorization: `Bearer ${TOKEN}` },
      body: Buffer.from('m4a'),
    });
    assert.equal(r.status, 200);
    const [t] = (await feed(gw.base)).body.turns;
    assert.deepEqual([t.from, t.you, t.tamago], ['watch', 'ping', 'pong']);
  } finally {
    await gw.close();
  }
});

test('logs never contain the owner\'s words or the long answer', async () => {
  const lines = [];
  const logger = { info: (o) => lines.push(o), warn: (o) => lines.push(o), error: (o) => lines.push(o) };
  const gw = await startGateway({ logger });
  try {
    await ask(gw.base, 'long', 1);
    await until(async () => (await feed(gw.base)).body.turns[0].long.status === 'ready');
    await ask(gw.base, 'say it all', 2);
    await feed(gw.base);
    const text = JSON.stringify(lines);
    for (const words of ['Sourdough', 'starter', 'say it all', 'Feed your']) assert.ok(!text.includes(words), words);
    assert.ok(lines.some((l) => l.event === 'long_answer' && l.status === 'ready'));
  } finally {
    await gw.close();
  }
});

test('/v1/protocol lists the features', async () => {
  const gw = await startGateway();
  try {
    const info = await (await fetch(`${gw.base}/v1/protocol`)).json();
    assert.deepEqual(info.features, ['conversation', 'long-answers']);
  } finally {
    await gw.close();
  }
});

test('conversation store: bounded by count and age; updates bump `rev`', () => {
  let t = 0;
  const c = createConversation({ now: () => t, maxTurns: 3, maxAgeMs: 1000 });
  for (let i = 1; i <= 5; i++) c.add({ requestId: ID(i), from: 'watch', heard: `q${i}`, reply: 'a', said: 'a' });
  assert.deepEqual(c.page().turns.map((x) => x.you), ['q3', 'q4', 'q5']);
  const { latest } = c.page();
  assert.equal(c.update(5, { tamago: 'b' }), true);
  const changed = c.page(latest).turns;
  assert.deepEqual(changed.map((x) => [x.seq, x.tamago]), [[5, 'b']]);
  assert.equal(c.update(999, {}), false);
  t = 5000;
  assert.deepEqual(c.page().turns, [], 'older than a day (here: 1 s) is gone');
  c.add({ requestId: ID(9), from: 'tv', heard: 'x', reply: 'y', said: 'y' });
  assert.equal(c.page().turns[0].from, 'watch', 'unknown devices count as the Watch');
});

test('handoff: follow-up phrases, spoken form, clean-up', () => {
  for (const s of ['yes', 'Yes.', 'Say it all', 'say it', 'read it to me', 'tell me everything', 'go ahead', 'okay, say it all please', 'all of it']) {
    assert.equal(classifyFollowUp(s), 'read_all', s);
  }
  for (const s of ['no', 'No thanks.', 'phone', 'my phone', 'check my phone', "I'll check it later", 'later', 'not now', 'send it to my phone']) {
    assert.equal(classifyFollowUp(s), 'phone', s);
  }
  for (const s of ['what is sourdough', 'yes I want pizza', 'tell me a joke', '', 'no way that is true']) {
    assert.equal(classifyFollowUp(s), null, s);
  }
  assert.equal(detailToSpeech('# Steps\n- Mix it\n- Bake it.\n\n1. Eat'), 'Steps Mix it. Bake it. Eat.');
  assert.equal(cleanDetail('Hi 🐙\n\n\n\nthere'), 'Hi \n\nthere');
  const long = cleanDetail('word. '.repeat(400), 100);
  assert.ok(long.length <= 101 && long.endsWith('…'));
});
