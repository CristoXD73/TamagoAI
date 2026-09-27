// VERIFICATION: verified on the owner's Mac with llama3.2:3b (Ollama 0.34.4), 2026-09-27:
// 34 real model turns across three 25-turn runs (+2 through the gateway), all valid JSON on the first try, ~1 s
// warm (docs/BRAIN_EVAL.md, D-118). Other models: unverified. Unit tests use a stubbed fetch.
// Uses Ollama structured outputs (`format` = JSON schema).

import { ProviderError } from '../../providers/provider.js';
import { INTENT_JSON_SCHEMA, validateIntent } from '../response-schema.js';

const HEALTH_TTL_MS = 30_000;
const WARM_EVERY_MS = 60_000;
// Evidence (owner's Mac): a cold llama3.2:3b load cost ~1.5–4.6 s on the first
// question after idle. Keep it loaded longer, and warm it when the Watch checks in.
const KEEP_ALIVE = '60m';
const CHAT_OPTIONS = { num_ctx: 4096 };   // warm-ups must match, or Ollama reloads the model

export function createOllamaReasoner({
  baseUrl = 'http://127.0.0.1:11434', fastModel, smartModel, fetchImpl = fetch, now = Date.now,
} = {}) {
  if (!fastModel) throw new Error('Ollama reasoner needs a model (OLLAMA_MODEL or TAMAGO_FAST_MODEL).');
  smartModel ??= fastModel;
  const chatUrl = new URL('/api/chat', baseUrl).toString();
  const tagsUrl = new URL('/api/tags', baseUrl).toString();
  let health = { at: 0, ok: true };
  let lastWarm = -Infinity;

  async function call(model, messages, temperature, signal) {
    let res;
    try {
      res = await fetchImpl(chatUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: false, format: INTENT_JSON_SCHEMA, keep_alive: KEEP_ALIVE,
          options: { temperature, ...CHAT_OPTIONS },
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

    /** Loads the fast model (same options as real calls) at most once a minute. */
    async warm() {
      if (now() - lastWarm < WARM_EVERY_MS) return false;
      lastWarm = now();
      try {
        const r = await fetchImpl(chatUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: fastModel, messages: [{ role: 'user', content: 'hi' }], stream: false,
            keep_alive: KEEP_ALIVE, options: { ...CHAT_OPTIONS, num_predict: 1 } }),
        });
        return r.ok;
      } catch {
        return false;
      }
    },

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
