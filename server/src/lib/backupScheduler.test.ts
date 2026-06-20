import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Sätt env INNAN backupScheduler importeras (drar in db/connection.js).
vi.hoisted(() => {
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  process.env.DB_PATH = path.join(os.tmpdir(), `itticket-sched-test-db-${process.pid}-${Date.now()}.sqlite`);
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-sched-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-sched-0123456789abcdef0123456789abcdef';
  return {};
});

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  timeToCron,
  getBackupConfig,
  runBackup,
  isBackupRunning,
  reconfigureBackupScheduler,
  stopBackupScheduler,
} from './backupScheduler.js';

function makeSourceDb(path: string, retentionDays = 7): DatabaseType {
  const db = new Database(path);
  db.exec(`CREATE TABLE backup_config (
    id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 1,
    time TEXT NOT NULL DEFAULT '04:00', retention_days INTEGER NOT NULL DEFAULT 7,
    last_run_at TEXT, last_status TEXT, last_size_bytes INTEGER, updated_at TEXT NOT NULL
  )`);
  db.prepare(
    `INSERT INTO backup_config (id, enabled, time, retention_days, updated_at) VALUES (1, 1, '04:00', ?, ?)`,
  ).run(retentionDays, new Date().toISOString());
  db.exec('CREATE TABLE tickets (id TEXT PRIMARY KEY)'); // ge DB:n innehåll
  return db;
}

describe('timeToCron', () => {
  it('maps HH:MM to "M H * * *" without leading zeros', () => {
    expect(timeToCron('04:00')).toBe('0 4 * * *');
    expect(timeToCron('23:30')).toBe('30 23 * * *');
    expect(timeToCron('00:05')).toBe('5 0 * * *');
  });
});

describe('getBackupConfig', () => {
  it('reads the row and maps to camelCase with boolean enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-cfg-'));
    const db = makeSourceDb(join(dir, 'db.sqlite'), 5);
    db.prepare("UPDATE backup_config SET enabled = 0, time = '02:15' WHERE id = 1").run();

    expect(getBackupConfig(db)).toEqual({
      enabled: false,
      time: '02:15',
      retentionDays: 5,
      lastRunAt: null,
      lastStatus: null,
      lastSizeBytes: null,
    });

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('runBackup', () => {
  it('creates a dated zip, records success, sets the in-flight guard, cleans tmp sidecars', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-run-'));
    const backupDir = join(dir, 'backups');
    const uploadDir = join(dir, 'uploads');
    mkdirSync(uploadDir, { recursive: true });
    writeFileSync(join(uploadDir, 'a.txt'), 'hello');
    const db = makeSourceDb(join(dir, 'db.sqlite'), 7);

    expect(isBackupRunning()).toBe(false);
    const p = runBackup(db, { backupDir, uploadDir });
    expect(isBackupRunning()).toBe(true); // satt synkront innan första await
    const result = await p;
    expect(isBackupRunning()).toBe(false);

    expect(result.status).toBe('success');
    const today = new Date().toISOString().slice(0, 10);
    expect(existsSync(join(backupDir, `backup-${today}.zip`))).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);

    // tmp-snapshot + -shm/-wal-sidecars städade (pre-existing läcka som denna fix löser)
    expect(readdirSync(backupDir).filter((f) => f.startsWith('tmp-'))).toEqual([]);

    const cfg = getBackupConfig(db);
    expect(cfg.lastStatus).toBe('success');
    expect(cfg.lastRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(cfg.lastSizeBytes).toBeGreaterThan(0);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('prunes to retention_days newest snapshots, deleting older ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-ret-'));
    const backupDir = join(dir, 'backups');
    mkdirSync(backupDir, { recursive: true });
    for (const d of ['2020-01-01', '2020-01-02', '2020-01-03']) {
      writeFileSync(join(backupDir, `backup-${d}.zip`), 'x');
    }
    const db = makeSourceDb(join(dir, 'db.sqlite'), 2); // behåll nyaste 2

    await runBackup(db, { backupDir, uploadDir: join(dir, 'nouploads') });

    const today = new Date().toISOString().slice(0, 10);
    const remaining = readdirSync(backupDir).filter((f) => f.startsWith('backup-')).sort();
    expect(remaining).toEqual([`backup-2020-01-03.zip`, `backup-${today}.zip`].sort());

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('scheduler wiring', () => {
  it('reconfigure + stop do not throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-wire-'));
    const db = makeSourceDb(join(dir, 'db.sqlite'), 7);

    expect(() => {
      reconfigureBackupScheduler(db);
      stopBackupScheduler();
    }).not.toThrow();
    expect(isBackupRunning()).toBe(false);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
