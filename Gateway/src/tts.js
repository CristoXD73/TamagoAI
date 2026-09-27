// Speech synthesis for GET /v1/speech/<requestId> (PROTOCOL_V1 §16, D-121).
// Runs the local helper tools/tts/tamago-tts (sherpa-onnx + Kokoro/KittenTTS, or
// macOS `say`), exactly like transcriber.js runs tools/transcribe: not an npm
// dependency, installed deliberately on the owner's Mac (tools/tts/setup.sh).
// Without it, speech audio is simply unavailable and the Watch speaks with its
// own voice as before.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TTS_COMMAND = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'tts', 'tamago-tts');
export const ENGINES = ['kokoro', 'kitten', 'say'];
export const DEFAULT_VOICE = { kokoro: 'af_heart', kitten: 'expr-voice-4-f', say: '' };
export const MAX_SPEECH_CHARS = 300;
export const MAX_SPEECH_AUDIO_BYTES = 256 * 1024;

// Kokoro stock voices named like OpenAI's product voices. Never used, so Tamago
// can't be made to sound like them (docs/VOICE_RESEARCH.md §1, VOICE_TASK §2).
export const EXCLUDED_VOICES = new Set(['af_alloy', 'af_nova', 'am_echo', 'am_onyx', 'bm_fable']);

/**
 * @returns {{ name: string, engine: string, voice: string,
 *   synthesize(text: string, opts?: { signal?: AbortSignal }): Promise<Buffer>,
 *   check(): Promise<{ ok: boolean, reason?: string }> } | null}
 */
export function createSynthesizerFromEnv(env = process.env) {
  const engine = (env.TAMAGO_TTS ?? 'off').toLowerCase();
  if (engine === 'off' || engine === '0' || engine === '') return null;
  if (!ENGINES.includes(engine)) throw new Error(`Unknown TAMAGO_TTS "${env.TAMAGO_TTS}" (expected off, ${ENGINES.join(', ')}).`);
  const command = env.TAMAGO_TTS_COMMAND ?? DEFAULT_TTS_COMMAND;
  if (!existsSync(command)) return null;
  const speed = env.TAMAGO_TTS_SPEED === undefined ? 1 : Number(env.TAMAGO_TTS_SPEED);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('TAMAGO_TTS_SPEED must be between 0.5 and 2.');
  return createSynthesizer({
    command, engine, speed,
    voice: env.TAMAGO_TTS_VOICE ?? DEFAULT_VOICE[engine],
    modelDir: env.TAMAGO_TTS_MODEL_DIR,   // owner's Mac: /Volumes/Storage/AI/tts (AGENTS.md §9); never hardcoded
  });
}

export function createSynthesizer({ command, engine, voice = '', speed = 1, modelDir, timeoutMs = 8000, execFileImpl = execFile }) {
  if (EXCLUDED_VOICES.has(String(voice).toLowerCase())) {
    throw new Error(`Voice "${voice}" is excluded: it's named after an OpenAI voice (docs/VOICE_RESEARCH.md).`);
  }
  const env = { ...process.env, ...(modelDir ? { TAMAGO_TTS_MODEL_DIR: modelDir } : {}) };
  const run = (args, { signal } = {}) => new Promise((resolve, reject) => {
    execFileImpl(command, args, { timeout: timeoutMs, signal, env, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`speech helper failed: ${String(stderr || err.message).trim().slice(0, 200)}`);
        e.code = signal?.aborted ? 'aborted' : 'tts_failed';
        return reject(e);
      }
      resolve(String(stdout));
    });
  });

  return {
    name: engine,
    engine,
    voice,
    /**
     * Text goes to the helper in a private temp file, never on a command line.
     * Returns AAC-in-MP4 bytes (audio/mp4). The temp dir is always removed.
     */
    async synthesize(text, { signal } = {}) {
      const dir = await mkdtemp(join(tmpdir(), 'tamago-tts-'));
      try {
        const textFile = join(dir, 'reply.txt');
        const outFile = join(dir, 'reply.m4a');
        await writeFile(textFile, text, { mode: 0o600 });
        await run(['--engine', engine, '--voice', voice, '--speed', String(speed), '--text-file', textFile, '--out', outFile], { signal });
        const audio = await readFile(outFile);
        if (audio.length === 0) throw Object.assign(new Error('speech helper produced no audio'), { code: 'tts_failed' });
        if (audio.length > MAX_SPEECH_AUDIO_BYTES) throw Object.assign(new Error(`speech audio too large (${audio.length} bytes)`), { code: 'tts_failed' });
        return audio;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    /** Asks the helper whether its engine and model files are in place (no synthesis). */
    async check() {
      try {
        await run(['--engine', engine, '--voice', voice, '--check']);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err.message };
      }
    },
  };
}

// ---------------------------------------------------------------- text prep

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const WORDS = [
  [/(\d)\s?%/g, '$1 percent'],
  [/(\d)\s?°\s?C\b/g, '$1 degrees Celsius'],
  [/(\d)\s?°\s?F\b/g, '$1 degrees Fahrenheit'],
  [/(\d)\s?°/g, '$1 degrees'],
  [/(\d)\s?km\/h\b/gi, '$1 kilometers per hour'],
  [/(\d)\s?mph\b/gi, '$1 miles per hour'],
  [/(\d)\s?km\b/g, '$1 kilometers'],
  [/(\d)\s?kg\b/g, '$1 kilograms'],
  [/(\d)\s?GB\b/g, '$1 gigabytes'],
  [/(\d)\s?MB\b/g, '$1 megabytes'],
  [/\be\.g\./gi, 'for example'],
  [/\bi\.e\./gi, 'that is'],
  [/\betc\./gi, 'and so on'],
  [/\bvs\.?(?=\s)/gi, 'versus'],
  [/\s&\s/g, ' and '],
  [/\+/g, ' plus '],
];

/**
 * The composer's final speech string, made safe and natural for a neural voice:
 * no markdown, emoji or URLs; common units and abbreviations spelled out; capped
 * at a sentence boundary. Returns '' when nothing speakable is left.
 */
export function prepareSpeechText(text, maxChars = MAX_SPEECH_CHARS) {
  let s = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S*[^\s.,!?;:)]/g, 'a link')
    .replace(/[*_#>~|]+/g, ' ')
    .replace(EMOJI, ' ');
  for (const [re, to] of WORDS) s = s.replace(re, to);
  s = s.replace(/\s+/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
  if (!/[\p{L}\p{N}]/u.test(s)) return '';
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > maxChars * 0.4 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ')).trim()}.`;
}
