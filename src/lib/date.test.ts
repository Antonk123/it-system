import { describe, it, expect } from 'vitest';
import { parseServerDate } from './date';

describe('parseServerDate', () => {
  it('treats a naive SQLite timestamp as UTC (not local)', () => {
    // 08:00 CEST was stored by SQLite CURRENT_TIMESTAMP as "06:00:00" UTC.
    const d = parseServerDate('2026-06-16 06:00:00');
    expect(d).not.toBeNull();
    // TZ-independent assertion: the instant must be 06:00 UTC, so a CEST client renders 08:00.
    expect(d!.toISOString()).toBe('2026-06-16T06:00:00.000Z');
  });

  it('leaves an ISO string with Z untouched (no double conversion)', () => {
    const d = parseServerDate('2026-06-16T06:00:00.000Z');
    expect(d!.toISOString()).toBe('2026-06-16T06:00:00.000Z');
  });

  it('respects an explicit timezone offset', () => {
    const d = parseServerDate('2026-06-16T08:00:00+02:00');
    expect(d!.toISOString()).toBe('2026-06-16T06:00:00.000Z');
  });

  it('passes through Date and number inputs', () => {
    const now = new Date();
    expect(parseServerDate(now)).toBe(now);
    expect(parseServerDate(0)!.toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });

  it('returns null for empty/nullish input', () => {
    expect(parseServerDate(null)).toBeNull();
    expect(parseServerDate(undefined)).toBeNull();
    expect(parseServerDate('')).toBeNull();
  });
});
