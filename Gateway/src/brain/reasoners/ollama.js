// VERIFICATION: UNVERIFIED_LOCAL_PROVIDER
// Tested only against a stubbed fetch. Not yet run against real Ollama on the
// owner's Mac (Brain F). Uses Ollama structured outputs (`format` = JSON schema).

import { ProviderError } from '../../providers/provider.js';
import { INTENT_JSON_SCHEMA, validateIntent } from '../response-schema.js';

const HEALTH_TTL_MS = 30_000;

export function createOllamaReasoner({
  baseUrl = 'http://127.0.0.1:11434', fastModel, smartModel, fetchImpl = fetch, now = Date.now,
} = {}) {
  if (!fastModel) throw new Error('Ollama reasoner needs a model (OLLAMA_MODEL or TAMAGO_FAST_MODEL).');
  smartModel ??= fastModel;
  const chatUrl = new URL('/api/chat', baseUrl).toString();
  const tagsUrl = new URL('/api/tags', baseUrl).toString();
  let health = { at: 0, ok: true };

  async function call(model, messages, temperature, signal) {
    let res;
    try {
      res = await fetchImpl(chatUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: false, format: INTENT_JSON_SCHEMA, keep_alive: '15m',
          options: { temperature, num_ctx: 4096 },
        }),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      health = { at: now(), ok: false };
      throw new ProviderError('provider_unavailable', 'Could not reach Ollama.');
    }
    health = { at: now(), ok: true };
    if (!res.ok) throw new ProviderError('provider_error', `Ollama returned HTTP ${res.status}.`);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new ProviderError('provider_error', 'Ollama returned invalid JSON.');
    }
    return data?.message?.content ?? '';
  }

  return {
    name: 'ollama',
    get available() {
      return health.ok;
    },
    models: { fast: fastModel, smart: smartModel },

    async checkHealth({ signal } = {}) {
      if (now() - health.at < HEALTH_TTL_MS) return health.ok;
      try {
        const r = await fetchImpl(tagsUrl, { signal });
        health = { at: now(), ok: r.ok };
      } catch {
        health = { at: now(), ok: false };
      }
      return health.ok;
    },

    /** One call; one repair attempt if the model's JSON is invalid; then give up honestly. */
    async reason({ context, route }, { signal } = {}) {
      const model = route === 'smart' ? smartModel : fastModel;
      const temperature = route === 'smart' ? 0.4 : 0.7;
      const messages = [{ role: 'system', content: context.system }, { role: 'user', content: context.prompt }];
      const errors = [];
      for (let attempt = 1; attempt <= 2; attempt++) {
        const content = await call(model, messages, temperature, signal);
        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch {
          errors.push('reply was not JSON');
        }
        if (parsed !== undefined) {
          const v = validateIntent(parsed);
          if (v.ok) return { intent: v.intent, attempts: attempt, model };
          errors.push(...v.errors);
        }
        messages.push({ role: 'assistant', content: String(content).slice(0, 2000) },
          { role: 'user', content: `Invalid reply: ${errors.join('; ')}. Reply again with JSON only, matching the schema.` });
      }
      throw new ProviderError('provider_error', `Model output failed validation twice (${model}).`);
    },
  };
}
