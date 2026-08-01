import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { existsSync, rmSync } from 'fs';

/**
 * logAudit() — api_key_id-spårbarhet.
 *
 * Två delar:
 *  (1) Migration 066 (add_audit_log_api_key_id): idempotens bevisas empiriskt
 *      genom att köra up() två gånger mot samma in-memory-DB.
 *  (2) logAudit(): skriver api_key_id när det skickas, NULL när det utelämnas
 *      (bakåtkompatibelt för de ~20 befintliga anropsplatserna). Körs mot en
 *      riktig temp-fil-DB via initializeDatabase(), samma mönster som övriga
 *      integrationstester i repot (migration-parity.test.ts, backup.test.ts).
 */

// Sätt env INNAN db/connection.js importeras (drar in DB_PATH vid modul-load).
// vi.hoisted() krävs (inte en vanlig funktion) — ESM-import-satser hissas
// alltid över vanlig top-level-kod, så utan detta skulle DB_PATH sättas
// EFTER att connection.js redan laddats.
const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-auditlog-test-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-auditlog-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-auditlog-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import { migrations } from '../db/migrations.js';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { logAudit } from './auditLog.js';

// ---------------------------------------------------------------------------
// (1) Migration 066: idempotens
// ---------------------------------------------------------------------------

const migration066 = migrations.find((m) => m.id === '066');

function realHelpers(memDb: DatabaseType) {
  return {
    tableExists: (name: string) =>
      !!memDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name),
    columnExists: (table: string, column: string) =>
      (memDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column),
  };
}

describe('migration 066: audit_log.api_key_id', () => {
  it('finns i arrayen med rätt id/namn', () => {
    expect(migration066).toBeDefined();
    expect(migration066!.name).toBe('add_audit_log_api_key_id');
  });

  it('lägger till den nullbara api_key_id-kolumnen', () => {
    const memDb = new Database(':memory:');
    memDb.exec(`CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT, details TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

    migration066!.up(memDb, realHelpers(memDb));

    expect(realHelpers(memDb).columnExists('audit_log', 'api_key_id')).toBe(true);
    // Ingen NOT NULL-constraint — befintliga rader (inga api_key_id vid insert) ska funka.
    expect(() => memDb.prepare('INSERT INTO audit_log (id, action, entity_type) VALUES (?, ?, ?)').run('a1', 'x', 'y')).not.toThrow();
    memDb.close();
  });

  it('är idempotent — två körningar mot samma DB kastar inte (bevisat empiriskt)', () => {
    const memDb = new Database(':memory:');
    memDb.exec(`CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT, details TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

    migration066!.up(memDb, realHelpers(memDb));
    expect(() => migration066!.up(memDb, realHelpers(memDb))).not.toThrow();

    // Kolumnen ska bara finnas en gång (PRAGMA table_info skulle annars visa dubblett).
    const cols = (memDb.prepare('PRAGMA table_info(audit_log)').all() as { name: string }[])
      .filter((c) => c.name === 'api_key_id');
    expect(cols.length).toBe(1);
    memDb.close();
  });
});

// ---------------------------------------------------------------------------
// (2) logAudit(): api_key_id-parametern
// ---------------------------------------------------------------------------

describe('logAudit()', () => {
  beforeAll(() => {
    initializeDatabase();
  });

  afterAll(() => {
    try { closeDatabase(); } catch { /* ignore */ }
    for (const suffix of ['', '-wal', '-shm']) {
      const f = DB_PATH + suffix;
      if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
    }
  });

  function lastAuditRow(action: string) {
    return db.prepare(
      'SELECT * FROM audit_log WHERE action = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
    ).get(action) as { api_key_id: string | null } | undefined;
  }

  it('skriver api_key_id när det skickas som sista argument', () => {
    logAudit(null, 'test_action_with_key', 'test', null, null, undefined, 'apikey-123');

    const row = lastAuditRow('test_action_with_key');
    expect(row).toBeDefined();
    expect(row!.api_key_id).toBe('apikey-123');
  });

  it('skriver NULL för api_key_id när parametern utelämnas (bakåtkompatibelt)', () => {
    // Anropas precis som de ~20 befintliga anropsplatserna — utan sjunde argumentet.
    logAudit(null, 'test_action_without_key', 'test', null, null, undefined);

    const row = lastAuditRow('test_action_without_key');
    expect(row).toBeDefined();
    expect(row!.api_key_id).toBeNull();
  });

  it('skriver NULL för api_key_id när null skickas explicit', () => {
    logAudit(null, 'test_action_explicit_null', 'test', null, null, undefined, null);

    const row = lastAuditRow('test_action_explicit_null');
    expect(row).toBeDefined();
    expect(row!.api_key_id).toBeNull();
  });

  it('kastar aldrig — fire-and-forget-garantin gäller oförändrad med den nya parametern', () => {
    expect(() => logAudit(null, 'test_never_throws', 'test', null, null, undefined, 'x')).not.toThrow();
  });
});
