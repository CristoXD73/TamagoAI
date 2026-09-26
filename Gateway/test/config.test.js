import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('refuses to start without a token by default', () => {
  assert.throws(() => loadConfig({}), /TAMAGO_TOKEN/);
});

test('no-auth mode is loopback-only', () => {
  assert.equal(loadConfig({ TAMAGO_ALLOW_NO_AUTH: '1' }).authToken, null);
  assert.throws(() => loadConfig({ TAMAGO_ALLOW_NO_AUTH: '1', TAMAGO_HOST: '0.0.0.0' }), /loopback/);
});

test('rejects short tokens, bad ports, unknown providers', () => {
  assert.throws(() => loadConfig({ TAMAGO_TOKEN: 'short' }), /16/);
  assert.throws(() => loadConfig({ TAMAGO_TOKEN: 'x'.repeat(16), TAMAGO_PORT: 'abc' }), /TAMAGO_PORT/);
  assert.throws(() => loadConfig({ TAMAGO_TOKEN: 'x'.repeat(16), TAMAGO_PROVIDER: 'gpt' }), /Unknown/);
  assert.throws(() => loadConfig({ TAMAGO_TOKEN: 'x'.repeat(16), TAMAGO_PROVIDER: 'ollama' }), /model/);
});

test('defaults', () => {
  const c = loadConfig({ TAMAGO_TOKEN: 'x'.repeat(16) });
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 8787);
  assert.equal(c.timeoutMs, 20000);
  assert.equal(c.provider.name, 'mock');
});
