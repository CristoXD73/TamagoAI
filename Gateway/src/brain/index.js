// Brain wiring shared by the gateway (TAMAGO_PROVIDER=brain) and the CLI.

import { createBrain } from './orchestrator.js';
import { createOllamaReasoner } from './reasoners/ollama.js';
import { createDeterministicReasoner } from './reasoners/deterministic.js';
import { defaultBrainPath } from './storage/database.js';
import { defaultStateDir } from '../identity.js';

/** D-118: verified on the owner's Mac (docs/BRAIN_EVAL.md). An interim test model; a stronger one comes later. */
export const DEFAULT_MODELS = Object.freeze({ fast: 'llama3.2:3b', smart: 'llama3.2:3b' });

export function brainOptionsFromEnv(env = process.env) {
  const kind = env.TAMAGO_REASONER ?? (env.TAMAGO_FAST_MODEL ?? env.OLLAMA_MODEL ? 'ollama' : 'deterministic');
  const fastModel = env.TAMAGO_FAST_MODEL ?? env.OLLAMA_MODEL ?? DEFAULT_MODELS.fast;
  let reasoner;
  if (kind === 'ollama') {
    reasoner = createOllamaReasoner({
      baseUrl: env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
      fastModel,
      smartModel: env.TAMAGO_SMART_MODEL ?? (env.TAMAGO_FAST_MODEL ?? env.OLLAMA_MODEL ? fastModel : DEFAULT_MODELS.smart),
    });
  } else if (kind === 'deterministic') {
    reasoner = createDeterministicReasoner();
  } else {
    throw new Error(`Unknown TAMAGO_REASONER "${kind}" (expected ollama or deterministic).`);
  }
  return { dbPath: env.TAMAGO_BRAIN_DB ?? defaultBrainPath(defaultStateDir(env)), reasoner };
}

/**
 * AIProvider backed by the brain. Opening the database is async, so the
 * provider exposes ready() for fail-fast startup; generate() also awaits it.
 */
export function createBrainProvider(options) {
  const brainP = createBrain(options);
  brainP.catch(() => {}); // surfaced through ready()/generate()
  return {
    name: `brain(${options.reasoner.name})`,
    ready: () => brainP.then(() => true),
    async generate(request, opts) {
      const brain = await brainP;
      return brain.asProvider().generate(request, opts);
    },
    close: () => brainP.then((b) => b.close()),
  };
}
