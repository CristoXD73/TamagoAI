import { createMockProvider } from './providers/mock.js';
import { createOllamaProvider } from './providers/ollama.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Reads gateway configuration from environment variables. Throws with a
 * human-readable message on unsafe or invalid configuration. Secrets only ever
 * come from the environment — never from files in this repository.
 */
export function loadConfig(env = process.env) {
  const host = env.TAMAGO_HOST ?? '127.0.0.1';
  const port = parseIntStrict(env.TAMAGO_PORT ?? '8787', 'TAMAGO_PORT');
  const timeoutMs = parseIntStrict(env.TAMAGO_TIMEOUT_MS ?? '20000', 'TAMAGO_TIMEOUT_MS');
  const providerName = env.TAMAGO_PROVIDER ?? 'mock';

  let authToken = env.TAMAGO_TOKEN ?? null;
  if (authToken !== null && authToken.length < 16) {
    throw new Error('TAMAGO_TOKEN must be at least 16 characters.');
  }
  if (authToken === null) {
    if (env.TAMAGO_ALLOW_NO_AUTH !== '1') {
      throw new Error(
        'TAMAGO_TOKEN is not set. Set a token, or for loopback-only development set TAMAGO_ALLOW_NO_AUTH=1.',
      );
    }
    if (!LOOPBACK.has(host)) {
      throw new Error('TAMAGO_ALLOW_NO_AUTH=1 is only permitted when TAMAGO_HOST is a loopback address.');
    }
  }

  let provider;
  if (providerName === 'mock') {
    provider = createMockProvider();
  } else if (providerName === 'ollama') {
    provider = createOllamaProvider({
      baseUrl: env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
      model: env.OLLAMA_MODEL,
    });
  } else {
    throw new Error(`Unknown TAMAGO_PROVIDER "${providerName}" (expected mock or ollama).`);
  }

  return { host, port, timeoutMs, authToken, provider };
}

function parseIntStrict(value, name) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}
