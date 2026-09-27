// Apple Tamago protocol v1 — the single source of truth for enum strings on the
// gateway side. docs/PROTOCOL_V1.md and Apple/Shared/TamagoProtocolV1.swift must
// stay in sync with this file; test/fixtures.test.js enforces the fixtures.

export const PROTOCOL_VERSION = 1;
export const SUPPORTED_PROTOCOL_VERSIONS = [1];

export const INPUT_TYPES = ['text'];

export const RESPONSE_STATUSES = ['ok', 'accepted', 'error'];

export const CHARACTER_STATES = [
  'sleeping',
  'idle',
  'listening',
  'acknowledging',
  'thinking',
  'toolRunning',
  'speaking',
  'happy',
  'success',
  'confused',
  'error',
  'disconnected',
];

// States a gateway/provider may put in a response. The rest are driven locally
// by the Watch (listening, thinking, speaking, ...) and never come from the Mac.
export const REACTION_STATES = ['idle', 'happy', 'success', 'confused', 'error'];

export const HAPTICS = ['none', 'click', 'success', 'failure', 'notification', 'retry'];

// code -> { http, retryable, characterState, text }
export const ERRORS = {
  invalid_request: {
    http: 400,
    retryable: false,
    characterState: 'confused',
    text: "I didn't understand that request.",
  },
  unsupported_protocol: {
    http: 400,
    retryable: false,
    characterState: 'confused',
    text: 'We speak different protocol versions. Please update me.',
  },
  auth_failed: {
    http: 401,
    retryable: false,
    characterState: 'error',
    text: "My home brain didn't recognize me.",
  },
  not_found: {
    http: 404,
    retryable: false,
    characterState: 'confused',
    text: "That endpoint doesn't exist.",
  },
  method_not_allowed: {
    http: 405,
    retryable: false,
    characterState: 'confused',
    text: 'That method is not allowed here.',
  },
  payload_too_large: {
    http: 413,
    retryable: false,
    characterState: 'confused',
    text: 'That was too much for me to take in.',
  },
  internal_error: {
    http: 500,
    retryable: true,
    characterState: 'error',
    text: 'Something went wrong on my home brain.',
  },
  provider_error: {
    http: 502,
    retryable: true,
    characterState: 'error',
    text: 'My thinking engine had a problem.',
  },
  provider_unavailable: {
    http: 503,
    retryable: true,
    characterState: 'error',
    text: "My thinking engine isn't running right now.",
  },
  timeout: {
    http: 504,
    retryable: true,
    characterState: 'confused',
    text: 'That took too long. Try again?',
  },
  // Client-synthesized only: a gateway never sends these. Listed so Swift and
  // the fixtures share one vocabulary.
  gateway_unavailable: {
    http: null,
    retryable: true,
    characterState: 'disconnected',
    text: "I can't reach my home brain.",
  },
  disconnected: {
    http: null,
    retryable: true,
    characterState: 'disconnected',
    text: "I'm offline right now.",
  },
};

export const ERROR_CODES = Object.keys(ERRORS);

export const LIMITS = {
  maxBodyBytes: 16 * 1024,
  maxAudioBytes: 1024 * 1024,   // POST /v1/audio (§15): ~30 s of 16 kHz mono AAC is well under this
  maxInputTextChars: 2000,
  maxResponseTextChars: 1000,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export class ProtocolError extends Error {
  constructor(code, message, requestId = null) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * Validates a parsed request body. Returns a normalized request or throws
 * ProtocolError. Unknown top-level fields are ignored for forward compatibility.
 */
export function parseRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProtocolError('invalid_request', 'Request body must be a JSON object.');
  }

  const requestId = isUuid(body.requestId) ? body.requestId : null;

  // Version is checked before everything else so that a future v2 client gets
  // a clear unsupported_protocol instead of a confusing field-level error.
  if (!Number.isInteger(body.protocolVersion)) {
    throw new ProtocolError('invalid_request', 'protocolVersion must be an integer.', requestId);
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(body.protocolVersion)) {
    throw new ProtocolError(
      'unsupported_protocol',
      `protocolVersion ${body.protocolVersion} is not supported; supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}.`,
      requestId,
    );
  }

  if (requestId === null) {
    throw new ProtocolError('invalid_request', 'requestId must be a UUID string.');
  }
  if (!INPUT_TYPES.includes(body.inputType)) {
    throw new ProtocolError(
      'invalid_request',
      `inputType must be one of: ${INPUT_TYPES.join(', ')}.`,
      requestId,
    );
  }
  if (typeof body.text !== 'string') {
    throw new ProtocolError('invalid_request', 'text must be a string.', requestId);
  }
  const text = body.text.trim();
  if (text.length === 0) {
    throw new ProtocolError('invalid_request', 'text must not be empty.', requestId);
  }
  if (text.length > LIMITS.maxInputTextChars) {
    throw new ProtocolError(
      'invalid_request',
      `text must be at most ${LIMITS.maxInputTextChars} characters.`,
      requestId,
    );
  }

  let client;
  if (body.client !== undefined) {
    if (body.client === null || typeof body.client !== 'object' || Array.isArray(body.client)) {
      throw new ProtocolError('invalid_request', 'client must be an object when present.', requestId);
    }
    client = {};
    for (const key of ['device', 'route', 'appVersion']) {
      if (body.client[key] !== undefined) {
        if (typeof body.client[key] !== 'string') {
          throw new ProtocolError('invalid_request', `client.${key} must be a string.`, requestId);
        }
        client[key] = body.client[key];
      }
    }
  }

  return {
    protocolVersion: body.protocolVersion,
    requestId: requestId.toLowerCase(),
    inputType: body.inputType,
    text,
    ...(client ? { client } : {}),
  };
}

/**
 * Turns a provider result into a protocol response. Throws ProtocolError
 * ('provider_error') if the provider returned something outside the contract,
 * so a misbehaving model can never push an unknown enum to the Watch.
 */
export function buildOkResponse(requestId, result) {
  if (result === null || typeof result !== 'object') {
    throw new ProtocolError('provider_error', 'Provider returned no result.', requestId);
  }
  // Nonverbal reaction (PROTOCOL_V1 §5.1): no speech, no caption, only a
  // reaction state + haptic. Existing Watch clients already handle this
  // (an empty speechText skips TTS in CharacterStateMachine).
  const nonverbal = result.nonverbal === true;
  const text = nonverbal ? '' : typeof result.text === 'string' ? result.text.trim() : '';
  if (!nonverbal && text.length === 0) {
    throw new ProtocolError('provider_error', 'Provider returned empty text.', requestId);
  }
  const characterState = result.characterState ?? 'idle';
  if (!REACTION_STATES.includes(characterState)) {
    throw new ProtocolError(
      'provider_error',
      `Provider returned non-reaction characterState "${characterState}".`,
      requestId,
    );
  }
  const haptic = result.haptic ?? 'none';
  if (!HAPTICS.includes(haptic)) {
    throw new ProtocolError('provider_error', `Provider returned unknown haptic "${haptic}".`, requestId);
  }
  const speechText = nonverbal
    ? ''
    : typeof result.speechText === 'string' && result.speechText.trim().length > 0
      ? result.speechText.trim()
      : text;

  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    status: 'ok',
    text: truncate(text, LIMITS.maxResponseTextChars),
    speechText: truncate(speechText, LIMITS.maxResponseTextChars),
    characterState,
    haptic,
    followUpExpected: result.followUpExpected === true,
  };
}

export function buildErrorResponse(requestId, code, message) {
  const spec = ERRORS[code] ?? ERRORS.internal_error;
  const finalCode = ERRORS[code] ? code : 'internal_error';
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: requestId ?? null,
    status: 'error',
    text: spec.text,
    speechText: spec.text,
    characterState: spec.characterState,
    haptic: 'failure',
    followUpExpected: false,
    error: {
      code: finalCode,
      message: message ?? spec.text,
      retryable: spec.retryable,
    },
  };
}

/**
 * Structural validator for any v1 response envelope (gateway or
 * client-synthesized). Returns a list of problems; empty means valid.
 * Used by tests to keep fixtures honest.
 */
export function validateResponse(obj) {
  const problems = [];
  const expect = (cond, msg) => {
    if (!cond) problems.push(msg);
  };
  expect(obj && typeof obj === 'object' && !Array.isArray(obj), 'response must be an object');
  if (problems.length) return problems;

  expect(obj.protocolVersion === PROTOCOL_VERSION, 'protocolVersion must be 1');
  expect(obj.requestId === null || isUuid(obj.requestId), 'requestId must be a UUID or null');
  expect(RESPONSE_STATUSES.includes(obj.status), `status must be one of ${RESPONSE_STATUSES}`);
  expect(typeof obj.text === 'string', 'text must be a string');
  expect(typeof obj.speechText === 'string', 'speechText must be a string');
  expect(CHARACTER_STATES.includes(obj.characterState), 'characterState must be a known state');
  expect(HAPTICS.includes(obj.haptic), 'haptic must be a known haptic');
  expect(typeof obj.followUpExpected === 'boolean', 'followUpExpected must be a boolean');

  if (obj.status === 'error') {
    expect(obj.error && typeof obj.error === 'object', 'error object required when status is error');
    if (obj.error && typeof obj.error === 'object') {
      expect(ERROR_CODES.includes(obj.error.code), 'error.code must be a known code');
      expect(typeof obj.error.message === 'string', 'error.message must be a string');
      expect(typeof obj.error.retryable === 'boolean', 'error.retryable must be a boolean');
    }
  } else {
    expect(obj.error === undefined, 'error must be absent unless status is error');
    expect(obj.requestId !== null, 'requestId is required unless status is error');
  }
  // Optional since D-121 (§16). Old clients ignore it.
  if (obj.speechAudio !== undefined) {
    const a = obj.speechAudio;
    expect(obj.status === 'ok', 'speechAudio only on ok responses');
    expect(a && typeof a === 'object' && typeof a.path === 'string' && a.path === `/v1/speech/${obj.requestId}`,
      'speechAudio.path must be /v1/speech/<requestId>');
    expect(a && a.format === 'audio/mp4', 'speechAudio.format must be audio/mp4');
    expect(a && (a.voice === undefined || typeof a.voice === 'string'), 'speechAudio.voice must be a string');
  }
  return problems;
}

function truncate(s, max) {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
