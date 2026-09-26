import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
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
  buildOkResponse,
  buildErrorResponse,
} from './protocol.js';
import { ProviderError } from './providers/provider.js';

export const GATEWAY_VERSION = '0.1.0';

const DEDUPE_MAX_ENTRIES = 256;
const DEDUPE_TTL_MS = 10 * 60 * 1000;

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
 */
export function createGateway({
  provider, authToken, timeoutMs = 20000, logger = silentLogger, now = Date.now,
  gatewayId = null, gatewayName = 'TamagoAI', pairing = null,
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
        inputTypes: ['text'],
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

    logger.info({ event: 'not_found', route });
    return sendError(res, null, 'not_found');
  }

  async function handleRequest(req, res) {
    const started = now();

    if (!isAuthorized(req.headers.authorization)) {
      // Drain without buffering so the client sees the 401 rather than a reset.
      req.resume();
      logger.warn({ event: 'request', status: 'error', code: 'auth_failed' });
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
    if (!entry) {
      entry = { at: now(), promise: runProvider(request) };
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
    return send(res, httpStatus, body);
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
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', reject);
  });
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest();
}
