import { REACTION_STATES } from '../protocol.js';
import { ProviderError, abortableDelay } from './provider.js';

const HAPTIC_FOR_STATE = {
  idle: 'none',
  happy: 'success',
  success: 'success',
  confused: 'retry',
};

/**
 * Deterministic provider for Swift client development and tests. The same
 * input always produces the same output. Commands (case-insensitive):
 *
 *   ping                 -> "pong"
 *   state <reaction>     -> characterState = <reaction>; "state error" fails
 *   tool <name>          -> simulated successful tool run
 *   nonverbal            -> no speech/caption: reaction state + haptic only
 *   follow up            -> followUpExpected = true
 *   long                 -> a one-line gist with needsDetail; detail() returns a fixed full answer (D-127)
 *   long fail            -> the same gist, but detail() fails
 *   slow <ms>            -> waits <ms> (abortable), then "done" — for timeouts
 *   unavailable          -> provider_unavailable error
 *   throw                -> raw exception (tests the generic provider_error path)
 *   anything else        -> echo
 */
export function createMockProvider() {
  return {
    name: 'mock',
    async generate(request, { signal } = {}) {
      const input = request.text.trim();
      const lower = input.toLowerCase();

      if (lower === 'ping') {
        return { text: 'pong', characterState: 'idle', haptic: 'click' };
      }

      let m = /^state\s+(\S+)$/.exec(lower);
      if (m) {
        const state = m[1];
        if (state === 'error') {
          throw new ProviderError('provider_error', 'Mock provider was asked to fail.');
        }
        if (!REACTION_STATES.includes(state)) {
          return {
            text: `I don't know the state "${state}".`,
            characterState: 'confused',
            haptic: 'retry',
          };
        }
        return {
          text: `Now I'm ${state}.`,
          characterState: state,
          haptic: HAPTIC_FOR_STATE[state],
        };
      }

      m = /^tool\s+([a-z0-9_-]{1,40})$/.exec(lower);
      if (m) {
        return {
          text: `${capitalize(m[1])} is back online.`,
          speechText: `Done. ${capitalize(m[1])} is back online.`,
          characterState: 'success',
          haptic: 'success',
        };
      }

      if (lower === 'nonverbal') {
        return { nonverbal: true, characterState: 'happy', haptic: 'click' };
      }

      if (lower === 'long' || lower === 'long fail') {
        return {
          text: 'Sourdough needs a starter, flour, water and salt, and about a day.',
          characterState: 'idle',
          haptic: 'click',
          needsDetail: true,
        };
      }

      if (lower === 'follow up') {
        return {
          text: 'Which one do you mean?',
          characterState: 'confused',
          haptic: 'notification',
          followUpExpected: true,
        };
      }

      m = /^slow\s+(\d{1,6})$/.exec(lower);
      if (m) {
        await abortableDelay(Number(m[1]), signal);
        return { text: 'done', characterState: 'idle', haptic: 'none' };
      }

      if (lower === 'unavailable') {
        throw new ProviderError('provider_unavailable', 'Mock provider is pretending to be offline.');
      }

      if (lower === 'throw') {
        throw new Error('mock internal failure with secret detail /Users/owner');
      }

      return { text: `You said: ${input}`, characterState: 'idle', haptic: 'none' };
    },

    /** The full answer behind a `needsDetail` reply (D-127). Deterministic. */
    async detail(request, { signal } = {}) {
      if (signal?.aborted) throw new ProviderError('timeout', 'aborted');
      if (request.text.trim().toLowerCase() === 'long fail') {
        throw new ProviderError('provider_error', 'Mock long answer was asked to fail.');
      }
      return MOCK_DETAIL;
    },
  };
}

export const MOCK_DETAIL = [
  'Here is the whole thing:',
  '',
  '1. Feed your starter the night before.',
  '2. Mix 500 g flour, 350 g water and 100 g starter. Rest 1 hour.',
  '3. Add 10 g salt, then stretch and fold every 30 minutes for 2 hours.',
  '4. Let it rise until puffy, shape it, and chill it overnight.',
  '5. Bake at 250 °C in a covered pot for 20 minutes, then 20 more uncovered.',
].join('\n');

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
