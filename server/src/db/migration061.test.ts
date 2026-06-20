import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { migrations } from './migrations.js';

// ─────────────────────────────────────────────────────────────────────────────
// Migration 061: create_backup_config
//
// Inför en enrads-tabell `backup_config` (id=1) som blir källa till sanning för
// det automatiska backup-schemat (paus, tid, retention) + senaste-körning-status.
// Seedas med nuvarande beteende (enabled=1, 04:00, retention 7) så inget ändras
// förrän någon redigerar via UI. Retention seedas från BACKUP_RETENTION_DAYS-env
// om satt, så en befintlig env-override bevaras.
// ─────────────────────────────────────────────────────────────────────────────

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const migration061 = migrations.find((m) => m.id === '061');

const helpers = {
  tableExists: () => false,
  columnExists: () => false,
};

interface Row {
  id: number;
  enabled: number;
  time: string;
  retention_days: number;
  last_run_at: string | null;
  last_status: string | null;
  last_size_bytes: number | null;
  updated_at: string;
}

function readRow(db: DatabaseType): Row {
  return db.prepare('SELECT * FROM backup_config WHERE id = 1').get() as Row;
}

describe('migration 061: create_backup_config', () => {
  let db: DatabaseType;
  let prevEnv: string | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    prevEnv = process.env.BACKUP_RETENTION_DAYS;
    delete process.env.BACKUP_RETENTION_DAYS;
  });

  afterEach(() => {
    db.close();
    if (prevEnv === undefined) delete process.env.BACKUP_RETENTION_DAYS;
    else process.env.BACKUP_RETENTION_DAYS = prevEnv;
  });

  it('exists in the migrations array with the expected id/name', () => {
    expect(migration061).toBeDefined();
    expect(migration061!.name).toBe('create_backup_config');
  });

  it('creates backup_config seeded with current defaults (enabled, 04:00, retention 7)', () => {
    migration061!.up(db, helpers);

    const row = readRow(db);
    expect(row).toBeDefined();
    expect(row.id).toBe(1);
    expect(row.enabled).toBe(1);
    expect(row.time).toBe('04:00');
    expect(row.retention_days).toBe(7);
    expect(row.last_run_at).toBeNull();
    expect(row.last_status).toBeNull();
    expect(row.updated_at).toMatch(ISO_RE);
  });

  it('seeds retention_days from BACKUP_RETENTION_DAYS env when set', () => {
    process.env.BACKUP_RETENTION_DAYS = '14';
    migration061!.up(db, helpers);
    expect(readRow(db).retention_days).toBe(14);
  });

  it('is idempotent — running up() twice keeps exactly one row, unchanged', () => {
    migration061!.up(db, helpers);
    // Simulate a user edit, then re-run: INSERT OR IGNORE must NOT overwrite it.
    db.prepare("UPDATE backup_config SET enabled = 0, time = '02:30', retention_days = 30 WHERE id = 1").run();

    expect(() => migration061!.up(db, helpers)).not.toThrow();

    const count = db.prepare('SELECT COUNT(*) AS c FROM backup_config').get() as { c: number };
    expect(count.c).toBe(1);
    const row = readRow(db);
    expect(row.enabled).toBe(0);
    expect(row.time).toBe('02:30');
    expect(row.retention_days).toBe(30);
  });
});
