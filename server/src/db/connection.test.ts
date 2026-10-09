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

import { db, closeDatabase, initializeDatabase } from './connection.js';
import { logger } from '../lib/logger.js';

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

  it('caps the WAL file at 64MB after checkpoint (journal_size_limit)', () => {
    expect(db.pragma('journal_size_limit', { simple: true })).toBe(67108864);
  });
});

describe('initializeDatabase: FTS drift check', () => {
  it('stays quiet when the indexes match and warns (without rebuilding) when they drift', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    initializeDatabase();
    expect(warn).not.toHaveBeenCalled();

    db.prepare("INSERT INTO tickets (id, title, description) VALUES ('drift', 'T', 'D')").run();
    db.exec('DELETE FROM tickets_fts');
    initializeDatabase();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('FTS index out of sync'),
      expect.objectContaining({ drift: expect.objectContaining({ tickets: { rows: 1, fts: 0 } }) })
    );
    // Varnar bara — bygger inte om automatiskt.
    expect(db.prepare('SELECT COUNT(*) FROM tickets_fts').pluck().get()).toBe(0);
    warn.mockRestore();
  });
});
