import { describe, it, expect } from 'vitest';
import { validateSecret, MIN_SECRET_LENGTH } from './secretValidation.js';

// Sanity check the fixtures below actually straddle the boundary being tested.
const SHORT_SECRET = 'a'.repeat(MIN_SECRET_LENGTH - 1); // 31 chars
const VALID_SECRET = 'a'.repeat(MIN_SECRET_LENGTH); // 32 chars

describe('validateSecret', () => {
  it('fails when the secret is missing', () => {
    const result = validateSecret('JWT_SECRET', undefined, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/JWT_SECRET/);
      expect(result.reason).toMatch(/not set/i);
    }
  });

  it('fails when the secret is empty string', () => {
    const result = validateSecret('JWT_SECRET', '', {});
    expect(result.ok).toBe(false);
  });

  it('fails for a secret shorter than MIN_SECRET_LENGTH with no relaxation flag', () => {
    const result = validateSecret('JWT_SECRET', SHORT_SECRET, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/too short/i);
    }
  });

  it('NEVER allows the weak-secret relaxation in production, even with ALLOW_WEAK_SECRETS=1 (double-gate)', () => {
    const result = validateSecret('JWT_SECRET', SHORT_SECRET, {
      NODE_ENV: 'production',
      ALLOW_WEAK_SECRETS: '1',
    });
    expect(result.ok).toBe(false);
  });

  it('allows a short secret with a warning when ALLOW_WEAK_SECRETS=1 and NODE_ENV=development', () => {
    const result = validateSecret('JWT_SECRET', SHORT_SECRET, {
      NODE_ENV: 'development',
      ALLOW_WEAK_SECRETS: '1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toBeDefined();
      expect(result.warning).toMatch(/short/i);
    }
  });

  it('allows a short secret with a warning when ALLOW_WEAK_SECRETS=1 and NODE_ENV=test', () => {
    const result = validateSecret('JWT_SECRET', SHORT_SECRET, {
      NODE_ENV: 'test',
      ALLOW_WEAK_SECRETS: '1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toBeDefined();
    }
  });

  it('passes for a secret of exactly MIN_SECRET_LENGTH chars with no warning', () => {
    const result = validateSecret('JWT_SECRET', VALID_SECRET, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toBeUndefined();
    }
  });

  it('requires ALLOW_WEAK_SECRETS to be the exact string "1" — "true" does not open the gate', () => {
    const result = validateSecret('JWT_SECRET', SHORT_SECRET, {
      NODE_ENV: 'development',
      ALLOW_WEAK_SECRETS: 'true',
    });
    expect(result.ok).toBe(false);
  });

  it('still fails closed with the relaxation flag set but NODE_ENV unset', () => {
    const result = validateSecret('JWT_SECRET', SHORT_SECRET, {
      ALLOW_WEAK_SECRETS: '1',
    });
    expect(result.ok).toBe(false);
  });

  it('still fails closed with a whitelisted NODE_ENV but ALLOW_WEAK_SECRETS unset', () => {
    const result = validateSecret('JWT_SECRET', SHORT_SECRET, {
      NODE_ENV: 'development',
    });
    expect(result.ok).toBe(false);
  });
});
