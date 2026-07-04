import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { migrations } from './migrations.js';

// Migration 065: add_users_oidc_sub — SSO-koppling user ↔ extern OIDC-identitet.
// Partiellt UNIQUE-index (flera NULL tillåts; samma sub får inte länkas två gånger).

const migration065 = migrations.find((m) => m.id === '065');

function realHelpers(db: DatabaseType) {
  return {
    tableExists: (name: string) =>
      !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name),
    columnExists: (table: string, column: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column),
  };
}

function setupBaseTables(db: DatabaseType) {
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT,
    password_hash TEXT NOT NULL, role TEXT DEFAULT 'user',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_login TEXT)`);
}

describe('migration 065: users.oidc_sub', () => {
  let db: DatabaseType;

  beforeEach(() => { db = new Database(':memory:'); setupBaseTables(db); });
  afterEach(() => db.close());

  it('finns i arrayen med rätt id/namn', () => {
    expect(migration065).toBeDefined();
    expect(migration065!.name).toBe('add_users_oidc_sub');
  });

  it('lägger till oidc_sub + partiellt unikt index', () => {
    migration065!.up(db, realHelpers(db));
    expect(realHelpers(db).columnExists('users', 'oidc_sub')).toBe(true);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_oidc_sub'").get();
    expect(idx).toBeDefined();
  });

  it('är idempotent (två körningar kastar inte)', () => {
    migration065!.up(db, realHelpers(db));
    expect(() => migration065!.up(db, realHelpers(db))).not.toThrow();
  });

  it('unikt per sub men tillåter flera NULL', () => {
    migration065!.up(db, realHelpers(db));
    const ins = db.prepare("INSERT INTO users (id, email, password_hash, oidc_sub) VALUES (?, ?, 'x', ?)");
    ins.run('u1', 'a@x.se', 'sub-1');
    expect(() => ins.run('u2', 'b@x.se', 'sub-1')).toThrow(); // dubblett-sub
    ins.run('u3', 'c@x.se', null);
    ins.run('u4', 'd@x.se', null); // flera NULL OK
  });
});
