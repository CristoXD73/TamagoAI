// Server-derived fixtures: each case is replayed against the live mock gateway.
// `npm run fixtures` writes them; test/fixtures.test.js fails if they drift.
import { ID } from './helpers.js';

export const FIXTURE_TIMEOUT_MS = 100;

export const REQUEST_FIXTURES = {
  'valid-text.json': {
    protocolVersion: 1,
    requestId: '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c',
    inputType: 'text',
    text: 'Turn Jellyfin back on.',
    client: { device: 'watch', route: 'direct', appVersion: '0.1.0' },
  },
  'valid-minimal.json': { protocolVersion: 1, requestId: ID(1), inputType: 'text', text: 'ping' },
  'invalid-missing-text.json': { protocolVersion: 1, requestId: ID(6), inputType: 'text' },
  'unsupported-protocol.json': { protocolVersion: 2, requestId: ID(7), inputType: 'text', text: 'ping' },
};

// Raw (non-JSON) request bodies.
export const RAW_REQUEST_FIXTURES = {
  'malformed.txt': '{"protocolVersion": 1, "requestId": ',
};

const req = (n, text) => ({ protocolVersion: 1, requestId: ID(n), inputType: 'text', text });

export const RESPONSE_CASES = [
  { file: 'ok-success.json', httpStatus: 200, body: req(1, 'ping'), description: 'Plain success (ping -> pong).' },
  { file: 'ok-happy.json', httpStatus: 200, body: req(2, 'state happy'), description: 'Success that sets characterState happy.' },
  { file: 'ok-tool-success.json', httpStatus: 200, body: req(3, 'tool jellyfin'), description: 'Simulated local tool action succeeded.' },
  { file: 'ok-nonverbal.json', httpStatus: 200, body: req(11, 'nonverbal'), description: 'Nonverbal reaction: empty text/speechText, reaction state + haptic only (§5.1).' },
  { file: 'ok-follow-up.json', httpStatus: 200, body: req(4, 'follow up'), description: 'Gateway expects a follow-up utterance.' },
  { file: 'error-timeout.json', httpStatus: 504, body: req(5, 'slow 60000'), description: 'Provider exceeded the gateway timeout.' },
  { file: 'error-invalid-request-malformed.json', httpStatus: 400, raw: RAW_REQUEST_FIXTURES['malformed.txt'], description: 'Body is not valid JSON; requestId unknown (null).' },
  { file: 'error-invalid-request-schema.json', httpStatus: 400, body: REQUEST_FIXTURES['invalid-missing-text.json'], description: 'Valid JSON but missing text; requestId echoed.' },
  { file: 'error-unsupported-protocol.json', httpStatus: 400, body: REQUEST_FIXTURES['unsupported-protocol.json'], description: 'Client sent protocolVersion 2.' },
  { file: 'error-auth-failed.json', httpStatus: 401, body: req(8, 'ping'), noAuth: true, description: 'Missing/invalid bearer token; body not parsed.' },
  { file: 'error-provider.json', httpStatus: 502, body: req(9, 'state error'), description: 'Provider failed (mock "state error").' },
  { file: 'error-provider-unavailable.json', httpStatus: 503, body: req(10, 'unavailable'), description: 'Local AI engine not running.' },
];

// Hand-written envelopes the Watch builds locally so the UI pipeline only ever
// handles one response type. Validated structurally, not replayed.
export const CLIENT_FIXTURE_DESCRIPTIONS = {
  'thinking-accepted.json': 'Request handed off (e.g. relay ack); keep showing thinking. Not final.',
  'gateway-unavailable.json': 'Transport could not connect to the gateway (connection refused / DNS / no route).',
  'disconnected.json': 'No usable route at all (no Wi-Fi, iPhone unreachable).',
  'timeout.json': 'Client-side request timeout before any HTTP response.',
};
