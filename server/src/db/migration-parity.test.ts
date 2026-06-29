import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';

/**
 * Schema ↔ migrations parity / restart-safety.
 *
 * Architecture note: schema.sql is the BASE schema; migrations.ts is the
 * cumulative source of truth (newer columns, FTS5 virtual tables and auto-sync
 * triggers live only in migrations, NOT in schema.sql). So a naive
 * "schema.sql == schema.sql + migrations" diff would be pure noise.
 *
 * What this locks instead mirrors real production: the server calls
 * initializeDatabase() (schema.sql THEN runMigrations()) on EVERY restart,
 * against the already-populated DB volume. No existing test exercises that
 * second pass. We assert three invariants with near-zero false positives:
 *
 *   (A) migration ids are unique — a duplicate id is silently SKIPPED by the
 *       applied-set check in runMigrations(), so the second migration never runs.
 *   (B) restart is idempotent — a second initializeDatabase() on the same DB
 *       must not throw, must leave sqlite_master byte-identical, and must add no
 *       new schema_migrations rows. Catches a CREATE without IF NOT EXISTS in
 *       schema.sql (works on install, crashes every restart) and any migration
 *       that would re-run.
 *   (C) every migration in the array is recorded in schema_migrations after init
 *       — proves none was silently skipped (dup id / ordering bug).
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-migparity-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  return { DB_PATH: dbPath };
});

import { initializeDatabase, db, closeDatabase } from './connection.js';
import { migrations } from './migrations.js';

// Full schema fingerprint, minus SQLite's internal objects (sqlite_sequence,
// sqlite_autoindex_*). FTS5 shadow tables (tickets_fts_data, _idx, …) are real
// and stable across re-init, so they stay in the fingerprint.
const schemaFingerprint = () =>
  db.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%'
     ORDER BY type, name`
  ).all();

const migrationRowCount = () =>
  (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;

beforeAll(() => {
  initializeDatabase(); // first boot: schema.sql + all migrations
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('schema ↔ migrations parity', () => {
  it('(A) every migration id is unique', () => {
    const ids = migrations.map((m) => m.id);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      throw new Error(`Duplicate migration id(s) — the later one is silently skipped: ${[...new Set(dupes)].join(', ')}`);
    }
    expect(unique.size).toBe(ids.length);
  });

  it('(C) every migration in the array was actually applied (none silently skipped)', () => {
    const applied = new Set(
      (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id)
    );
    const missing = migrations.map((m) => m.id).filter((id) => !applied.has(id));
    expect(missing).toEqual([]);
  });

  it('(B) a restart — second initializeDatabase() on the same DB — is idempotent', () => {
    const before = schemaFingerprint();
    const migrationsBefore = migrationRowCount();

    // Mirrors a real container restart against the persisted volume.
    expect(() => initializeDatabase()).not.toThrow();

    const after = schemaFingerprint();
    const migrationsAfter = migrationRowCount();

    // Schema must be byte-identical: no "table already exists" from a missing
    // IF NOT EXISTS, no new objects from a migration re-running.
    expect(after).toEqual(before);
    // No migration re-applied (the applied-set gate held).
    expect(migrationsAfter).toBe(migrationsBefore);
  });
});
