import { hostname } from 'node:os';
import { createMockProvider } from './providers/mock.js';
import { createOllamaProvider } from './providers/ollama.js';
import { brainOptionsFromEnv, createBrainProvider } from './brain/index.js';
import { defaultStateDir, loadOrCreateIdentity } from './identity.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Reads gateway configuration from environment variables. Throws with a
 * human-readable message on unsafe or invalid configuration. Secrets never
 * come from files in this repository: either TAMAGO_TOKEN, or a random token
 * generated once into the owner's own state directory (identity.js).
 *
 * `loadIdentity` is injectable so tests never touch the real state directory.
 */
export function loadConfig(env = process.env, { loadIdentity = () => loadOrCreateIdentity(defaultStateDir(env)) } = {}) {
  const host = env.TAMAGO_HOST ?? '127.0.0.1';
  const port = parseIntStrict(env.TAMAGO_PORT ?? '8787', 'TAMAGO_PORT');
  const timeoutMs = parseIntStrict(env.TAMAGO_TIMEOUT_MS ?? '20000', 'TAMAGO_TIMEOUT_MS');
  const providerName = env.TAMAGO_PROVIDER ?? 'mock';

  let authToken = env.TAMAGO_TOKEN ?? null;
  if (authToken !== null && authToken.length < 16) {
    throw new Error('TAMAGO_TOKEN must be at least 16 characters.');
  }
  let identity = null;
  if (authToken === null && env.TAMAGO_ALLOW_NO_AUTH === '1') {
    if (!LOOPBACK.has(host)) {
      throw new Error('TAMAGO_ALLOW_NO_AUTH=1 is only permitted when TAMAGO_HOST is a loopback address.');
    }
  } else {
    identity = loadIdentity();
    authToken ??= identity.token;
  }
  const pairingEnabled = identity !== null && env.TAMAGO_PAIRING !== '0';
  const advertise = identity !== null && !LOOPBACK.has(host) && env.TAMAGO_ADVERTISE !== '0';
  const gatewayName = env.TAMAGO_NAME ?? hostname().replace(/\.local$/, '');

  let provider;
  if (providerName === 'mock') {
    provider = createMockProvider();
  } else if (providerName === 'ollama') {
    provider = createOllamaProvider({
      baseUrl: env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
      model: env.OLLAMA_MODEL,
    });
  } else if (providerName === 'brain') {
    provider = createBrainProvider(brainOptionsFromEnv(env));
  } else {
    throw new Error(`Unknown TAMAGO_PROVIDER "${providerName}" (expected mock, ollama or brain).`);
  }

  return {
    host, port, timeoutMs, authToken, provider,
    gatewayId: identity?.gatewayId ?? null,
    gatewayName, pairingEnabled, advertise,
  };
}

function parseIntStrict(value, name) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}
