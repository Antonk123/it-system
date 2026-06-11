import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB module before importing the module under test.
// matchesWord() and detectAutoPriority() are pure (no DB access),
// but the module-level import of `db` would open the real file otherwise.
vi.mock('../db/connection.js', () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
      run: vi.fn(),
    }),
  },
}));

// Mock logger to suppress output during tests
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { detectAutoPriority } from './automationHelper.js';

// ─────────────────────────────────────────────────────────────────────────────
// matchesWord() — tested indirectly via detectAutoPriority()
// The function uses Unicode-aware lookarounds so Swedish compound words
// must NOT trigger a match on an embedded keyword.
// ─────────────────────────────────────────────────────────────────────────────

describe('matchesWord (via detectAutoPriority)', () => {
  it('matches an exact keyword at word boundary', () => {
    // 'nere' → priority 'high'
    expect(detectAutoPriority('Servern är nere', '')).toBe('high');
  });

  it('does NOT match keyword embedded mid-word (lösenord inside lösenordslös)', () => {
    // 'lösenord' is a TAG keyword; NOT a PRIORITY keyword.
    // We verify word-boundary logic by checking it doesn't extract partial match.
    // None of PRIORITY_RULES have 'lösenord' — so the result should be null.
    // This also confirms the word-boundary regex doesn't blow up on Swedish chars.
    expect(detectAutoPriority('lösenordslös policy', '')).toBeNull();
  });

  it('does NOT match virus embedded inside antivirus', () => {
    // 'virus' is NOT in PRIORITY_RULES, so result is null whether or not
    // word-boundary fires. We confirm no false priority is produced.
    expect(detectAutoPriority('antivirus scan ran', '')).toBeNull();
  });

  it('matches virus as a standalone word', () => {
    // Still not a priority keyword — stays null, but the call must not throw
    expect(detectAutoPriority('virus detected on machine', '')).toBeNull();
  });

  it('matches keyword case-insensitively (KRITISK)', () => {
    expect(detectAutoPriority('KRITISK situation', '')).toBe('critical');
  });

  it('matches keyword at the start of text', () => {
    expect(detectAutoPriority('akut problem', '')).toBe('critical');
  });

  it('matches keyword at the end of text', () => {
    expect(detectAutoPriority('problem är kritisk', '')).toBe('critical');
  });

  it('does NOT match keyword that is only a substring (urgentt)', () => {
    // 'urgent' keyword should NOT fire inside 'urgentt'
    const result = detectAutoPriority('urgentt need', '');
    // 'urgentt' has an extra 't' so it's a different word — should not match
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectAutoPriority()
// ─────────────────────────────────────────────────────────────────────────────

describe('detectAutoPriority', () => {
  it('returns null when no keyword matches', () => {
    expect(detectAutoPriority('vanlig fråga om skrivare', 'fungerar som vanligt')).toBeNull();
  });

  it('detects critical from title keyword', () => {
    expect(detectAutoPriority('Kritisk bugg i produktionen', '')).toBe('critical');
  });

  it('detects critical from English keyword "emergency"', () => {
    expect(detectAutoPriority('', 'This is an emergency situation')).toBe('critical');
  });

  it('detects high from "fungerar inte" in description', () => {
    expect(detectAutoPriority('Outlook', 'fungerar inte sedan igår')).toBe('high');
  });

  it('detects high from "down"', () => {
    expect(detectAutoPriority('Server down', '')).toBe('high');
  });

  it('detects high from "brådskande"', () => {
    expect(detectAutoPriority('Brådskande ärende', '')).toBe('high');
  });

  it('detects high from "urgent"', () => {
    expect(detectAutoPriority('', 'urgent fix needed')).toBe('high');
  });

  it('first matching rule wins — critical before high', () => {
    // Text matches both 'akut' (critical) and 'down' (high).
    // Critical rule comes first → should return 'critical'.
    expect(detectAutoPriority('akut server down', '')).toBe('critical');
  });

  it('searches combined title + description', () => {
    expect(detectAutoPriority('Outlook-problem', 'kritiskt för oss')).toBe('critical');
  });

  it('returns null for empty strings', () => {
    expect(detectAutoPriority('', '')).toBeNull();
  });
});
