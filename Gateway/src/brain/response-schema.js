// TamagoIntent: the brain's structured output. AI semantics live here; the
// Watch only ever sees the small Protocol V1 envelope produced by toV1Result().

import { HAPTICS } from '../protocol.js';

export const EMOTIONS = [
  'content', 'curious', 'pleased', 'affectionate', 'playful', 'focused',
  'uncertain', 'confused', 'concerned', 'sleepy', 'surprised',
];
export const ATTENTION = ['owner', 'self', 'environment', 'task'];
export const SOUNDS = ['none', 'soft_ack', 'tiny_chirp', 'curious_trill', 'pleased_burble', 'uncertain_hum'];
export const BEHAVIORS = [
  'none', 'settle', 'settle_close', 'inspect_owner', 'perk_up', 'look_away', 'retreat_slightly', 'slow_blink',
];
export const MEMORY_TYPES = ['semantic', 'preference', 'episodic', 'procedural'];

// Brain emotion -> the only reaction states a gateway may send (PROTOCOL_V1 §6).
const EMOTION_TO_REACTION = {
  content: 'idle', curious: 'idle', focused: 'idle', sleepy: 'idle', surprised: 'idle',
  pleased: 'happy', affectionate: 'happy', playful: 'happy',
  uncertain: 'confused', confused: 'confused',
  concerned: 'error',
};

/** JSON schema handed to the model (Ollama structured outputs). */
export const INTENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    speech: { type: ['string', 'null'], description: 'What Tamago says aloud, or null for a nonverbal reaction.' },
    thought: { type: 'string', description: 'Private one-line reasoning. Never shown or spoken.' },
    emotion: { type: 'string', enum: EMOTIONS },
    energy: { type: 'number', minimum: 0, maximum: 1 },
    attention: { type: 'string', enum: ATTENTION },
    sound: { type: 'string', enum: SOUNDS },
    haptic: { type: 'string', enum: HAPTICS },
    behavior: { type: 'string', enum: BEHAVIORS },
    followUpExpected: { type: 'boolean' },
    memoryCandidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: MEMORY_TYPES },
          confidence: { type: 'number' },
          importance: { type: 'number' },
        },
        required: ['text', 'type', 'confidence', 'importance'],
      },
    },
  },
  required: ['speech', 'emotion', 'haptic', 'behavior', 'followUpExpected'],
};

const clamp01 = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);

/**
 * Validates and normalizes a candidate intent (from a model or from rules).
 * Returns { ok: true, intent } or { ok: false, errors }. Unknown enum values are
 * errors (not silently coerced) so a model can be asked to repair its output.
 */
export function validateIntent(raw) {
  const errors = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['intent must be a JSON object'] };
  }
  const pick = (field, list, fallback) => {
    const v = raw[field] ?? fallback;
    if (!list.includes(v)) errors.push(`${field} must be one of: ${list.join(', ')}`);
    return v;
  };
  let speech = raw.speech;
  if (speech !== null && speech !== undefined && typeof speech !== 'string') errors.push('speech must be a string or null');
  if (typeof speech === 'string' && speech.trim() === '') speech = null;
  const intent = {
    speech: speech ?? null,
    thought: typeof raw.thought === 'string' ? raw.thought.slice(0, 400) : '',
    emotion: pick('emotion', EMOTIONS),
    energy: clamp01(raw.energy, 0.5),
    attention: pick('attention', ATTENTION, 'owner'),
    sound: pick('sound', SOUNDS, 'none'),
    haptic: pick('haptic', HAPTICS, 'none'),
    behavior: pick('behavior', BEHAVIORS, 'none'),
    followUpExpected: raw.followUpExpected === true,
    memoryCandidates: [],
    tool: null,
  };
  if (raw.followUpExpected !== undefined && typeof raw.followUpExpected !== 'boolean') {
    errors.push('followUpExpected must be a boolean');
  }
  if (raw.memoryCandidates !== undefined) {
    if (!Array.isArray(raw.memoryCandidates)) errors.push('memoryCandidates must be an array');
    else {
      for (const c of raw.memoryCandidates.slice(0, 5)) {
        if (c && typeof c.text === 'string' && MEMORY_TYPES.includes(c.type)) {
          intent.memoryCandidates.push({
            text: c.text.slice(0, 300),
            type: c.type,
            confidence: clamp01(c.confidence, 0),
            importance: clamp01(c.importance, 0),
          });
        }
      }
    }
  }
  // Tools arrive in Brain E. A model-requested tool is recorded, never executed here.
  if (raw.tool && typeof raw.tool === 'object' && typeof raw.tool.name === 'string') {
    intent.tool = { name: raw.tool.name.slice(0, 80), args: raw.tool.args ?? {} };
  }
  return errors.length ? { ok: false, errors } : { ok: true, intent };
}

/**
 * Translates an intent into the provider result that protocol.buildOkResponse
 * turns into a V1 envelope. sound/behavior/attention/thought stay on the Mac
 * (recorded in the trace) until a protocol revision carries them.
 */
export function toV1Result(intent) {
  const characterState = EMOTION_TO_REACTION[intent.emotion] ?? 'idle';
  if (intent.speech === null) {
    return { nonverbal: true, characterState, haptic: intent.haptic, followUpExpected: intent.followUpExpected };
  }
  return {
    text: intent.text ?? intent.speech,
    speechText: intent.speech,
    characterState,
    haptic: intent.haptic,
    followUpExpected: intent.followUpExpected,
  };
}

/** Convenience for rule-produced intents (always valid by construction). */
export function makeIntent(fields) {
  const r = validateIntent({ emotion: 'content', haptic: 'none', behavior: 'none', followUpExpected: false, ...fields });
  if (!r.ok) throw new Error(`invalid rule intent: ${r.errors.join('; ')}`);
  if (typeof fields.text === 'string') r.intent.text = fields.text;
  return r.intent;
}
