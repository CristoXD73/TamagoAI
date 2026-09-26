import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRequest,
  buildOkResponse,
  buildErrorResponse,
  validateResponse,
  isUuid,
  ProtocolError,
  CHARACTER_STATES,
  REACTION_STATES,
  ERRORS,
  LIMITS,
} from '../src/protocol.js';
import { ID, textRequest } from './helpers.js';

function expectCode(fn, code) {
  assert.throws(fn, (err) => err instanceof ProtocolError && err.code === code);
}

test('parseRequest accepts a minimal valid request and normalizes it', () => {
  const upper = ID(7).toUpperCase();
  const r = parseRequest({ ...textRequest('  Turn Jellyfin back on.  ', upper), futureField: 1 });
  assert.deepEqual(r, {
    protocolVersion: 1,
    requestId: ID(7),
    inputType: 'text',
    text: 'Turn Jellyfin back on.',
  });
});

test('parseRequest keeps only known client metadata fields', () => {
  const r = parseRequest(textRequest('hi', ID(1), { client: { device: 'watch', route: 'direct', extra: 'x' } }));
  assert.deepEqual(r.client, { device: 'watch', route: 'direct' });
});

test('parseRequest rejects non-object bodies', () => {
  for (const body of [null, 42, 'x', [], true]) expectCode(() => parseRequest(body), 'invalid_request');
});

test('parseRequest: unsupported protocol version wins over other problems', () => {
  expectCode(() => parseRequest({ protocolVersion: 2 }), 'unsupported_protocol');
  expectCode(() => parseRequest({ ...textRequest('x'), protocolVersion: 0 }), 'unsupported_protocol');
});

test('parseRequest: missing / non-integer protocolVersion is invalid_request', () => {
  expectCode(() => parseRequest({ requestId: ID(1), inputType: 'text', text: 'x' }), 'invalid_request');
  expectCode(() => parseRequest({ ...textRequest('x'), protocolVersion: '1' }), 'invalid_request');
  expectCode(() => parseRequest({ ...textRequest('x'), protocolVersion: 1.5 }), 'invalid_request');
});

test('parseRequest validates requestId as UUID and echoes it on later errors', () => {
  expectCode(() => parseRequest(textRequest('x', 'not-a-uuid')), 'invalid_request');
  expectCode(() => parseRequest({ protocolVersion: 1, inputType: 'text', text: 'x' }), 'invalid_request');
  try {
    parseRequest(textRequest('', ID(3)));
    assert.fail('should throw');
  } catch (err) {
    assert.equal(err.requestId, ID(3));
  }
});

test('parseRequest validates inputType, text and client', () => {
  expectCode(() => parseRequest(textRequest('x', ID(1), { inputType: 'audio' })), 'invalid_request');
  expectCode(() => parseRequest(textRequest(42)), 'invalid_request');
  expectCode(() => parseRequest(textRequest('   ')), 'invalid_request');
  expectCode(() => parseRequest(textRequest('a'.repeat(LIMITS.maxInputTextChars + 1))), 'invalid_request');
  expectCode(() => parseRequest(textRequest('x', ID(1), { client: 'watch' })), 'invalid_request');
  expectCode(() => parseRequest(textRequest('x', ID(1), { client: { route: 5 } })), 'invalid_request');
});

test('isUuid', () => {
  assert.ok(isUuid('3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c'));
  assert.ok(!isUuid('3f2b8c1e9a4d4e7b8c2a1d5e6f7a8b9c'));
  assert.ok(!isUuid(123));
});

test('buildOkResponse fills defaults', () => {
  const r = buildOkResponse(ID(1), { text: ' hi ' });
  assert.deepEqual(r, {
    protocolVersion: 1,
    requestId: ID(1),
    status: 'ok',
    text: 'hi',
    speechText: 'hi',
    characterState: 'idle',
    haptic: 'none',
    followUpExpected: false,
  });
  assert.deepEqual(validateResponse(r), []);
});

test('buildOkResponse refuses to forward out-of-contract provider output', () => {
  const bad = [
    null,
    { text: '' },
    { text: 'x', characterState: 'thinking' }, // client-only state
    { text: 'x', characterState: 'dancing' },
    { text: 'x', haptic: 'buzz' },
  ];
  for (const result of bad) {
    assert.throws(
      () => buildOkResponse(ID(1), result),
      (err) => err instanceof ProtocolError && err.code === 'provider_error',
    );
  }
});

test('buildOkResponse truncates overly long text', () => {
  const r = buildOkResponse(ID(1), { text: 'a'.repeat(5000) });
  assert.equal(r.text.length, LIMITS.maxResponseTextChars);
});

test('buildErrorResponse produces a valid envelope for every code', () => {
  for (const code of Object.keys(ERRORS)) {
    const r = buildErrorResponse(ID(1), code, 'm');
    assert.deepEqual(validateResponse(r), [], code);
    assert.equal(r.error.code, code);
    assert.equal(r.haptic, 'failure');
  }
  assert.equal(buildErrorResponse(null, 'nope').error.code, 'internal_error');
});

test('reaction states are a subset of character states', () => {
  for (const s of REACTION_STATES) assert.ok(CHARACTER_STATES.includes(s));
});

test('validateResponse catches structural problems', () => {
  assert.ok(validateResponse(null).length > 0);
  const ok = buildOkResponse(ID(1), { text: 'x' });
  assert.ok(validateResponse({ ...ok, characterState: 'dancing' }).length > 0);
  assert.ok(validateResponse({ ...ok, requestId: null }).length > 0);
  assert.ok(validateResponse({ ...ok, error: { code: 'timeout' } }).length > 0);
  assert.ok(validateResponse({ ...buildErrorResponse(ID(1), 'timeout'), error: undefined }).length > 0);
});
