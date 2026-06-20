import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { migrations } from './migrations.js';

// ─────────────────────────────────────────────────────────────────────────────
// Migration 060: fix_checklist_and_comment_updated_at_trigger_iso
//
// Triggrarna update_checklist_updated_at / update_comment_updated_at skrev
// CURRENT_TIMESTAMP (SQLite-format 'YYYY-MM-DD HH:MM:SS') vid UPDATE och
// åsidosatte app-kodens ISO-värde (new Date().toISOString()). Migration 060
// droppar + återskapar dem med strftime('%Y-%m-%dT%H:%M:%fZ','now') → ISO-8601.
// ─────────────────────────────────────────────────────────────────────────────

// ISO 8601 UTC med millisekunder, ex '2026-06-20T08:30:00.123Z' — INTE
// SQLite-formatet med mellanslag ('2026-06-20 08:30:00').
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const migration060 = migrations.find((m) => m.id === '060');

// Helper-stubbar — migration 060 använder inga (up: (db) => ...), men typen kräver dem.
const helpers = {
  tableExists: () => true,
  columnExists: () => true,
};

function createSchema(db: DatabaseType): void {
  db.exec(`CREATE TABLE ticket_checklists (
    id TEXT PRIMARY KEY,
    title TEXT,
    updated_at TEXT
  )`);
  db.exec(`CREATE TABLE ticket_comments (
    id TEXT PRIMARY KEY,
    content TEXT,
    updated_at TEXT
  )`);
}

function triggerSql(db: DatabaseType, name: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
    .get(name) as { sql: string } | undefined;
  return row?.sql ?? '';
}

describe('migration 060: checklist + comment updated_at ISO trigger', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('exists in the migrations array with the expected id/name', () => {
    expect(migration060).toBeDefined();
    expect(migration060!.name).toBe('fix_checklist_and_comment_updated_at_trigger_iso');
  });

  it('writes ISO-8601 updated_at on checklist UPDATE (not SQLite format)', () => {
    migration060!.up(db, helpers);

    db.prepare("INSERT INTO ticket_checklists (id, title, updated_at) VALUES ('c1', 'a', '2020-01-01T00:00:00.000Z')").run();
    db.prepare("UPDATE ticket_checklists SET title = 'b' WHERE id = 'c1'").run();

    const { updated_at } = db
      .prepare("SELECT updated_at FROM ticket_checklists WHERE id = 'c1'")
      .get() as { updated_at: string };

    expect(updated_at).toMatch(ISO_RE);
    expect(updated_at).not.toContain(' '); // inte SQLite-formatet med mellanslag
  });

  it('writes ISO-8601 updated_at on comment UPDATE (not SQLite format)', () => {
    migration060!.up(db, helpers);

    db.prepare("INSERT INTO ticket_comments (id, content, updated_at) VALUES ('m1', 'x', '2020-01-01T00:00:00.000Z')").run();
    db.prepare("UPDATE ticket_comments SET content = 'y' WHERE id = 'm1'").run();

    const { updated_at } = db
      .prepare("SELECT updated_at FROM ticket_comments WHERE id = 'm1'")
      .get() as { updated_at: string };

    expect(updated_at).toMatch(ISO_RE);
    expect(updated_at).not.toContain(' ');
  });

  it('is idempotent — running up() twice does not throw', () => {
    expect(() => {
      migration060!.up(db, helpers);
      migration060!.up(db, helpers);
    }).not.toThrow();

    // ...och triggern fungerar fortfarande efter dubbelkörning.
    db.prepare("INSERT INTO ticket_comments (id, content, updated_at) VALUES ('m2', 'x', '2020-01-01T00:00:00.000Z')").run();
    db.prepare("UPDATE ticket_comments SET content = 'y' WHERE id = 'm2'").run();
    const { updated_at } = db
      .prepare("SELECT updated_at FROM ticket_comments WHERE id = 'm2'")
      .get() as { updated_at: string };
    expect(updated_at).toMatch(ISO_RE);
  });

  it('replaces an existing CURRENT_TIMESTAMP trigger (pre-migration DB) with strftime', () => {
    // Simulera en befintlig DB som schema.sql/migration 002 lämnade med fel format.
    db.exec(`CREATE TRIGGER update_comment_updated_at
      AFTER UPDATE ON ticket_comments FOR EACH ROW BEGIN
        UPDATE ticket_comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END`);
    expect(triggerSql(db, 'update_comment_updated_at')).toContain('CURRENT_TIMESTAMP');

    migration060!.up(db, helpers);

    const sql = triggerSql(db, 'update_comment_updated_at');
    expect(sql).toContain('strftime');
    expect(sql).not.toContain('CURRENT_TIMESTAMP');
  });

  it('sqlite_master shows strftime (not CURRENT_TIMESTAMP) for both triggers after migration', () => {
    migration060!.up(db, helpers);

    for (const name of ['update_checklist_updated_at', 'update_comment_updated_at']) {
      const sql = triggerSql(db, name);
      expect(sql).toContain('strftime');
      expect(sql).not.toContain('CURRENT_TIMESTAMP');
    }
  });
});
