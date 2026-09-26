import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockProvider } from '../src/providers/mock.js';
import { ProviderError } from '../src/providers/provider.js';

const mock = createMockProvider();
const gen = (text, opts) => mock.generate({ text }, opts);

test('ping -> pong', async () => {
  assert.deepEqual(await gen('ping'), { text: 'pong', characterState: 'idle', haptic: 'click' });
  assert.deepEqual(await gen('  PING '), await gen('ping'));
});

test('state <reaction> sets characterState deterministically', async () => {
  for (const s of ['idle', 'happy', 'success', 'confused']) {
    const r = await gen(`state ${s}`);
    assert.equal(r.characterState, s);
    assert.deepEqual(r, await gen(`state ${s}`));
  }
  assert.equal((await gen('state dancing')).characterState, 'confused');
});

test('state error throws a structured provider_error', async () => {
  await assert.rejects(gen('state error'), (e) => e instanceof ProviderError && e.code === 'provider_error');
});

test('tool, follow up, echo', async () => {
  const tool = await gen('tool jellyfin');
  assert.equal(tool.characterState, 'success');
  assert.equal(tool.text, 'Jellyfin is back online.');
  assert.equal((await gen('follow up')).followUpExpected, true);
  assert.equal((await gen('Hello there')).text, 'You said: Hello there');
});

test('unavailable and throw', async () => {
  await assert.rejects(gen('unavailable'), (e) => e.code === 'provider_unavailable');
  await assert.rejects(gen('throw'), (e) => !(e instanceof ProviderError));
});

test('slow honours abort signals', async () => {
  const c = new AbortController();
  const p = gen('slow 10000', { signal: c.signal });
  c.abort(new Error('stop'));
  await assert.rejects(p, /stop/);
  assert.equal((await gen('slow 1')).text, 'done');
});
