import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

const { DIR } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'itticket-offsite-status-'));
  process.env.DB_PATH = join(dir, 'singleton.sqlite');
  process.env.NODE_ENV = 'test';
  return { DIR: dir };
});
vi.mock('./push.js', () => ({ sendPushToAllSubscriptions: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { closeDatabase } from '../db/connection.js';
import { getBackupConfig, runBackup } from './backupScheduler.js';
import { getOffsiteFailureCount } from './offsiteBackup.js';

const savedCmd = process.env.OFFSITE_BACKUP_CMD;
const savedRequired = process.env.OFFSITE_BACKUP_REQUIRED;
afterEach(() => {
  if (savedCmd === undefined) delete process.env.OFFSITE_BACKUP_CMD;
  else process.env.OFFSITE_BACKUP_CMD = savedCmd;
  if (savedRequired === undefined) delete process.env.OFFSITE_BACKUP_REQUIRED;
  else process.env.OFFSITE_BACKUP_REQUIRED = savedRequired;
});
afterAll(() => {
  closeDatabase();
  rmSync(DIR, { recursive: true, force: true });
});

function sourceDatabase(path: string) {
  const db = new Database(path);
  db.exec(`CREATE TABLE backup_config (
    id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
    time TEXT NOT NULL DEFAULT '04:00', retention_days INTEGER NOT NULL DEFAULT 7,
    last_run_at TEXT, last_status TEXT, last_size_bytes INTEGER,
    consecutive_failures INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL
  ); CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT)`);
  db.prepare('INSERT INTO backup_config (id, updated_at) VALUES (1, ?)').run(new Date().toISOString());
  return db;
}

describe('required offsite configuration through the actual backup pipeline (A05)', () => {
  it.each([undefined, '', ' \t\n '])('records offsite_failed for missing required command %j and retains the local archive', async (command) => {
    if (command === undefined) delete process.env.OFFSITE_BACKUP_CMD;
    else process.env.OFFSITE_BACKUP_CMD = command;
    process.env.OFFSITE_BACKUP_REQUIRED = 'true';
    const directory = mkdtempSync(join(tmpdir(), 'offsite-required-run-'));
    const backupDir = join(directory, 'backups');
    mkdirSync(backupDir);
    writeFileSync(join(backupDir, 'backup-2020-01-01.zip'), 'expired');
    const db = sourceDatabase(join(directory, 'source.sqlite'));
    const failuresBefore = getOffsiteFailureCount();
    try {
      const result = await runBackup(db, { backupDir, uploadDir: join(directory, 'uploads') });
      expect(result.status).toBe('offsite_failed');
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(existsSync(result.path!)).toBe(true);
      expect(readdirSync(backupDir)).toEqual([basename(result.path!)]);
      expect(getOffsiteFailureCount()).toBe(failuresBefore + 1);
      expect(getBackupConfig(db)).toMatchObject({
        lastStatus: 'offsite_failed', lastSizeBytes: result.sizeBytes,
        consecutiveFailures: 0, lastError: expect.stringContaining('OFFSITE_BACKUP_CMD'),
      });
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
