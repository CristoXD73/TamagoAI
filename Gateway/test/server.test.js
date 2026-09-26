import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startGateway, post, textRequest, ID, TOKEN } from './helpers.js';
import { validateResponse, LIMITS } from '../src/protocol.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createGateway } from '../src/server.js';

let gw;
before(async () => {
  gw = await startGateway({ timeoutMs: 200 });
});
after(() => gw.close());

function assertValid(body) {
  assert.deepEqual(validateResponse(body), []);
}

test('GET /v1/health needs no auth', async () => {
  const res = await fetch(`${gw.base}/v1/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.protocolVersion, 1);
  assert.equal(typeof body.uptimeSeconds, 'number');
});

test('GET /v1/protocol advertises versions and enums', async () => {
  const body = await (await fetch(`${gw.base}/v1/protocol`)).json();
  assert.deepEqual(body.supportedProtocolVersions, [1]);
  assert.equal(body.authRequired, true);
  assert.ok(body.characterStates.includes('toolRunning'));
  assert.ok(body.errorCodes.includes('timeout'));
});

test('POST /v1/request ping -> pong, echoes request ID in body and header', async () => {
  const res = await post(gw.base, textRequest('ping', ID(11)));
  assert.equal(res.status, 200);
  assertValid(res.body);
  assert.equal(res.body.requestId, ID(11));
  assert.equal(res.headers.get('x-request-id'), ID(11));
  assert.equal(res.body.text, 'pong');
});

test('state happy drives characterState', async () => {
  const res = await post(gw.base, textRequest('state happy', ID(12)));
  assert.equal(res.body.characterState, 'happy');
  assert.equal(res.body.haptic, 'success');
});

test('state error -> deterministic structured error (502)', async () => {
  const res = await post(gw.base, textRequest('state error', ID(13)));
  assert.equal(res.status, 502);
  assertValid(res.body);
  assert.equal(res.body.requestId, ID(13));
  assert.equal(res.body.error.code, 'provider_error');
});

test('missing token -> 401 auth_failed', async () => {
  const res = await post(gw.base, textRequest('ping', ID(14)), { token: null });
  assert.equal(res.status, 401);
  assertValid(res.body);
  assert.equal(res.body.error.code, 'auth_failed');
  assert.equal(res.body.requestId, null, 'unauthenticated bodies are not parsed');
});

test('wrong token and wrong scheme -> 401', async () => {
  assert.equal((await post(gw.base, textRequest('ping', ID(15)), { token: 'wrong' })).status, 401);
  const res = await post(gw.base, textRequest('ping', ID(16)), {
    token: null,
    headers: { authorization: `Basic ${TOKEN}` },
  });
  assert.equal(res.status, 401);
});

test('malformed JSON -> 400 invalid_request', async () => {
  const res = await post(gw.base, '{"protocolVersion": 1,', { raw: true });
  assert.equal(res.status, 400);
  assertValid(res.body);
  assert.equal(res.body.error.code, 'invalid_request');
  assert.equal(res.body.requestId, null);
});

test('schema violation echoes a valid requestId', async () => {
  const res = await post(gw.base, { protocolVersion: 1, requestId: ID(17), inputType: 'text' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_request');
  assert.equal(res.body.requestId, ID(17));
});

test('unsupported protocol version -> 400 unsupported_protocol', async () => {
  const res = await post(gw.base, { ...textRequest('ping', ID(18)), protocolVersion: 2 });
  assert.equal(res.status, 400);
  assertValid(res.body);
  assert.equal(res.body.error.code, 'unsupported_protocol');
  assert.equal(res.body.requestId, ID(18));
});

test('provider exception -> 502 provider_error without leaking internals', async () => {
  const res = await post(gw.base, textRequest('throw', ID(19)));
  assert.equal(res.status, 502);
  assertValid(res.body);
  assert.equal(res.body.error.code, 'provider_error');
  assert.doesNotMatch(JSON.stringify(res.body), /secret|\/Users/);
});

test('provider unavailable -> 503', async () => {
  const res = await post(gw.base, textRequest('unavailable', ID(20)));
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'provider_unavailable');
  assert.equal(res.body.characterState, 'error');
});

test('slow provider -> 504 timeout', async () => {
  const started = Date.now();
  const res = await post(gw.base, textRequest('slow 5000', ID(21)));
  assert.equal(res.status, 504);
  assertValid(res.body);
  assert.equal(res.body.error.code, 'timeout');
  assert.equal(res.body.error.retryable, true);
  assert.ok(Date.now() - started < 2000, 'timed out promptly');
});

test('timeout still fires when the provider ignores the abort signal', async () => {
  const stubborn = { name: 'stubborn', generate: () => new Promise(() => {}) };
  const local = createGateway({ provider: stubborn, authToken: null, timeoutMs: 50 });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  try {
    const res = await post(`http://127.0.0.1:${local.address().port}`, textRequest('x', ID(22)), { token: null });
    assert.equal(res.status, 504);
  } finally {
    await new Promise((r) => local.close(r));
  }
});

test('out-of-contract provider output -> provider_error', async () => {
  const bad = { name: 'bad', generate: async () => ({ text: 'x', characterState: 'thinking' }) };
  const local = createGateway({ provider: bad, authToken: null });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  try {
    const res = await post(`http://127.0.0.1:${local.address().port}`, textRequest('x', ID(23)), { token: null });
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'provider_error');
  } finally {
    await new Promise((r) => local.close(r));
  }
});

test('duplicate requestId is answered once (provider invoked once)', async () => {
  let calls = 0;
  const base = createMockProvider();
  const counting = {
    name: 'counting',
    generate: async (req, opts) => {
      calls += 1;
      return base.generate(req, opts);
    },
  };
  const local = createGateway({ provider: counting, authToken: null });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${local.address().port}`;
  try {
    const [a, b] = await Promise.all([
      post(url, textRequest('ping', ID(24)), { token: null }),
      post(url, textRequest('ping', ID(24)), { token: null }),
    ]);
    const c = await post(url, textRequest('ping', ID(25)), { token: null });
    assert.deepEqual(a.body, b.body);
    assert.equal(c.body.requestId, ID(25));
    assert.equal(calls, 2);
  } finally {
    await new Promise((r) => local.close(r));
  }
});

test('oversized body -> 413 payload_too_large', async () => {
  const huge = JSON.stringify(textRequest('a'.repeat(LIMITS.maxBodyBytes + 10), ID(26)));
  const res = await post(gw.base, huge, { raw: true });
  assert.equal(res.status, 413);
  assert.equal(res.body.error.code, 'payload_too_large');
});

test('unknown path -> 404, wrong method -> 405', async () => {
  const nf = await fetch(`${gw.base}/nope`);
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).error.code, 'not_found');
  const na = await fetch(`${gw.base}/v1/request`);
  assert.equal(na.status, 405);
  assert.equal((await na.json()).error.code, 'method_not_allowed');
});

test('logs contain request IDs but never user text', async () => {
  const lines = [];
  const logger = { info: (o) => lines.push(o), warn: (o) => lines.push(o), error: (o) => lines.push(o) };
  const local = createGateway({ provider: createMockProvider(), authToken: null, logger });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  try {
    await post(`http://127.0.0.1:${local.address().port}`, textRequest('my private question', ID(27)), {
      token: null,
    });
  } finally {
    await new Promise((r) => local.close(r));
  }
  const all = JSON.stringify(lines);
  assert.match(all, new RegExp(ID(27)));
  assert.doesNotMatch(all, /private question/);
});

test('createGateway rejects unsafe construction', () => {
  assert.throws(() => createGateway({ authToken: null }), /provider/);
  assert.throws(() => createGateway({ provider: createMockProvider(), authToken: '' }), /authToken/);
  assert.throws(() => createGateway({ provider: createMockProvider() }), /authToken/);
});
