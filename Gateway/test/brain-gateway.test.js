// Brain behind the real gateway: Protocol V1 stays the external contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway, post, textRequest, ID } from './helpers.js';
import { validateResponse } from '../src/protocol.js';
import { loadConfig } from '../src/config.js';
import { createBrainProvider, brainOptionsFromEnv } from '../src/brain/index.js';

test('gateway with the brain provider speaks Protocol V1, always in words (D-123), and remembers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tamago-brain-gw-'));
  const provider = createBrainProvider(brainOptionsFromEnv({ TAMAGO_BRAIN_DB: join(dir, 'brain.sqlite') }));
  await provider.ready();
  const gw = await startGateway({ provider });
  try {
    const a = await post(gw.base, textRequest('My Jellyfin runs on this Mac.', ID(101)));
    assert.equal(a.status, 200);
    assert.deepEqual(validateResponse(a.body), []);
    assert.equal(a.body.speechText, 'Got it.');

    const b = await post(gw.base, textRequest('Where does my Jellyfin run?', ID(102)));
    assert.equal(b.body.speechText, 'On this Mac.');
    assert.equal(b.body.requestId, ID(102));

    const c = await post(gw.base, textRequest('Thanks.', ID(103)));
    assert.deepEqual(validateResponse(c.body), []);
    assert.equal(c.body.status, 'ok');
    assert.equal(c.body.text, 'Mm. Sure.');
    assert.equal(c.body.speechText, 'Mm. Sure.');
    assert.equal(c.body.characterState, 'happy');
    assert.equal(c.body.haptic, 'click');

    // duplicate requestId: answered from the gateway's dedupe, brain not re-run
    const d = await post(gw.base, textRequest('Where does my Jellyfin run?', ID(102)));
    assert.deepEqual(d.body, b.body);
  } finally {
    await gw.close();
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: TAMAGO_PROVIDER=brain selects the brain; reasoner follows OLLAMA_MODEL', () => {
  const identity = () => ({ gatewayId: 'g', token: 'x'.repeat(40) });
  const c1 = loadConfig({ TAMAGO_PROVIDER: 'brain', TAMAGO_BRAIN_DB: ':memory:' }, { loadIdentity: identity });
  assert.equal(c1.provider.name, 'brain(deterministic)');
  // Review SM7 (2026-10-01): the gateway's config runs the relay's restart recovery, so never on the real state dir.
  const stateDir = mkdtempSync(join(tmpdir(), 'brain-config-'));
  const c2 = loadConfig({ TAMAGO_PROVIDER: 'brain', TAMAGO_BRAIN_DB: ':memory:', OLLAMA_MODEL: 'llama3.2', TAMAGO_STATE_DIR: stateDir,
    TAMAGO_RELAY_DIR: join(stateDir, 'relay-work') }, { loadIdentity: identity });
  assert.equal(c2.provider.name, 'brain(ollama)');
  assert.throws(() => brainOptionsFromEnv({ TAMAGO_REASONER: 'gpt' }), /Unknown TAMAGO_REASONER/);
  return Promise.all([c1.provider.close(), c2.provider.close()]).finally(() => rmSync(stateDir, { recursive: true, force: true }));
});
