import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPairingWindow } from '../src/pairing.js';
import { loadOrCreateIdentity } from '../src/identity.js';
import { pickLanIPv4, dnsSdArgs, WELL_KNOWN_HOST, SERVICE_TYPE } from '../src/advertise.js';
import { startGateway, post, textRequest, ID } from './helpers.js';

// --- pairing window ---

test('correct code pairs exactly once', () => {
  const w = createPairingWindow({ code: '123456' });
  assert.equal(w.attempt('123 456'), 'ok', 'spaces are ignored, as the code is displayed spaced');
  assert.equal(w.attempt('123456'), 'closed', 'single use');
});

test('wrong codes close the window after maxFailures', () => {
  const w = createPairingWindow({ code: '123456', maxFailures: 3 });
  assert.equal(w.attempt('000000'), 'invalid');
  assert.equal(w.attempt('111111'), 'invalid');
  assert.equal(w.attempt('222222'), 'invalid');
  assert.equal(w.attempt('123456'), 'closed', 'even the right code is refused once closed');
});

test('expired window refuses the right code', () => {
  let t = 0;
  const w = createPairingWindow({ code: '123456', ttlMs: 1000, now: () => t });
  t = 1001;
  assert.equal(w.attempt('123456'), 'closed');
  assert.equal(w.isOpen, false);
});

test('non-string or wrong-length input is invalid, not a crash', () => {
  const w = createPairingWindow({ code: '123456' });
  assert.equal(w.attempt(undefined), 'invalid');
  assert.equal(w.attempt(123456), 'invalid');
  assert.equal(w.attempt('1234567'), 'invalid');
});

test('generated codes are 6 digits', () => {
  for (let i = 0; i < 50; i++) assert.match(createPairingWindow().code, /^\d{6}$/);
});

// --- identity ---

const dir = mkdtempSync(join(tmpdir(), 'tamago-identity-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('identity is created once with owner-only permissions, then reused', () => {
  const first = loadOrCreateIdentity(join(dir, 'a'));
  assert.equal(first.created, true);
  assert.ok(first.token.length >= 32);
  assert.equal(statSync(join(dir, 'a', 'gateway.json')).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, 'a')).mode & 0o777, 0o700);
  const second = loadOrCreateIdentity(join(dir, 'a'));
  assert.equal(second.created, false);
  assert.equal(second.token, first.token, 'restarting must not unpair the Watch');
  assert.equal(second.gatewayId, first.gatewayId);
});

test('a corrupt identity file is an error, never silently replaced', () => {
  loadOrCreateIdentity(join(dir, 'b'));
  writeFileSync(join(dir, 'b', 'gateway.json'), '{ nope');
  assert.throws(() => loadOrCreateIdentity(join(dir, 'b')), /not valid JSON/);
});

// --- advertisement (pure parts; the dns-sd process itself is verified manually) ---

test('picks the bound IPv4, else en0, else another non-internal IPv4', () => {
  const ifaces = {
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en5: [{ family: 'IPv4', internal: false, address: '10.0.0.9' }],
    en0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }, { family: 'IPv4', internal: false, address: '192.168.1.20' }],
  };
  assert.equal(pickLanIPv4('192.168.1.99', ifaces), '192.168.1.99');
  assert.equal(pickLanIPv4('0.0.0.0', ifaces), '192.168.1.20');
  assert.equal(pickLanIPv4('0.0.0.0', { en5: ifaces.en5 }), '10.0.0.9');
  assert.equal(pickLanIPv4('0.0.0.0', { lo0: ifaces.lo0 }), null);
});

test('dns-sd publishes the well-known host and the service with a non-secret TXT record', () => {
  const args = dnsSdArgs({ port: 8787, ip: '192.168.1.20', gatewayId: 'gw-1' });
  assert.deepEqual(args, ['-P', 'TamagoAI', SERVICE_TYPE, 'local', '8787', WELL_KNOWN_HOST, '192.168.1.20', 'id=gw-1', 'proto=1']);
});

// --- POST /v1/pair ---

async function pair(base, body) {
  const res = await fetch(`${base}/v1/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('pairing hands out the token that then authorizes requests', async () => {
  const gw = await startGateway({
    authToken: 'paired-token-0123456789', gatewayId: 'gw-1', gatewayName: 'Studio Mac',
    pairing: createPairingWindow({ code: '654321' }),
  });
  try {
    const wrong = await pair(gw.base, { pairingCode: '000000' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'pairing_failed');
    assert.equal(wrong.body.token, undefined);

    const ok = await pair(gw.base, { pairingCode: '654321', deviceName: 'Watch' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { protocolVersion: 1, gatewayId: 'gw-1', gatewayName: 'Studio Mac', token: 'paired-token-0123456789' });

    const reuse = await pair(gw.base, { pairingCode: '654321' });
    assert.equal(reuse.status, 410);

    const req = await post(gw.base, textRequest('ping', ID(90)), { token: ok.body.token });
    assert.equal(req.status, 200);

    const health = await (await fetch(`${gw.base}/v1/health`)).json();
    assert.equal(health.gatewayId, 'gw-1');
  } finally {
    await gw.close();
  }
});

test('pairing is unavailable without a pairing window, and malformed bodies are rejected', async () => {
  const gw = await startGateway();
  try {
    assert.equal((await pair(gw.base, { pairingCode: '123456' })).status, 404);
    const res = await fetch(`${gw.base}/v1/pair`, { method: 'POST', body: '{nope' });
    assert.equal(res.status, 404, 'unavailable is checked before parsing');
    assert.equal((await fetch(`${gw.base}/v1/pair`)).status, 405);
  } finally {
    await gw.close();
  }
});

test('pairing can be reopened for the next device without a restart; the old code dies', async () => {
  const { createPairing } = await import('../src/pairing.js');
  const p = createPairing({ code: '111111' });
  assert.equal(p.attempt('111111'), 'ok');
  assert.equal(p.isOpen, false, 'single use');
  const next = p.reopen();
  assert.match(next, /^\d{6}$/);
  assert.equal(p.isOpen, true);
  assert.equal(p.attempt('111111') === 'ok' && next !== '111111', false, 'the old code no longer pairs');
  assert.equal(p.attempt(next), 'ok');
});
