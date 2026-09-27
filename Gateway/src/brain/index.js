// Brain wiring shared by the gateway (TAMAGO_PROVIDER=brain) and the CLI.

import { createBrain } from './orchestrator.js';
import { createOllamaReasoner } from './reasoners/ollama.js';
import { createDeterministicReasoner } from './reasoners/deterministic.js';
import { defaultBrainPath } from './storage/database.js';
import { defaultStateDir } from '../identity.js';

export function brainOptionsFromEnv(env = process.env) {
  const fastModel = env.TAMAGO_FAST_MODEL ?? env.OLLAMA_MODEL;
  const kind = env.TAMAGO_REASONER ?? (fastModel ? 'ollama' : 'deterministic');
  let reasoner;
  if (kind === 'ollama') {
    reasoner = createOllamaReasoner({
      baseUrl: env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
      fastModel,
      smartModel: env.TAMAGO_SMART_MODEL ?? fastModel,
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
