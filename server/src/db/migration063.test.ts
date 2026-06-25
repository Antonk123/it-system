import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { migrations } from './migrations.js';

// ─────────────────────────────────────────────────────────────────────────────
// Migration 063: invoice_authenticity_and_time_fields
//
// Gör fakturor juridiskt giltiga och stänger intäktsläckan:
//  - invoices: invoice_number (gapless löpnummer, global), vat_rate, vat_amount
//  - time_entries: billable (default 1), work_date
//  - partiellt UNIQUE-index på invoice_number (tillåter flera NULL = ej numrerade)
// ─────────────────────────────────────────────────────────────────────────────

const migration063 = migrations.find((m) => m.id === '063');

function realHelpers(db: DatabaseType) {
  return {
    tableExists: (name: string) =>
      !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name),
    columnExists: (table: string, column: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column),
  };
}

function setupBaseTables(db: DatabaseType) {
  db.exec(`CREATE TABLE invoices (
    id TEXT PRIMARY KEY, company_id TEXT, period_start TEXT, period_end TEXT,
    status TEXT DEFAULT 'draft', total_hours REAL DEFAULT 0, total_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'SEK', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.exec(`CREATE TABLE time_entries (
    id TEXT PRIMARY KEY, ticket_id TEXT, user_id TEXT, duration_minutes INTEGER,
    note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
}

describe('migration 063: invoice authenticity + time fields', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    setupBaseTables(db);
  });

  afterEach(() => db.close());

  it('exists in the migrations array with the expected id/name', () => {
    expect(migration063).toBeDefined();
    expect(migration063!.name).toBe('invoice_authenticity_and_time_fields');
  });

  it('adds invoice_number, vat_rate, vat_amount to invoices', () => {
    migration063!.up(db, realHelpers(db));
    const h = realHelpers(db);
    expect(h.columnExists('invoices', 'invoice_number')).toBe(true);
    expect(h.columnExists('invoices', 'vat_rate')).toBe(true);
    expect(h.columnExists('invoices', 'vat_amount')).toBe(true);
  });

  it('adds billable (default 1), work_date and invoice_id to time_entries', () => {
    migration063!.up(db, realHelpers(db));
    const h = realHelpers(db);
    expect(h.columnExists('time_entries', 'billable')).toBe(true);
    expect(h.columnExists('time_entries', 'work_date')).toBe(true);
    expect(h.columnExists('time_entries', 'invoice_id')).toBe(true);

    db.prepare("INSERT INTO time_entries (id, ticket_id, duration_minutes) VALUES ('t1', 'tk1', 30)").run();
    const row = db.prepare("SELECT billable FROM time_entries WHERE id = 't1'").get() as { billable: number };
    expect(row.billable).toBe(1);
  });

  it('enforces a gapless unique invoice_number but allows multiple NULLs', () => {
    migration063!.up(db, realHelpers(db));

    // Two un-numbered (NULL) invoices are allowed to coexist.
    db.prepare("INSERT INTO invoices (id) VALUES ('a')").run();
    db.prepare("INSERT INTO invoices (id) VALUES ('b')").run();

    db.prepare("UPDATE invoices SET invoice_number = 1 WHERE id = 'a'").run();
    // Re-using the same number must fail (gapless series integrity).
    expect(() => db.prepare("UPDATE invoices SET invoice_number = 1 WHERE id = 'b'").run()).toThrow();
  });

  it('is idempotent — running up() twice does not throw', () => {
    migration063!.up(db, realHelpers(db));
    expect(() => migration063!.up(db, realHelpers(db))).not.toThrow();
  });
});
