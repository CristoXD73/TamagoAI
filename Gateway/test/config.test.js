import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const IDENTITY = { gatewayId: 'gw-test', token: 'i'.repeat(43) };
// Never let a config test read or create the owner's real state directory.
const deps = { loadIdentity: () => IDENTITY };
const load = (env) => loadConfig(env, deps);

test('without TAMAGO_TOKEN, uses the persisted identity token and enables pairing', () => {
  const c = load({});
  assert.equal(c.authToken, IDENTITY.token);
  assert.equal(c.gatewayId, 'gw-test');
  assert.equal(c.pairingEnabled, true);
});

test('an explicit TAMAGO_TOKEN wins over the persisted token', () => {
  const c = load({ TAMAGO_TOKEN: 'x'.repeat(16) });
  assert.equal(c.authToken, 'x'.repeat(16));
  assert.equal(c.gatewayId, 'gw-test');
});

test('no-auth mode is loopback-only and has no identity, pairing or advertising', () => {
  const c = load({ TAMAGO_ALLOW_NO_AUTH: '1' });
  assert.equal(c.authToken, null);
  assert.equal(c.gatewayId, null);
  assert.equal(c.pairingEnabled, false);
  assert.equal(c.advertise, false);
  assert.throws(() => load({ TAMAGO_ALLOW_NO_AUTH: '1', TAMAGO_HOST: '0.0.0.0' }), /loopback/);
});

test('advertises only on a non-loopback bind, and can be turned off', () => {
  assert.equal(load({}).advertise, false);
  assert.equal(load({ TAMAGO_HOST: '0.0.0.0' }).advertise, true);
  assert.equal(load({ TAMAGO_HOST: '0.0.0.0', TAMAGO_ADVERTISE: '0' }).advertise, false);
  assert.equal(load({ TAMAGO_PAIRING: '0' }).pairingEnabled, false);
});

test('rejects short tokens, bad ports, unknown providers', () => {
  assert.throws(() => load({ TAMAGO_TOKEN: 'short' }), /16/);
  assert.throws(() => load({ TAMAGO_TOKEN: 'x'.repeat(16), TAMAGO_PORT: 'abc' }), /TAMAGO_PORT/);
  assert.throws(() => load({ TAMAGO_TOKEN: 'x'.repeat(16), TAMAGO_PROVIDER: 'gpt' }), /Unknown/);
  assert.throws(() => load({ TAMAGO_TOKEN: 'x'.repeat(16), TAMAGO_PROVIDER: 'ollama' }), /model/);
});

test('defaults', () => {
  const c = load({ TAMAGO_TOKEN: 'x'.repeat(16) });
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 8787);
  assert.equal(c.timeoutMs, 20000);
  assert.equal(c.provider.name, 'mock');
});
