import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Unit tests for server/src/db/cleanup-refresh-tokens.ts — the nightly cron
 * (03:00) that deletes expired + long-revoked refresh tokens.
 *
 * Coverage (audit L22 — 0% coverage):
 *  - expired tokens (expires_at < now) are deleted regardless of revoked state
 *  - revoked tokens older than 7 days (created_at) are deleted
 *  - revoked tokens newer than 7 days are kept
 *  - valid, non-expired, non-revoked tokens are kept
 *  - empty table: no throw
 *  - idempotency: a second run deletes nothing further
 *
 * Bootstrap ordering: db/connection.ts is a module-level singleton built from
 * process.env.DB_PATH at import time. vi.hoisted() sets a UNIQUE DB_PATH (+
 * NODE_ENV=test) BEFORE any import pulls in connection.ts, so this suite gets
 * its own on-disk SQLite file isolated from other test files.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-cleanup-refresh-tokens.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  return { DB_PATH: dbPath };
});

import { initializeDatabase, db, closeDatabase } from './connection.js';
import { cleanupRefreshTokens } from './cleanup-refresh-tokens.js';

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function daysFromNowIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

let userId: string;

/** Insert a refresh_tokens row directly and return its id (PK). */
function seedToken(opts: { expiresAt: string; revoked?: boolean; createdAt?: string }): string {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, userId, randomUUID(), opts.expiresAt, opts.revoked ? 1 : 0, opts.createdAt ?? new Date().toISOString());
  return id;
}

function remainingTokenIds(): string[] {
  return (db.prepare('SELECT id FROM refresh_tokens WHERE user_id = ?').all(userId) as { id: string }[]).map((r) => r.id);
}

beforeAll(() => {
  initializeDatabase();
  userId = randomUUID();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, 'x', 'user', 'Cleanup Test User')"
  ).run(userId, 'cleanup-refresh-tokens@test.local');
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

beforeEach(() => {
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
});

describe('cleanupRefreshTokens', () => {
  it('does not throw against an empty table', () => {
    expect(remainingTokenIds().length).toBe(0);
    expect(() => cleanupRefreshTokens()).not.toThrow();
    expect(remainingTokenIds().length).toBe(0);
  });

  it('deletes expired + long-revoked tokens, keeps recently-revoked + valid future tokens', () => {
    const expired = seedToken({ expiresAt: daysAgoIso(1), revoked: false });
    const revokedOld = seedToken({ expiresAt: daysFromNowIso(30), revoked: true, createdAt: daysAgoIso(8) });
    const revokedRecent = seedToken({ expiresAt: daysFromNowIso(30), revoked: true, createdAt: daysAgoIso(2) });
    const validFuture = seedToken({ expiresAt: daysFromNowIso(30), revoked: false });

    cleanupRefreshTokens();

    const remaining = new Set(remainingTokenIds());
    expect(remaining.has(expired)).toBe(false);
    expect(remaining.has(revokedOld)).toBe(false);
    expect(remaining.has(revokedRecent)).toBe(true);
    expect(remaining.has(validFuture)).toBe(true);
    expect(remaining.size).toBe(2);
  });

  it('is idempotent — a second run deletes nothing further', () => {
    seedToken({ expiresAt: daysAgoIso(1), revoked: false });
    seedToken({ expiresAt: daysFromNowIso(30), revoked: true, createdAt: daysAgoIso(8) });
    const revokedRecent = seedToken({ expiresAt: daysFromNowIso(30), revoked: true, createdAt: daysAgoIso(2) });
    const validFuture = seedToken({ expiresAt: daysFromNowIso(30), revoked: false });

    cleanupRefreshTokens();
    const afterFirst = remainingTokenIds().sort();
    expect(afterFirst).toEqual([revokedRecent, validFuture].sort());

    expect(() => cleanupRefreshTokens()).not.toThrow();
    const afterSecond = remainingTokenIds().sort();
    expect(afterSecond).toEqual(afterFirst);
  });
});
