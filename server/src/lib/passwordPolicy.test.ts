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

  it('rejects a short password with fewer than three character classes', () => {
    expect(validatePassword('abcdefghijkl1').ok).toBe(false); // gemen + siffra
    expect(validatePassword('ABCDEFGHIJKL').ok).toBe(false);
    expect(validatePassword('abcdefghijklm').ok).toBe(false);
  });

  it('accepts three character classes at 12+ chars', () => {
    expect(validatePassword('abcdefghij1!').ok).toBe(true); // gemen + siffra + övrigt
    expect(validatePassword('Abcdefghijk1').ok).toBe(true); // versal + gemen + siffra
  });

  it('accepts a long passphrase of a single character class (>= 16 chars)', () => {
    expect(validatePassword('correcthorsebatterystaple').ok).toBe(true);
    expect(validatePassword('a'.repeat(16)).ok).toBe(true);
    expect(validatePassword('a'.repeat(15)).ok).toBe(false);
  });

  // ── Tecken som tidigare avvisades ───────────────────────────────────────

  it('accepts #, _, -, space and åäö', () => {
    for (const pw of ['Abcde1#ghijkl', 'Abcde1_ghijkl', 'Abcde1-ghijkl', 'Abcde1 ghijkl', 'Åäö1Åäö1Åäö1']) {
      expect(validatePassword(pw).ok, pw).toBe(true);
    }
  });

  it('accepts all previously allowed special characters', () => {
    for (const special of ['@', '$', '!', '%', '*', '?', '&']) {
      expect(validatePassword(`Abcde1${special}ghijkl`).ok, special).toBe(true);
    }
  });

  // ── Maxlängd (bcrypt trunkerar vid 72 byte) ─────────────────────────────

  it('accepts exactly 72 bytes and rejects 73', () => {
    expect(validatePassword('a'.repeat(72)).ok).toBe(true);
    const tooLong = validatePassword('a'.repeat(73));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error).toMatch(/högst 72/);
  });

  it('measures the maximum in UTF-8 bytes, not characters', () => {
    // 40 x 'å' = 40 tecken men 80 byte
    expect(validatePassword('å'.repeat(40)).ok).toBe(false);
    // 36 x 'å' = 72 byte
    expect(validatePassword('å'.repeat(36)).ok).toBe(true);
  });

  it('counts the minimum in characters (code points), not bytes', () => {
    expect(validatePassword('Åäö1Åäö1Åäö').ok).toBe(false); // 11 tecken
    expect(validatePassword('Åäö1Åäö1Åäö1').ok).toBe(true); // 12 tecken
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
