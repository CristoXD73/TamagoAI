import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  CHARACTER_STATES,
  REACTION_STATES,
  HAPTICS,
  ERRORS,
  LIMITS,
  ProtocolError,
  parseRequest,
  isUuid,
  buildOkResponse,
  buildErrorResponse,
} from './protocol.js';
import { ProviderError } from './providers/provider.js';
import { cleanTranscript } from './transcriber.js';
import { prepareSpeechText } from './tts.js';

export const GATEWAY_VERSION = '0.1.0';

const DEDUPE_MAX_ENTRIES = 256;
const DEDUPE_TTL_MS = 10 * 60 * 1000;
// PROTOCOL_V1 §16: synthesized replies wait here for the Watch to fetch them.
const SPEECH_MAX_ENTRIES = 32;
const SPEECH_TTL_MS = 2 * 60 * 1000;
const SPEECH_WAIT_MS = 2500;

const silentLogger = { info() {}, warn() {}, error() {} };

/**
 * Creates (but does not start) the gateway HTTP server.
 *
 * @param {object} opts
 * @param {object} opts.provider         AIProvider (see providers/provider.js)
 * @param {string|null} opts.authToken   Bearer token; null disables auth (dev only)
 * @param {number} [opts.timeoutMs]      provider timeout, default 20000
 * @param {object} [opts.logger]         { info, warn, error } taking one object
 * @param {() => number} [opts.now]      clock, injectable for tests
 * @param {string|null} [opts.gatewayId] public, stable identity (identity.js)
 * @param {string} [opts.gatewayName]    human-readable name shown at pairing
 * @param {object|null} [opts.pairing]   a pairing window (pairing.js); null disables POST /v1/pair
 * @param {object|null} [opts.transcriber] speech-to-text (transcriber.js); null disables POST /v1/audio
 * @param {string|null} [opts.keepAudioDir] DIAGNOSTICS ONLY (TAMAGO_KEEP_AUDIO_DIR): keep a copy of each
 *   recording + its transcript there. Off by default; the owner's voice is otherwise never stored.
 * @param {object|null} [opts.synthesizer] text-to-speech (tts.js); null = no `speechAudio` (§16)
 * @param {number} [opts.speechWaitMs]   how long GET /v1/speech waits for a pending synthesis
 * @param {Function|null} [opts.monitor] OWNER'S LIVE VIEW ONLY (TAMAGO_MONITOR=1, monitor.js): gets each
 *   hop of a conversation, including what was heard and said, to print on the owner's own terminal.
 *   Never persisted and never mixed into `logger`, which stays metadata-only. Off by default.
 */
export function createGateway({
  provider, authToken, timeoutMs = 20000, logger = silentLogger, now = Date.now,
  gatewayId = null, gatewayName = 'TamagoAI', pairing = null, transcriber = null, keepAudioDir = null,
  synthesizer = null, speechWaitMs = SPEECH_WAIT_MS, monitor = null,
}) {
  if (!provider || typeof provider.generate !== 'function') {
    throw new Error('createGateway requires a provider with generate().');
  }
  if (authToken !== null && (typeof authToken !== 'string' || authToken.length === 0)) {
    throw new Error('authToken must be a non-empty string, or null to explicitly disable auth.');
  }

  const startedAt = now();
  const expectedTokenHash = authToken === null ? null : sha256(authToken);
  // requestId -> { at, promise<{ httpStatus, body }> }
  const recent = new Map();
  // requestId -> { at, state: 'pending'|'ready'|'failed', promise, audio?, controller }
  const speech = new Map();

  // A broken monitor must never break a conversation.
  const show = (event) => {
    if (!monitor) return;
    try { monitor({ at: now(), ...event }); } catch { /* the live view is best-effort */ }
  };
  const showReply = (requestId, body, ms) => show(body.status === 'ok'
    ? { kind: 'reply', requestId, text: body.text, characterState: body.characterState, haptic: body.haptic, ms }
    : { kind: 'reply_error', requestId, code: body.error?.code, message: body.error?.message, ms });

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      logger.error({ event: 'unhandled', message: err?.message });
      if (!res.headersSent) {
        send(res, 500, buildErrorResponse(null, 'internal_error'));
      } else {
        res.destroy();
      }
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://gateway.local');
    const route = `${req.method} ${url.pathname}`;

    if (url.pathname === '/v1/health') {
      if (req.method !== 'GET') return sendError(res, null, 'method_not_allowed');
      // The Watch probes health when Tamago comes to the front: a good moment to
      // load the local model so the first question doesn't pay for it. The
      // provider rate-limits this; it never blocks the answer.
      // The owner's dashboard polls with ?monitor=1: that's not the Watch, and not a reason to load the model.
      if (!url.searchParams.has('monitor')) {
        provider.warm?.().catch(() => {});
        show({ kind: 'health', from: peer(req) });
      }
      return send(res, 200, {
        status: 'ok',
        protocolVersion: PROTOCOL_VERSION,
        gatewayVersion: GATEWAY_VERSION,
        uptimeSeconds: Math.floor((now() - startedAt) / 1000),
        ...(gatewayId ? { gatewayId } : {}),
      });
    }

    if (url.pathname === '/v1/pair') {
      if (req.method !== 'POST') return sendError(res, null, 'method_not_allowed');
      return handlePair(req, res);
    }

    if (url.pathname === '/v1/protocol') {
      if (req.method !== 'GET') return sendError(res, null, 'method_not_allowed');
      return send(res, 200, {
        protocolVersion: PROTOCOL_VERSION,
        supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
        gatewayVersion: GATEWAY_VERSION,
        provider: provider.name ?? 'unknown',
        authRequired: expectedTokenHash !== null,
        inputTypes: transcriber ? ['text', 'audio'] : ['text'],
        outputTypes: synthesizer ? ['text', 'speech-audio'] : ['text'],
        characterStates: CHARACTER_STATES,
        reactionStates: REACTION_STATES,
        haptics: HAPTICS,
        errorCodes: Object.keys(ERRORS),
        limits: LIMITS,
        ...(gatewayId ? { gatewayId } : {}),
      });
    }

    if (url.pathname === '/v1/request') {
      if (req.method !== 'POST') return sendError(res, null, 'method_not_allowed');
      return handleRequest(req, res);
    }

    if (url.pathname === '/v1/audio') {
      if (req.method !== 'POST') return sendError(res, null, 'method_not_allowed');
      return handleAudio(req, res);
    }

    if (url.pathname.startsWith('/v1/speech/')) {
      if (req.method !== 'GET') return sendError(res, null, 'method_not_allowed');
      return handleSpeech(req, res, url.pathname.slice('/v1/speech/'.length));
    }

    logger.info({ event: 'not_found', route });
    return sendError(res, null, 'not_found');
  }

  async function handleRequest(req, res) {
    const started = now();

    if (!isAuthorized(req.headers.authorization)) {
      // Drain without buffering so the client sees the 401 rather than a reset.
      req.resume();
      logger.warn({ event: 'request', status: 'error', code: 'auth_failed' });
      show({ kind: 'auth_failed', route: 'request', from: peer(req) });
      return sendError(res, null, 'auth_failed', 'Missing or invalid bearer token.');
    }

    let raw;
    try {
      raw = await readBody(req, LIMITS.maxBodyBytes);
    } catch (err) {
      if (err.code === 'payload_too_large') {
        return sendError(res, null, 'payload_too_large', `Body exceeds ${LIMITS.maxBodyBytes} bytes.`);
      }
      throw err;
    }

    let request;
    try {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ProtocolError('invalid_request', 'Body is not valid JSON.');
      }
      request = parseRequest(parsed);
    } catch (err) {
      if (err instanceof ProtocolError) {
        logger.info({ event: 'request', requestId: err.requestId, status: 'error', code: err.code });
        return sendError(res, err.requestId, err.code, err.message);
      }
      throw err;
    }

    pruneRecent();
    let entry = recent.get(request.requestId);
    const duplicate = entry !== undefined;
    show({ kind: 'text_in', requestId: request.requestId, text: request.text, from: peer(req), duplicate });
    if (!entry) {
      entry = { at: now(), promise: runProvider(request).then(attachSpeech) };
      recent.set(request.requestId, entry);
    }
    const { httpStatus, body } = await entry.promise;

    // Log metadata only — never the user's text or the model's answer.
    logger.info({
      event: 'request',
      requestId: request.requestId,
      status: body.status,
      code: body.error?.code,
      duplicate,
      ms: now() - started,
    });
    showReply(request.requestId, body, now() - started);
    return send(res, httpStatus, body);
  }

  // PROTOCOL_V1 §15: hold-to-talk. The body is the recorded audio; the Mac
  // transcribes it on-device, then it's an ordinary text request. The audio
  // lives in a private temp dir only while it's transcribed, and neither it
  // nor the transcript is ever logged. The transcript rides back in the V1
  // envelope as an extra `transcript` field (older clients ignore it).
  async function handleAudio(req, res) {
    const started = now();
    if (!isAuthorized(req.headers.authorization)) {
      req.resume();
      logger.warn({ event: 'audio', status: 'error', code: 'auth_failed' });
      show({ kind: 'auth_failed', route: 'audio', from: peer(req) });
      return sendError(res, null, 'auth_failed', 'Missing or invalid bearer token.');
    }
    const requestId = String(req.headers['x-tamago-request-id'] ?? '').toLowerCase();
    const version = Number(req.headers['x-tamago-protocol-version'] ?? PROTOCOL_VERSION);
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
      req.resume();
      return sendError(res, isUuid(requestId) ? requestId : null, 'unsupported_protocol', `Protocol version ${version} is not supported.`);
    }
    if (!isUuid(requestId)) {
      req.resume();
      return sendError(res, null, 'invalid_request', 'x-tamago-request-id must be a UUID.');
    }
    if (!contentType.startsWith('audio/')) {
      req.resume();
      return sendError(res, requestId, 'invalid_request', 'content-type must be audio/*.');
    }
    if (!transcriber) {
      req.resume();
      return sendError(res, requestId, 'provider_unavailable', "Voice input isn't set up on this Mac.");
    }
    let audio;
    try {
      audio = await readBuffer(req, LIMITS.maxAudioBytes);
    } catch (err) {
      if (err.code === 'payload_too_large') {
        return sendError(res, requestId, 'payload_too_large', `Audio exceeds ${LIMITS.maxAudioBytes} bytes.`);
      }
      throw err;
    }
    if (audio.length === 0) return sendError(res, requestId, 'invalid_request', 'Audio body is empty.');

    pruneRecent();
    let entry = recent.get(requestId);
    const duplicate = entry !== undefined;
    show({ kind: 'audio_in', requestId, bytes: audio.length, from: peer(req), duplicate });
    if (!entry) {
      entry = { at: now(), promise: runAudio(requestId, audio, contentType).then(attachSpeech) };
      recent.set(requestId, entry);
    }
    const { httpStatus, body, transcribeMs } = await entry.promise;
    logger.info({
      event: 'audio', requestId, status: body.status, code: body.error?.code, duplicate,
      bytes: audio.length, transcribeMs, ms: now() - started,
    });
    showReply(requestId, body, now() - started);
    return send(res, httpStatus, body);
  }

  async function runAudio(requestId, audio, contentType) {
    const ext = /wav/.test(contentType) ? 'wav' : /aiff/.test(contentType) ? 'aiff' : 'm4a';
    const dir = await mkdtemp(join(tmpdir(), 'tamago-audio-'));
    const file = join(dir, `utterance.${ext}`);
    const t0 = now();
    let transcript;
    try {
      await writeFile(file, audio, { mode: 0o600 });
      transcript = cleanTranscript(await transcriber.transcribe(file));
      if (keepAudioDir) {
        await mkdir(keepAudioDir, { recursive: true, mode: 0o700 });
        await copyFile(file, join(keepAudioDir, `${requestId}.${ext}`));
        await writeFile(join(keepAudioDir, `${requestId}.txt`), `${transcript}\n`, { mode: 0o600 });
        logger.warn({ event: 'audio_kept', requestId, dir: keepAudioDir });
      }
    } catch (err) {
      logger.warn({ event: 'transcribe_failed', requestId, message: err?.message?.slice(0, 200) });
      show({ kind: 'heard_failed', requestId, message: err?.message?.slice(0, 200), ms: now() - t0 });
      return { ...errorOutcome(requestId, 'provider_error', "Couldn't make out the audio."), transcribeMs: now() - t0 };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const transcribeMs = now() - t0;
    show({ kind: 'heard', requestId, text: transcript, ms: transcribeMs });
    if (!transcript) {
      // Heard nothing usable. Say so: a silent shrug looked like "no reply" on
      // the owner's Watch (first hold-to-talk run, 2026-09-27).
      return {
        httpStatus: 200, transcribeMs,
        body: { ...buildOkResponse(requestId, { text: "I didn't catch that.", characterState: 'confused', haptic: 'notification' }), transcript: '' },
      };
    }
    let request;
    try {
      request = parseRequest({ protocolVersion: PROTOCOL_VERSION, requestId, inputType: 'text',
        text: transcript.slice(0, LIMITS.maxInputTextChars), client: { route: 'audio' } });
    } catch (err) {
      if (err instanceof ProtocolError) return { ...errorOutcome(requestId, err.code, err.message), transcribeMs };
      throw err;
    }
    const outcome = await runProvider(request);
    return { ...outcome, body: { ...outcome.body, transcript: request.text }, transcribeMs };
  }

  // PROTOCOL_V1 §16. An ok reply with speech gets `speechAudio` and starts
  // synthesis in the background: the text reply is never held back for audio.
  // Runs once per requestId (dedupe shares the same promise). Never logs text.
  function attachSpeech(outcome) {
    const body = outcome.body;
    if (!synthesizer || outcome.httpStatus !== 200 || body.status !== 'ok' || !body.speechText || !body.requestId) return outcome;
    const text = prepareSpeechText(body.speechText);
    if (!text) return outcome;
    startSynthesis(body.requestId, text);
    const speechAudio = { path: `/v1/speech/${body.requestId}`, format: 'audio/mp4', voice: synthesizer.voice || synthesizer.engine };
    return { ...outcome, body: { ...body, speechAudio } };
  }

  function startSynthesis(requestId, text) {
    pruneSpeech();
    if (speech.has(requestId)) return;
    const controller = new AbortController();
    const t0 = now();
    const entry = { at: t0, state: 'pending', controller };
    entry.promise = synthesizer.synthesize(text, { signal: controller.signal }).then(
      (audio) => {
        entry.state = 'ready';
        entry.audio = audio;
        logger.info({ event: 'speech_synth', requestId, engine: synthesizer.engine, voice: synthesizer.voice, bytes: audio.length, ms: now() - t0 });
        show({ kind: 'voice_ready', requestId, voice: `${synthesizer.engine}/${synthesizer.voice || 'default'}`, bytes: audio.length, ms: now() - t0, audio });
      },
      (err) => {
        entry.state = 'failed';
        logger.warn({ event: 'speech_synth_failed', requestId, engine: synthesizer.engine, code: err?.code, ms: now() - t0 });
        show({ kind: 'voice_failed', requestId, code: err?.code, message: err?.message?.slice(0, 200), ms: now() - t0 });
      },
    );
    speech.set(requestId, entry);
  }

  function pruneSpeech() {
    const cutoff = now() - SPEECH_TTL_MS;
    for (const [id, entry] of speech) {
      if (entry.at < cutoff || speech.size >= SPEECH_MAX_ENTRIES) {
        entry.controller.abort();
        speech.delete(id);
      } else break;
    }
  }

  async function handleSpeech(req, res, rawId) {
    const started = now();
    if (!isAuthorized(req.headers.authorization)) {
      logger.warn({ event: 'speech', status: 'error', code: 'auth_failed' });
      show({ kind: 'auth_failed', route: 'speech', from: peer(req) });
      return sendError(res, null, 'auth_failed', 'Missing or invalid bearer token.');
    }
    const requestId = rawId.toLowerCase();
    if (!isUuid(requestId)) return sendError(res, null, 'invalid_request', 'Speech path must end in a request UUID.');
    pruneSpeech();
    const entry = speech.get(requestId);
    if (!entry) {
      logger.info({ event: 'speech', requestId, status: 404 });
      show({ kind: 'voice_fetch', requestId, status: 404, from: peer(req) });
      return sendError(res, requestId, 'not_found', 'No speech for this request (never made, already fetched, or expired).');
    }
    if (entry.state === 'pending') {
      let timer;
      await Promise.race([entry.promise, new Promise((r) => { timer = setTimeout(r, speechWaitMs); })]);
      clearTimeout(timer);
    }
    if (entry.state !== 'ready') {
      logger.info({ event: 'speech', requestId, status: 503, state: entry.state, waitedMs: now() - started });
      show({ kind: 'voice_fetch', requestId, status: 503, state: entry.state, waitedMs: now() - started, from: peer(req) });
      const message = entry.state === 'failed' ? 'Speech synthesis failed.' : "Speech isn't ready yet.";
      return sendError(res, requestId, 'provider_unavailable', message);
    }
    speech.delete(requestId);   // served once, then gone
    logger.info({ event: 'speech', requestId, status: 200, bytes: entry.audio.length, waitedMs: now() - started });
    show({ kind: 'voice_fetch', requestId, status: 200, bytes: entry.audio.length, waitedMs: now() - started, from: peer(req) });
    res.writeHead(200, {
      'content-type': 'audio/mp4',
      'content-length': entry.audio.length,
      'cache-control': 'no-store',
      'x-request-id': requestId,
    });
    res.end(entry.audio);
  }

  // PROTOCOL_V1 §14. Unauthenticated by necessity (it's how a Watch gets
  // the token); the pairing window's single use, expiry and failure cap are
  // the protection. Never logs the code or the token.
  async function handlePair(req, res) {
    const fail = (status, code, message) =>
      send(res, status, { protocolVersion: PROTOCOL_VERSION, error: { code, message } });

    if (!pairing || authToken === null) {
      req.resume();
      return fail(404, 'pairing_unavailable', 'This gateway is not accepting pairing.');
    }
    let body;
    try {
      body = JSON.parse(await readBody(req, LIMITS.maxBodyBytes));
    } catch {
      return fail(400, 'invalid_request', 'Body must be JSON: {"pairingCode": "123456"}.');
    }
    const outcome = pairing.attempt(body?.pairingCode);
    const deviceName = typeof body?.deviceName === 'string' ? body.deviceName.slice(0, 64) : undefined;
    logger.info({ event: 'pair', outcome, deviceName });
    show({ kind: 'pair', outcome, deviceName, from: peer(req) });
    if (outcome === 'closed') {
      return fail(410, 'pairing_closed', 'No pairing window is open. Restart the gateway to get a new code.');
    }
    if (outcome !== 'ok') return fail(401, 'pairing_failed', 'Wrong pairing code.');
    return send(res, 200, { protocolVersion: PROTOCOL_VERSION, gatewayId, gatewayName, token: authToken });
  }

  async function runProvider(request) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort(new ProviderError('timeout', 'Provider timed out.'));
        resolve('timeout');
      }, timeoutMs);
    });

    try {
      const outcome = await Promise.race([
        provider.generate(request, { signal: controller.signal }).then((result) => ({ result })),
        timeout,
      ]);
      if (outcome === 'timeout') {
        return errorOutcome(request.requestId, 'timeout', `No answer within ${timeoutMs} ms.`);
      }
      return { httpStatus: 200, body: buildOkResponse(request.requestId, outcome.result) };
    } catch (err) {
      if (controller.signal.aborted) {
        return errorOutcome(request.requestId, 'timeout', `No answer within ${timeoutMs} ms.`);
      }
      if ((err instanceof ProviderError || err instanceof ProtocolError) && ERRORS[err.code]) {
        return errorOutcome(request.requestId, err.code, err.message);
      }
      logger.error({ event: 'provider_exception', requestId: request.requestId, message: err?.message });
      return errorOutcome(request.requestId, 'provider_error', 'Provider failed unexpectedly.');
    } finally {
      clearTimeout(timer);
    }
  }

  function errorOutcome(requestId, code, message) {
    return { httpStatus: ERRORS[code].http, body: buildErrorResponse(requestId, code, message) };
  }

  function pruneRecent() {
    const cutoff = now() - DEDUPE_TTL_MS;
    for (const [id, entry] of recent) {
      if (entry.at < cutoff || recent.size >= DEDUPE_MAX_ENTRIES) recent.delete(id);
      else break; // Map preserves insertion order, so the rest are newer.
    }
  }

  function isAuthorized(header) {
    if (expectedTokenHash === null) return true;
    if (typeof header !== 'string') return false;
    const m = /^Bearer (.+)$/.exec(header);
    if (!m) return false;
    return timingSafeEqual(sha256(m[1]), expectedTokenHash);
  }

  function sendError(res, requestId, code, message) {
    return send(res, ERRORS[code].http, buildErrorResponse(requestId, code, message));
  }

  return server;
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  };
  if (typeof body.requestId === 'string') headers['x-request-id'] = body.requestId;
  res.writeHead(status, headers);
  res.end(payload);
}

function readBody(req, maxBytes) {
  return readBuffer(req, maxBytes).then((buf) => buf.toString('utf8'));
}

function readBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return; // keep draining so we can still answer with 413
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        const err = new Error('payload too large');
        err.code = 'payload_too_large';
        reject(err);
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', reject);
  });
}

function peer(req) {
  return (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest();
}
