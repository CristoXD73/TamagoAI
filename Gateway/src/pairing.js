import { randomInt, timingSafeEqual } from 'node:crypto';

export const PAIRING_DEFAULTS = { ttlMs: 10 * 60 * 1000, maxFailures: 5 };

/**
 * One short-lived pairing window: a 6-digit code the owner reads off the Mac
 * and enters on the Watch. Closes on first success (single use), on expiry,
 * or after `maxFailures` wrong guesses — 5 guesses against 10^6 codes keeps
 * online guessing at a 0.0005% chance per window. A new window opens on each
 * gateway start, or from the dashboard (createPairing().reopen()).
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

/**
 * The gateway's pairing: one window at a time, which the owner can reopen from the Mac-only dashboard to pair
 * another device (a Watch and a phone need one code each) without restarting Tamago. Same shape as a window
 * (`attempt`, `isOpen`, `code`, `expiresAt`), so the server doesn't know the difference.
 */
export function createPairing(opts = {}) {
  let current = createPairingWindow(opts);
  return {
    attempt: (candidate) => current.attempt(candidate),
    get isOpen() { return current.isOpen; },
    get code() { return current.code; },
    get expiresAt() { return current.expiresAt; },
    /** Closes the old code and opens a fresh one (fresh expiry, fresh failure count). */
    reopen() {
      current.attempt(null);   // an invalid attempt can't open anything; mark the old one used
      current = createPairingWindow({ ...opts, code: undefined });
      return current.code;
    },
  };
}
