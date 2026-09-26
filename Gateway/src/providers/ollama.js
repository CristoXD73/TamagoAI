// VERIFICATION: UNVERIFIED_LOCAL_PROVIDER
// This adapter is unit-tested only against a stubbed fetch. It has NOT been run
// against a real Ollama instance or the owner's Mac. Verify locally before
// relying on it (see docs/HANDOFF_LOG.md).

import { ProviderError } from './provider.js';

const SYSTEM_PROMPT =
  'You are Tamago, a tiny companion living on an Apple Watch. ' +
  'Answer in one or two short spoken sentences. No markdown, no lists, no emoji.';

/**
 * @param {object} opts
 * @param {string} [opts.baseUrl]  default http://127.0.0.1:11434
 * @param {string} opts.model      Ollama model name, e.g. "llama3.2"
 * @param {typeof fetch} [opts.fetchImpl]  injectable for tests
 */
export function createOllamaProvider({ baseUrl = 'http://127.0.0.1:11434', model, fetchImpl = fetch } = {}) {
  if (!model) {
    throw new Error('OllamaProvider requires a model (set OLLAMA_MODEL).');
  }
  const url = new URL('/api/chat', baseUrl).toString();

  return {
    name: 'ollama',
    async generate(request, { signal } = {}) {
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: request.text },
            ],
          }),
          signal,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new ProviderError('provider_unavailable', 'Could not reach Ollama.');
      }

      if (!res.ok) {
        throw new ProviderError('provider_error', `Ollama returned HTTP ${res.status}.`);
      }

      let data;
      try {
        data = await res.json();
      } catch {
        throw new ProviderError('provider_error', 'Ollama returned invalid JSON.');
      }

      const text = data?.message?.content;
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new ProviderError('provider_error', 'Ollama returned no message content.');
      }
      return { text: text.trim(), characterState: 'happy', haptic: 'success' };
    },
  };
}
