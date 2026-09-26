// Tests the adapter's mapping logic against a STUBBED fetch only.
// Real Ollama behaviour is UNVERIFIED_LOCAL_PROVIDER.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaProvider } from '../src/providers/ollama.js';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('requires a model', () => {
  assert.throws(() => createOllamaProvider({}), /model/);
});

test('sends a non-streaming chat request and maps the answer', async () => {
  let seen;
  const p = createOllamaProvider({
    model: 'test-model',
    fetchImpl: async (url, init) => {
      seen = { url, body: JSON.parse(init.body) };
      return jsonResponse(200, { message: { role: 'assistant', content: ' Hello! ' } });
    },
  });
  const r = await p.generate({ text: 'hi' });
  assert.equal(seen.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(seen.body.model, 'test-model');
  assert.equal(seen.body.stream, false);
  assert.equal(seen.body.messages.at(-1).content, 'hi');
  assert.equal(r.text, 'Hello!');
});

test('maps failures to structured provider errors', async () => {
  const cases = [
    [async () => { throw new TypeError('fetch failed'); }, 'provider_unavailable'],
    [async () => jsonResponse(500, {}), 'provider_error'],
    [async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }), 'provider_error'],
    [async () => jsonResponse(200, { message: {} }), 'provider_error'],
  ];
  for (const [fetchImpl, code] of cases) {
    const p = createOllamaProvider({ model: 'm', fetchImpl });
    await assert.rejects(p.generate({ text: 'hi' }), (e) => e.code === code);
  }
});
