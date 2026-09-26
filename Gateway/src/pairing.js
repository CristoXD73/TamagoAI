import { randomInt, timingSafeEqual } from 'node:crypto';

export const PAIRING_DEFAULTS = { ttlMs: 10 * 60 * 1000, maxFailures: 5 };

/**
 * One short-lived pairing window: a 6-digit code the owner reads off the Mac
 * and enters on the Watch. Closes on first success (single use), on expiry,
 * or after `maxFailures` wrong guesses — 5 guesses against 10^6 codes keeps
 * online guessing at a 0.0005% chance per window. Restart the gateway to open
 * a new window (e.g. to pair a second Watch).
 */
export function createPairingWindow({
  now = Date.now,
  ttlMs = PAIRING_DEFAULTS.ttlMs,
  maxFailures = PAIRING_DEFAULTS.maxFailures,
  code = String(randomInt(0, 1_000_000)).padStart(6, '0'),
} = {}) {
  const expiresAt = now() + ttlMs;
  let failures = 0;
  let closed = false;

  return {
    code,
    expiresAt,
    /** @returns {'ok' | 'invalid' | 'closed'} */
    attempt(candidate) {
      if (closed || now() > expiresAt) {
        closed = true;
        return 'closed';
      }
      const normalized = typeof candidate === 'string' ? candidate.replace(/\s/g, '') : '';
      const matches =
        normalized.length === code.length && timingSafeEqual(Buffer.from(normalized), Buffer.from(code));
      if (matches) {
        closed = true;
        return 'ok';
      }
      failures += 1;
      if (failures >= maxFailures) closed = true;
      return 'invalid';
    },
    get isOpen() {
      return !closed && now() <= expiresAt;
    },
  };
}
