// Speech-to-text for POST /v1/audio (PROTOCOL_V1 §15, D-120).
// Runs the local helper tools/transcribe (Apple SpeechAnalyzer, on-device).
// Not an npm dependency: a Swift file compiled on the owner's Mac with
// `npm run build:transcriber`. Without it, voice input is simply unavailable.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TRANSCRIBER_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'transcribe', '.build', 'transcribe');

/**
 * @returns {{ name: string, transcribe(file: string, opts?: { signal?: AbortSignal }): Promise<string> } | null}
 */
export function createTranscriberFromEnv(env = process.env) {
  if (env.TAMAGO_VOICE === '0') return null;
  const binPath = env.TAMAGO_TRANSCRIBER ?? DEFAULT_TRANSCRIBER_PATH;
  if (!existsSync(binPath)) return null;
  return createTranscriber({ binPath, locale: env.TAMAGO_VOICE_LOCALE ?? 'en_CA' });
}

export function createTranscriber({ binPath, locale = 'en_CA', timeoutMs = 15_000, execFileImpl = execFile }) {
  return {
    name: 'apple-speech',
    transcribe(file, { signal } = {}) {
      return new Promise((resolve, reject) => {
        execFileImpl(binPath, [file, locale], { timeout: timeoutMs, signal, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            const e = new Error(`transcriber failed: ${String(stderr || err.message).trim().slice(0, 200)}`);
            e.code = signal?.aborted ? 'aborted' : 'transcriber_failed';
            return reject(e);
          }
          resolve(String(stdout).trim());
        });
      });
    },
  };
}

/**
 * SpeechTranscriber turns trailing silence into punctuation runs
 * ("What's my dog?,,',',,," on the owner's Watch). Drop those; keep real words.
 */
export function cleanTranscript(text) {
  return String(text)
    .replace(/(\s*[,'’"]\s*){2,}/g, ' ')
    .replace(/^[\s,'’"]+|[\s,'’"]+$/g, '')
    .replace(/\s+([?.!])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
