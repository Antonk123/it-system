import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
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

const unzipState = vi.hoisted(() => ({ emptyListing: false }));

// Låter verifieringssteget (unzipper.Open.file) simulera ett arkiv utan poster.
vi.mock('unzipper', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('unzipper') }>();
  return {
    default: {
      ...actual.default,
      Open: {
        ...actual.default.Open,
        file: (path: string) =>
          unzipState.emptyListing ? Promise.resolve({ files: [] }) : actual.default.Open.file(path),
      },
    },
  };
});

vi.mock('./push.js', () => ({ sendPushToAllSubscriptions: vi.fn().mockResolvedValue(undefined) }));

// Förväntade fel ("Automatic backup failed" m.fl.) ska inte spamma testutskriften.
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  timeToCron,
  getBackupConfig,
  runBackup,
  isBackupRunning,
  isCatchUpNeeded,
  startBackupScheduler,
  reconfigureBackupScheduler,
  stopBackupScheduler,
  waitForBackup,
  assertEnoughDiskSpace,
  BACKUP_ZIP_NAME_RE,
} from './backupScheduler.js';
import { logger } from './logger.js';
import { sendPushToAllSubscriptions } from './push.js';

function makeSourceDb(path: string, retentionDays = 7): DatabaseType {
  const db = new Database(path);
  db.exec(`CREATE TABLE backup_config (
    id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 1,
    time TEXT NOT NULL DEFAULT '04:00', retention_days INTEGER NOT NULL DEFAULT 7,
    last_run_at TEXT, last_status TEXT, last_size_bytes INTEGER,
    consecutive_failures INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL
  )`);
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT)");
  db.exec("INSERT INTO users (id, role) VALUES ('admin-1', 'admin'), ('user-1', 'user')");
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
      consecutiveFailures: 0,
      lastError: null,
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
    expect(result.path).toMatch(/backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
    expect(BACKUP_ZIP_NAME_RE.test(basename(result.path!))).toBe(true);
    expect(existsSync(result.path!)).toBe(true);
    expect(statSync(result.path!).mode & 0o777).toBe(0o600);
    expect(result.sizeBytes).toBeGreaterThan(0);

    // tmp-snapshot, -shm/-wal-sidecars och *.zip.tmp städade
    expect(readdirSync(backupDir).filter((f) => f.startsWith('tmp-') || f.endsWith('.tmp'))).toEqual([]);

    const cfg = getBackupConfig(db);
    expect(cfg.lastStatus).toBe('success');
    expect(cfg.lastRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(cfg.lastSizeBytes).toBeGreaterThan(0);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips an overlapping run while one is already in flight (in-flight guard)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-overlap-'));
    const backupDir = join(dir, 'backups');
    const db = makeSourceDb(join(dir, 'db.sqlite'), 7);

    expect(isBackupRunning()).toBe(false);
    // Starta en körning utan att awaita — `running` sätts synkront.
    const first = runBackup(db, { backupDir, uploadDir: join(dir, 'nouploads') });
    // En andra körning som fyrar medan den första är i flykt ska hoppas över
    // (annars skriver båda till samma backup-<datum>.zip → korrupt fil).
    const second = await runBackup(db, { backupDir, uploadDir: join(dir, 'nouploads') });
    expect(second.status).toBe('skipped');

    const firstResult = await first;
    expect(firstResult.status).toBe('success');
    expect(isBackupRunning()).toBe(false);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('prunes by age in days parsed from the filename, not by file count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-ret-'));
    const backupDir = join(dir, 'backups');
    mkdirSync(backupDir, { recursive: true });
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const keepers = [`backup-${daysAgo(1)}.zip`, `backup-${daysAgo(2)}-0400.zip`];
    const stale = [`backup-${daysAgo(10)}.zip`, `backup-${daysAgo(30)}-0400.zip`, `backup-${daysAgo(40)}.sqlite`, `backup-${daysAgo(5)}.zip.tmp`];
    for (const f of [...keepers, ...stale]) writeFileSync(join(backupDir, f), 'x');
    writeFileSync(join(backupDir, 'unrelated.txt'), 'x');
    const db = makeSourceDb(join(dir, 'db.sqlite'), 7); // 7 dagar

    const result = await runBackup(db, { backupDir, uploadDir: join(dir, 'nouploads') });

    const remaining = readdirSync(backupDir).sort();
    expect(remaining).toEqual([...keepers, 'unrelated.txt', basename(result.path!)].sort());

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('offsite_failed status (L14)', () => {
  it('marks the run offsite_failed (not failed) and still runs retention when REQUIRED offsite fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-offsite-'));
    const backupDir = join(dir, 'backups');
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, 'backup-2020-01-01.zip'), 'x');
    const db = makeSourceDb(join(dir, 'db.sqlite'), 2); // 2 dagar

    const prevCmd = process.env.OFFSITE_BACKUP_CMD;
    const prevReq = process.env.OFFSITE_BACKUP_REQUIRED;
    process.env.OFFSITE_BACKUP_CMD = 'false'; // sh -c false → exit 1 → offsite-fel
    process.env.OFFSITE_BACKUP_REQUIRED = 'true';
    try {
      const result = await runBackup(db, { backupDir, uploadDir: join(dir, 'nouploads') });

      // Lokal backup OK → offsite_failed med korrekt size, inte 'failed'.
      expect(result.status).toBe('offsite_failed');
      expect(result.sizeBytes).toBeGreaterThan(0);
      const cfg = getBackupConfig(db);
      expect(cfg.lastStatus).toBe('offsite_failed');
      expect(cfg.lastSizeBytes).toBeGreaterThan(0);
      expect(cfg.lastError).toMatch(/Command failed/);

      // Retention kördes trots offsite-felet (tidigare hoppades dagen över).
      expect(existsSync(join(backupDir, 'backup-2020-01-01.zip'))).toBe(false);
      expect(readdirSync(backupDir).filter((f) => f.startsWith('backup-'))).toEqual([basename(result.path!)]);

      // Lokala pipelinen är frisk → konsekutiv-räknaren för backup-fel nollställd.
      expect(cfg.consecutiveFailures).toBe(0);
    } finally {
      if (prevCmd === undefined) delete process.env.OFFSITE_BACKUP_CMD;
      else process.env.OFFSITE_BACKUP_CMD = prevCmd;
      if (prevReq === undefined) delete process.env.OFFSITE_BACKUP_REQUIRED;
      else process.env.OFFSITE_BACKUP_REQUIRED = prevReq;
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('consecutive failure alarm (M13)', () => {
  it('persists the counter, pushes to admins once at threshold 3, resets on success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-fail-'));
    const backupDir = join(dir, 'backups');
    const db = makeSourceDb(join(dir, 'db.sqlite'), 7);
    vi.mocked(sendPushToAllSubscriptions).mockClear();
    vi.mocked(logger.error).mockClear();

    // En FIL på backupDir-sökvägen får mkdirSync att kasta → körningen failar.
    const badDir = join(dir, 'blocked');
    writeFileSync(badDir, 'not a directory');

    for (let i = 1; i <= 3; i++) {
      const r = await runBackup(db, { backupDir: badDir, uploadDir: join(dir, 'nouploads') });
      expect(r.status).toBe('failed');
      const cfg = getBackupConfig(db);
      expect(cfg.consecutiveFailures).toBe(i);
      expect(cfg.lastError).toBeTruthy();
      if (i < 3) expect(sendPushToAllSubscriptions).not.toHaveBeenCalled();
    }

    await vi.waitFor(() => expect(sendPushToAllSubscriptions).toHaveBeenCalledTimes(1));
    const [payload, userId] = vi.mocked(sendPushToAllSubscriptions).mock.calls[0];
    expect(userId).toBe('admin-1'); // bara admins, inte vanliga användare
    expect(payload.title).toBe('Backup misslyckades');
    expect(payload.body).toMatch(/3 gånger i rad/);
    expect(
      vi.mocked(logger.error).mock.calls.some(([msg]) => String(msg).startsWith('BACKUP ALERT')),
    ).toBe(true);

    // Fjärde felet larmar inte igen (ingen daglig push-spam).
    await runBackup(db, { backupDir: badDir, uploadDir: join(dir, 'nouploads') });
    expect(getBackupConfig(db).consecutiveFailures).toBe(4);
    expect(sendPushToAllSubscriptions).toHaveBeenCalledTimes(1);

    // Lyckad körning nollställer både räknaren och last_error.
    const ok = await runBackup(db, { backupDir, uploadDir: join(dir, 'nouploads') });
    expect(ok.status).toBe('success');
    expect(getBackupConfig(db)).toMatchObject({ consecutiveFailures: 0, lastError: null });

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('backup hardening', () => {
  it('fails the run and leaves no backup file when the written ZIP has no database entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-verify-'));
    const backupDir = join(dir, 'backups');
    const db = makeSourceDb(join(dir, 'db.sqlite'), 7);

    unzipState.emptyListing = true;
    try {
      const result = await runBackup(db, { backupDir, uploadDir: join(dir, 'nouploads') });
      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/ofullständig/);
      expect(readdirSync(backupDir)).toEqual([]); // varken .zip eller .zip.tmp kvar
      expect(getBackupConfig(db).lastStatus).toBe('failed');
    } finally {
      unzipState.emptyListing = false;
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('assertEnoughDiskSpace requires 2x the data and at least 500 MB free', () => {
    const MB = 1024 * 1024;
    expect(() => assertEnoughDiskSpace(100 * MB, 1 * MB)).toThrow(/diskutrymme/);
    expect(() => assertEnoughDiskSpace(700 * MB, 400 * MB)).toThrow(/diskutrymme/);
    expect(() => assertEnoughDiskSpace(900 * MB, 400 * MB)).not.toThrow();
    expect(() => assertEnoughDiskSpace(600 * MB, 1 * MB)).not.toThrow();
  });

  it('waitForBackup returns true when idle, false on timeout, true once the run finishes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-wait-'));
    const backupDir = join(dir, 'backups');
    const db = makeSourceDb(join(dir, 'db.sqlite'), 7);

    expect(await waitForBackup(1000)).toBe(true);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const realBackup = db.backup.bind(db);
    vi.spyOn(db, 'backup').mockImplementationOnce(async (dest: string) => {
      await gate;
      return realBackup(dest);
    });

    vi.useFakeTimers();
    try {
      const run = runBackup(db, { backupDir, uploadDir: join(dir, 'nouploads') });
      expect(isBackupRunning()).toBe(true);
      const waiting = waitForBackup(300);
      await vi.advanceTimersByTimeAsync(400);
      expect(await waiting).toBe(false);

      vi.useRealTimers();
      release();
      expect((await run).status).toBe('success');
      expect(await waitForBackup(1000)).toBe(true);
    } finally {
      vi.useRealTimers();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('catch-up on missed run (M12)', () => {
  it('isCatchUpNeeded: true when last run is missing, unparsable or older than 24h', () => {
    const now = Date.parse('2026-07-02T12:00:00Z');
    expect(isCatchUpNeeded(null, now)).toBe(true);
    expect(isCatchUpNeeded('not-a-date', now)).toBe(true);
    expect(isCatchUpNeeded(new Date(now - 25 * 3600 * 1000).toISOString(), now)).toBe(true);
    expect(isCatchUpNeeded(new Date(now - 23 * 3600 * 1000).toISOString(), now)).toBe(false);
  });

  it('runs a catch-up backup at scheduler start when the last run is stale', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-catchup-'));
    const backupDir = join(dir, 'backups');
    const db = makeSourceDb(join(dir, 'db.sqlite'), 7);
    db.prepare('UPDATE backup_config SET last_run_at = ? WHERE id = 1')
      .run(new Date(Date.now() - 48 * 3600 * 1000).toISOString());

    startBackupScheduler(db, { backupDir, uploadDir: join(dir, 'nouploads') });
    try {
      // Catch-up-körningen är asynkron — vänta tills status uppdaterats.
      await vi.waitFor(() => expect(getBackupConfig(db).lastStatus).toBe('success'), { timeout: 5000 });
      expect(readdirSync(backupDir).filter((f) => BACKUP_ZIP_NAME_RE.test(f))).toHaveLength(1);
    } finally {
      stopBackupScheduler();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not run a catch-up when the last run is recent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-nocatchup-'));
    const backupDir = join(dir, 'backups');
    const db = makeSourceDb(join(dir, 'db.sqlite'), 7);
    db.prepare('UPDATE backup_config SET last_run_at = ? WHERE id = 1')
      .run(new Date().toISOString());

    startBackupScheduler(db, { backupDir, uploadDir: join(dir, 'nouploads') });
    try {
      // Catch-up-beslutet tas synkront vid start: ingen körning ska ha satts igång.
      expect(isBackupRunning()).toBe(false);
      expect(readdirSync(backupDir).filter((f) => f.startsWith('backup-'))).toEqual([]);
      expect(getBackupConfig(db).lastStatus).toBe(null);
    } finally {
      stopBackupScheduler();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
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
