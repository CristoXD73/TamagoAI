// Brain wiring shared by the gateway (TAMAGO_PROVIDER=brain) and the CLI.

import { createBrain } from './orchestrator.js';
import { createOllamaReasoner } from './reasoners/ollama.js';
import { createDeterministicReasoner } from './reasoners/deterministic.js';
import { defaultBrainPath } from './storage/database.js';
import { defaultStateDir } from '../identity.js';
import { createHands } from '../hands/agent.js';
import { createTools } from '../hands/tools.js';
import { createRelay } from '../relay/relay.js';
import { join } from 'node:path';

/** D-118: verified on the owner's Mac (docs/BRAIN_EVAL.md). An interim test model; a stronger one comes later. */
// D-125: Gemma 4 12B (scripts/tamago-up.sh picks Qwen 3.5 9B while Xcode runs). llama3.2:3b was removed from the Mac.
export const DEFAULT_MODELS = Object.freeze({ fast: 'gemma4:12b-it-qat', smart: 'gemma4:12b-it-qat' });

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
  // D-128: Tamago's hands (docs/TAMAGO_HANDS.md), on with a real model unless TAMAGO_HANDS=off.
  // D-129: the relay to Claude Code / Codex, unless TAMAGO_RELAY=off.
  let hands = null;
  if (kind === 'ollama' && env.TAMAGO_HANDS !== 'off') {
    const relay = env.TAMAGO_RELAY === 'off' ? null
      : createRelay({ stateDir: defaultStateDir(env), relayDir: env.TAMAGO_RELAY_DIR ?? '/Volumes/Storage/AI/relay' });
    hands = createHands({ model: fastModel, baseUrl: env.OLLAMA_URL ?? 'http://127.0.0.1:11434', relay,
      tools: createTools({ relay }), auditLog: join(defaultStateDir(env), 'logs', 'hands.log') });
  }
  return { dbPath: env.TAMAGO_BRAIN_DB ?? defaultBrainPath(defaultStateDir(env)), reasoner, hands };
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
    // D-127: only a reasoner that can write (Ollama) offers long answers; the deterministic one never flags them.
    ...(typeof options.reasoner.detail === 'function'
      ? { detail: async (request, opts) => (await brainP).detail(request, opts) }
      : {}),
    close: () => brainP.then((b) => b.close()),
    warm: () => options.reasoner.warm?.() ?? Promise.resolve(false),
  };
}
