import { describe, it, expect } from 'vitest';
import { validatePassword, PASSWORD_MIN_LENGTH } from './passwordPolicy.js';

// passwordPolicy.ts has no external dependencies — pure unit tests.

describe('validatePassword', () => {
  // ── Trivially invalid inputs ────────────────────────────────────────────

  it('rejects non-string input (undefined)', () => {
    const result = validatePassword(undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects non-string input (number)', () => {
    const result = validatePassword(12345678901234);
    expect(result.ok).toBe(false);
  });

  it('rejects null', () => {
    const result = validatePassword(null);
    expect(result.ok).toBe(false);
  });

  // ── Too short ──────────────────────────────────────────────────────────

  it('rejects password shorter than 12 characters', () => {
    // 11 chars, otherwise valid structure
    const result = validatePassword('Abc1@efghij');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/minst/i);
  });

  it('rejects password of exactly 11 characters', () => {
    const result = validatePassword('Abc1@efghij'); // 11 chars
    expect(result.ok).toBe(false);
  });

  // ── Missing required character classes ─────────────────────────────────

  it('rejects password with no uppercase letter', () => {
    // 12+ chars, digit, special, but all lowercase alpha
    const result = validatePassword('abc1@efghijklm');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects password with no lowercase letter', () => {
    const result = validatePassword('ABC1@EFGHIJKLM');
    expect(result.ok).toBe(false);
  });

  it('rejects password with no digit', () => {
    const result = validatePassword('Abcde@fghijkl');
    expect(result.ok).toBe(false);
  });

  it('rejects password with no special character', () => {
    const result = validatePassword('Abcde1fghijkl');
    expect(result.ok).toBe(false);
  });

  // ── Invalid special characters ─────────────────────────────────────────

  it('rejects password with unsupported special character (#)', () => {
    // '#' is NOT in [@$!%*?&] — regex allows only that set
    const result = validatePassword('Abcde1#ghijkl');
    expect(result.ok).toBe(false);
  });

  // ── Valid passwords ─────────────────────────────────────────────────────

  it('accepts a valid 12-character password (minimum length)', () => {
    const result = validatePassword('Abc1@efghijk'); // exactly 12
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts a valid long password', () => {
    const result = validatePassword('SuperSecure1@passphrase99!');
    expect(result.ok).toBe(true);
  });

  it('accepts all allowed special characters', () => {
    for (const special of ['@', '$', '!', '%', '*', '?', '&']) {
      const pw = `Abcde1${special}ghijkl`;
      const result = validatePassword(pw);
      expect(result.ok, `should accept '${special}'`).toBe(true);
    }
  });

  it('PASSWORD_MIN_LENGTH constant matches actual validation', () => {
    // Build a password that is exactly PASSWORD_MIN_LENGTH - 1 chars (invalid)
    const tooShort = 'A1@' + 'a'.repeat(PASSWORD_MIN_LENGTH - 4); // total = min - 1
    expect(validatePassword(tooShort).ok).toBe(false);

    // Exactly PASSWORD_MIN_LENGTH chars (valid structure)
    const justRight = 'A1@' + 'a'.repeat(PASSWORD_MIN_LENGTH - 3); // total = min
    expect(validatePassword(justRight).ok).toBe(true);
  });
});
