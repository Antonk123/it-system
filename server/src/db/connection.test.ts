import { describe, it, expect, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';

/**
 * Guards the concurrency-critical PRAGMAs set when the connection is created.
 * busy_timeout in particular prevents "database is locked" (SQLITE_BUSY) when
 * the 6 background schedulers + the backup job contend for the write lock.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-connection.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  return { DB_PATH: dbPath };
});

import { db, closeDatabase } from './connection.js';

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('connection PRAGMAs', () => {
  it('waits on a held lock instead of failing (busy_timeout = 5000ms)', () => {
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('uses WAL journal mode for concurrent readers/writers', () => {
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
  });

  it('enforces foreign keys', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});
