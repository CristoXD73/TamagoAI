// listening.js: listening mode (PROTOCOL_V1 §19, D-130).
//
// The Watch records without stopping and sends the audio in chunks of about a minute. Each chunk is kept on disk,
// transcribed on the Mac (the same Apple SpeechAnalyzer helper as hold-to-talk), cleaned of filler words, and
// appended to one readable transcript per session:
//
//   $TAMAGO_STATE_DIR/listening/<YYYY-MM-DD_HHMM>_<session8>/
//     meta.json                     session id, start, and each chunk's start time and state
//     chunk-000001.m4a              the audio, as the Watch recorded it (the owner asked to keep it)
//     chunk-000001.raw.txt          what the transcriber heard
//     chunk-000001.txt              the cleaned text
//     transcript.md                 every cleaned chunk in order, with the time it was said
//
// Unlike every other gateway path, this one saves words: the owner turned listening mode on for exactly that.
// Nothing is logged (log lines carry session, sequence, bytes and timings only), and the folder is owner-only.
//
// Cleaning happens in two steps:
// 1. Rules: fillers (um, uh, er…), stutters, comma-bound "you know" / "I mean" / "like". Always run.
// 2. The local model, if one is given: false starts, context-dependent fillers, punctuation. Its output is kept only
//    if it still carries the words (never a summary, never an answer); otherwise the rule-cleaned text stands.
// Chunks are processed one at a time, in the order they arrive, so a long recording never floods the Mac.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanTranscript } from './transcriber.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SEQ = 1_000_000;
/** A chunk is about a minute; SpeechAnalyzer needs a few seconds for it, more on a busy Mac. */
const TRANSCRIBE_TIMEOUT_MS = 180_000;

// ── Filler removal (step 1) ─────────────────────────────────────────────────────────────────────────────────────

/** Sounds that are never words. "mhm" and "uh-huh" stay: they answer something. */
const FILLER = '(?:u+m+|u+h+m*|e+r+m+|e+r+|a+h+|h+m+|m{2,}|u+n+|e+h+)';
const FILLER_SOUNDS = new RegExp(`(^|[\\s,.;!?])${FILLER}(?=$|[\\s,.;!?])[,]?`, 'gi');
/** ", uh," and ", you know," only had commas because of the filler: "I was, uh, thinking" → "I was thinking". */
const COMMA_BOUND = new RegExp(`,\\s*(?:${FILLER}|you know|i mean|like|sort of|kind of|basically|literally)\\s*(?:,|(?=[.!?]))`, 'gi');
/** Doubled words kept on purpose ("that that", "very very", "no no"). */
const INTENTIONAL_REPEATS = new Set(['that', 'had', 'very', 'really', 'so', 'no', 'bye', 'ha', 'now', 'yeah', 'go', 'well']);

export function removeFillers(text) {
  let s = ` ${String(text ?? '')} `;
  s = s.replace(COMMA_BOUND, ' ');
  s = s.replace(FILLER_SOUNDS, '$1');
  s = s.replace(/([.!?]\s+|^\s*)(?:so\s*,\s*)?(?:like|you know|i mean|well|okay so|so)\s*,\s*/gi, '$1');
  // Stutters: "I I think", "the the", "we we we". A trailing comma between them counts ("I, I think").
  s = s.replace(/\b([\p{L}']+)(?:[\s,]+\1\b)+/giu, (all, word) => (INTENTIONAL_REPEATS.has(word.toLowerCase()) ? all : word));
  s = s
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([,;])(?:\s*[,;])+/g, '$1')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/(^|[.!?]\s+)[,;]\s*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[,;.\s]+/, '');
  // Capitals after sentence ends, and at the start.
  s = s.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (m, lead, ch) => lead + ch.toUpperCase());
  s = s.replace(/\bi\b/g, 'I');
  return s;
}

const words = (t) => (String(t).match(/[\p{L}\p{N}']+/gu) ?? []).length;

// ── The local model (step 2) ────────────────────────────────────────────────────────────────────────────────────

const POLISH_SYSTEM = `You clean up a transcript of one person talking, recorded on their watch.
Remove filler words (um, uh, like, you know, I mean, sort of, kind of, basically) where they are only filler,
false starts, stutters and repeated words. Fix punctuation and capital letters, and split run-on speech into sentences.
Keep everything the person actually said, in their own words and order. Never summarize, shorten ideas, answer,
explain, translate or add anything. If a word is unclear, keep it as it is.
Reply with the cleaned transcript only: no heading, no quotes, no notes.`;

/**
 * An Ollama-backed polisher: `(text) => Promise<string|null>`. null means "keep the rule-cleaned text".
 * @param {{ model: string, baseUrl?: string, fetchImpl?: Function, timeoutMs?: number }} o
 */
export function createPolisher({ model, baseUrl = 'http://127.0.0.1:11434', fetchImpl = fetch, timeoutMs = 90_000 }) {
  if (!model) return null;
  return async function polish(text) {
    const res = await fetchImpl(new URL('/api/chat', baseUrl).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, think: false, keep_alive: '60m',
        options: { temperature: 0, num_ctx: 4096 },
        messages: [{ role: 'system', content: POLISH_SYSTEM }, { role: 'user', content: text }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    return String((await res.json()).message?.content ?? '').trim();
  };
}

/**
 * Keeps the model's version only if it is plausibly the same speech, cleaned: not empty, no preamble, and between
 * 55% and 110% of the words (fillers go, content stays). Otherwise null.
 */
export function acceptPolished(before, after) {
  let out = String(after ?? '').trim().replace(/^["“](.*)["”]$/s, '$1').trim();
  if (!out || /^(here('s| is)|sure|cleaned|transcript)\b/i.test(out)) return null;
  const a = words(before), b = words(out);
  if (a === 0) return null;
  if (b < Math.max(1, Math.floor(a * 0.55)) || b > Math.ceil(a * 1.1) + 1) return null;
  return out;
}

// ── Sessions ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {string} o.dir                       where sessions live ($TAMAGO_STATE_DIR/listening)
 * @param {object} o.transcriber               transcriber.js ({ transcribe(file, { timeoutMs }) })
 * @param {Function|null} [o.polish]           createPolisher() or null for rules only
 * @param {() => number} [o.now]
 * @param {object} [o.logger]                  metadata only
 * @param {Function} [o.show]                  the owner's live view (words allowed there, as for hold-to-talk)
 */
export function createListening({ dir, transcriber, polish = null, now = Date.now, logger = null, show = () => {} }) {
  if (!dir) throw new Error('listening needs a directory');
  if (!transcriber) throw new Error('listening needs a transcriber');
  const folders = new Map();   // session -> folder path
  let queue = Promise.resolve();
  let pending = 0;

  const pad = (n) => String(n).padStart(6, '0');
  const stamp = (ms) => {
    const d = new Date(ms);
    const two = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}`;
  };

  function folderFor(session, startedAt) {
    if (folders.has(session)) return folders.get(session);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const short = session.slice(0, 8);
    const found = readdirSync(dir).find((n) => n.endsWith(`_${short}`) && existsSync(join(dir, n, 'meta.json'))
      && readJson(join(dir, n, 'meta.json'))?.session === session);
    const folder = join(dir, found ?? `${stamp(startedAt)}_${short}`);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    folders.set(session, folder);
    return folder;
  }

  function readJson(file) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  }

  function meta(folder) {
    return readJson(join(folder, 'meta.json'));
  }

  function saveMeta(folder, m) {
    writeFileSync(join(folder, 'meta.json'), `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
  }

  function clock(ms) {
    return new Date(ms).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function writeTranscript(folder) {
    const m = meta(folder);
    if (!m) return '';
    const day = new Date(m.startedAt).toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const lines = [`# Listening, ${day}`, '', `Started ${clock(m.startedAt)}${m.endedAt ? `, stopped ${clock(m.endedAt)}` : ''}.`, ''];
    let text = '';
    for (const seq of Object.keys(m.chunks).map(Number).sort((a, b) => a - b)) {
      const c = m.chunks[seq];
      const file = join(folder, `chunk-${pad(seq)}.txt`);
      if (c.state === 'done' && existsSync(file)) {
        const t = readFileSync(file, 'utf8').trim();
        if (t) { lines.push(`**${clock(c.startedAt)}** ${t}`, ''); text += `${t}\n`; }
      } else if (c.state === 'failed') {
        lines.push(`**${clock(c.startedAt)}** _(couldn't transcribe this part; the audio is in chunk-${pad(seq)}.m4a)_`, '');
      }
    }
    writeFileSync(join(folder, 'transcript.md'), `${lines.join('\n').trimEnd()}\n`, { mode: 0o600 });
    return text;
  }

  async function runChunk(session, seq, folder, ext) {
    const audioFile = join(folder, `chunk-${pad(seq)}.${ext}`);
    const t0 = now();
    let raw = '', clean = '', how = 'rules';
    try {
      raw = cleanTranscript(await transcriber.transcribe(audioFile, { timeoutMs: TRANSCRIBE_TIMEOUT_MS }));
    } catch (err) {
      const m = meta(folder);
      if (m?.chunks[seq]) { m.chunks[seq].state = 'failed'; saveMeta(folder, m); }
      writeTranscript(folder);
      logger?.warn({ event: 'listen_transcribe_failed', session, seq, message: err?.message?.slice(0, 200) });
      show({ kind: 'listen_failed', session, seq, message: err?.message?.slice(0, 200) });
      return;
    }
    const transcribeMs = now() - t0;
    clean = removeFillers(raw);
    if (polish && words(clean) >= 4) {
      try {
        const better = acceptPolished(clean, await polish(clean));
        if (better) { clean = better; how = 'model'; }
      } catch (err) {
        logger?.warn({ event: 'listen_polish_failed', session, seq, message: err?.message?.slice(0, 120) });
      }
    }
    writeFileSync(join(folder, `chunk-${pad(seq)}.raw.txt`), `${raw}\n`, { mode: 0o600 });
    writeFileSync(join(folder, `chunk-${pad(seq)}.txt`), `${clean}\n`, { mode: 0o600 });
    const m = meta(folder);
    if (m?.chunks[seq]) {
      Object.assign(m.chunks[seq], { state: 'done', words: words(clean), cleanedBy: how });
      saveMeta(folder, m);
    }
    writeTranscript(folder);
    logger?.info({ event: 'listen_chunk_done', session, seq, words: words(clean), cleanedBy: how, transcribeMs, ms: now() - t0 });
    show({ kind: 'listen_text', session, seq, text: clean, ms: now() - t0 });
  }

  return {
    get dir() { return dir; },
    /** Chunks received but not yet transcribed. */
    get pending() { return pending; },
    /** Resolves when every queued chunk is processed (tests, shutdown). */
    idle() { return queue; },

    /**
     * Stores one chunk and queues it. Re-sending the same (session, seq) is safe: the file is replaced and it's
     * reported as a duplicate, so a Watch that lost the reply can simply retry.
     * @returns {{ session: string, seq: number, duplicate: boolean }}
     */
    acceptChunk({ session, seq, startedAt, contentType = 'audio/mp4', audio }) {
      session = String(session ?? '').toLowerCase();
      if (!UUID_RE.test(session)) throw Object.assign(new Error('x-tamago-listen-session must be a UUID.'), { code: 'invalid_request' });
      seq = Number(seq);
      if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) throw Object.assign(new Error('x-tamago-listen-seq must be a whole number.'), { code: 'invalid_request' });
      if (!audio?.length) throw Object.assign(new Error('Audio body is empty.'), { code: 'invalid_request' });
      let at = typeof startedAt === 'number' ? startedAt : Date.parse(String(startedAt ?? ''));
      if (!Number.isFinite(at) || at < Date.UTC(2020, 0, 1) || at > now() + 86_400_000) at = now();
      const ext = /wav/.test(contentType) ? 'wav' : /aiff/.test(contentType) ? 'aiff' : 'm4a';

      const folder = folderFor(session, at);
      const m = meta(folder) ?? { session, startedAt: at, endedAt: null, chunks: {} };
      m.startedAt = Math.min(m.startedAt, at);
      const duplicate = Boolean(m.chunks[seq]);
      m.chunks[seq] = { startedAt: at, bytes: audio.length, state: 'queued' };
      m.endedAt = m.endedAt && m.endedAt < at ? null : m.endedAt;   // a late chunk after "end" reopens nothing, just fits in
      writeFileSync(join(folder, `chunk-${pad(seq)}.${ext}`), audio, { mode: 0o600 });
      saveMeta(folder, m);

      pending += 1;
      queue = queue.then(() => runChunk(session, seq, folder, ext)).catch((err) => {
        logger?.error({ event: 'listen_process_error', session, seq, message: err?.message?.slice(0, 200) });
      }).finally(() => { pending -= 1; });
      logger?.info({ event: 'listen_chunk', session, seq, bytes: audio.length, duplicate });
      show({ kind: 'listen_chunk', session, seq, bytes: audio.length, duplicate });
      return { session, seq, duplicate };
    },

    /** The Watch stopped listening. Marks the session ended; chunks still in the queue land afterwards. */
    end(session) {
      session = String(session ?? '').toLowerCase();
      if (!UUID_RE.test(session)) throw Object.assign(new Error('session must be a UUID.'), { code: 'invalid_request' });
      const folder = folders.get(session) ?? (() => {
        if (!existsSync(dir)) return null;
        const n = readdirSync(dir).find((f) => f.endsWith(`_${session.slice(0, 8)}`) && readJson(join(dir, f, 'meta.json'))?.session === session);
        return n ? join(dir, n) : null;
      })();
      if (!folder) return { session, chunks: 0 };
      const m = meta(folder);
      m.endedAt = now();
      saveMeta(folder, m);
      queue = queue.then(() => writeTranscript(folder));
      show({ kind: 'listen_end', session, chunks: Object.keys(m.chunks).length });
      return { session, chunks: Object.keys(m.chunks).length };
    },

    /** Newest first: { session, startedAt, endedAt, chunks, words, folder }. */
    sessions(limit = 20) {
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .map((n) => join(dir, n))
        .filter((f) => { try { return statSync(f).isDirectory(); } catch { return false; } })
        .map((f) => ({ f, m: meta(f) }))
        .filter(({ m }) => m?.session)
        .sort((a, b) => b.m.startedAt - a.m.startedAt)
        .slice(0, limit)
        .map(({ f, m }) => ({
          session: m.session, startedAt: new Date(m.startedAt).toISOString(),
          endedAt: m.endedAt ? new Date(m.endedAt).toISOString() : null,
          chunks: Object.keys(m.chunks).length,
          words: Object.values(m.chunks).reduce((n, c) => n + (c.words ?? 0), 0),
          folder: f,
        }));
    },

    /** One session's clean transcript (plain text, in order), or null. */
    transcript(session) {
      const s = this.sessions(1000).find((x) => x.session === String(session).toLowerCase());
      if (!s) return null;
      return { ...s, text: writeTranscript(s.folder) };
    },
  };
}
