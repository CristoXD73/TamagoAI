import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

export function defaultStateDir(env = process.env) {
  return env.TAMAGO_STATE_DIR ?? join(homedir(), 'Library', 'Application Support', 'TamagoAI');
}

/**
 * The gateway's persistent identity: a public `gatewayId` and the secret
 * bearer `token` a paired Watch stores. Created once (owner-only file, 0600 in
 * a 0700 directory) so restarting the gateway never unpairs the Watch.
 * A corrupt file is an error, not silently replaced — replacing it would
 * invalidate every paired device without the owner knowing why.
 */
export function loadOrCreateIdentity(dir) {
  const file = join(dir, 'gateway.json');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const identity = { gatewayId: randomUUID(), token: randomBytes(32).toString('base64url') };
    writeFileSync(file, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
    return { ...identity, created: true };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${file} is not valid JSON. Move it aside to re-pair from scratch.`);
  }
  if (typeof parsed.gatewayId !== 'string' || typeof parsed.token !== 'string' || parsed.token.length < 32) {
    throw new Error(`${file} is missing gatewayId/token. Move it aside to re-pair from scratch.`);
  }
  return { gatewayId: parsed.gatewayId, token: parsed.token, created: false };
}
