import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { migrations } from './migrations.js';

// Migration 068: add_users_oidc_iss — namnrymdar OIDC-identiteten.
// sub är bara unikt inom en issuer, så unikhet på sub ENSAMT (migration 065)
// är fel: den kan låsa ute en giltig användare vid kollision mellan två IdP:er
// och den namnrymdar inte identiteten vid matchning. Paret (oidc_iss, oidc_sub)
// ersätter det.

const migration065 = migrations.find((m) => m.id === '065');
const migration068 = migrations.find((m) => m.id === '068');

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

const indexNames = (db: DatabaseType) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name);

describe('migration 068: users.oidc_iss', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    setupBaseTables(db);
    // 068 körs alltid ovanpå 065 i verkligheten — testa samma väg.
    migration065!.up(db, realHelpers(db));
  });
  afterEach(() => db.close());

  it('finns i arrayen med rätt id/namn', () => {
    expect(migration068).toBeDefined();
    expect(migration068!.name).toBe('add_users_oidc_iss');
  });

  it('lägger till oidc_iss-kolumnen', () => {
    migration068!.up(db, realHelpers(db));
    expect(realHelpers(db).columnExists('users', 'oidc_iss')).toBe(true);
  });

  it('ersätter idx_users_oidc_sub med idx_users_oidc_identity', () => {
    expect(indexNames(db)).toContain('idx_users_oidc_sub');
    migration068!.up(db, realHelpers(db));
    expect(indexNames(db)).not.toContain('idx_users_oidc_sub');
    expect(indexNames(db)).toContain('idx_users_oidc_identity');
  });

  it('är idempotent (två körningar kastar inte och ger samma schema)', () => {
    migration068!.up(db, realHelpers(db));
    const before = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    expect(() => migration068!.up(db, realHelpers(db))).not.toThrow();
    expect(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all()).toEqual(before);
  });

  it('samma sub från OLIKA issuers tillåts (det gamla indexet hade blockerat det)', () => {
    migration068!.up(db, realHelpers(db));
    const ins = db.prepare("INSERT INTO users (id, email, password_hash, oidc_sub, oidc_iss) VALUES (?, ?, 'x', ?, ?)");
    ins.run('u1', 'a@x.se', 'sub-1', 'https://login.microsoftonline.com/tenant-a/v2.0');
    expect(() =>
      ins.run('u2', 'b@x.se', 'sub-1', 'https://login.microsoftonline.com/tenant-b/v2.0')
    ).not.toThrow();
  });

  it('samma (iss, sub) två gånger avvisas, och flera NULL-sub tillåts', () => {
    migration068!.up(db, realHelpers(db));
    const iss = 'https://login.microsoftonline.com/tenant-a/v2.0';
    const ins = db.prepare("INSERT INTO users (id, email, password_hash, oidc_sub, oidc_iss) VALUES (?, ?, 'x', ?, ?)");
    ins.run('u1', 'a@x.se', 'sub-1', iss);
    expect(() => ins.run('u2', 'b@x.se', 'sub-1', iss)).toThrow();
    ins.run('u3', 'c@x.se', null, null);
    ins.run('u4', 'd@x.se', null, null); // flera NULL OK (partiellt index)
  });

  // Datamigreringen (inte bara schemat): rader som länkades under 065 har
  // oidc_sub satt men ingen issuer. Två medvetna beslut låses här —
  // (1) ingen dataförlust: subben rörs inte, (2) ingen backfill: oidc_iss
  // lämnas NULL eftersom den gamla subben inte kan bevisas komma från den
  // nu konfigurerade issuern. Låses raden upp automatiskt vore tenant-låset
  // (krav B) brutet för alla legacy-rader.
  describe('legacy-rader länkade före 068', () => {
    const legacySub = 'legacy-sub-1';

    // 065:s index gör sub ensamt unikt, så varje legacy-rad måste ha egen sub.
    function insertLegacyLinkedUser(id = 'legacy-1', email = 'legacy@x.se', sub = legacySub) {
      db.prepare("INSERT INTO users (id, email, password_hash, oidc_sub) VALUES (?, ?, 'x', ?)").run(
        id,
        email,
        sub
      );
    }

    it('lämnar oidc_sub oförändrad och oidc_iss NULL (ingen dataförlust, ingen backfill)', () => {
      insertLegacyLinkedUser();
      migration068!.up(db, realHelpers(db));

      const row = db
        .prepare('SELECT email, oidc_sub, oidc_iss FROM users WHERE id = ?')
        .get('legacy-1') as { email: string; oidc_sub: string | null; oidc_iss: string | null };
      expect(row.email).toBe('legacy@x.se');
      expect(row.oidc_sub).toBe(legacySub); // oförändrad — inget raderas
      expect(row.oidc_iss).toBeNull(); // INGEN backfill — issuern är obevisad
    });

    it('varnar med antal och åtgärd när sådana rader finns', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        insertLegacyLinkedUser('legacy-1', 'a@x.se', 'legacy-sub-1');
        insertLegacyLinkedUser('legacy-2', 'b@x.se', 'legacy-sub-2');
        migration068!.up(db, realHelpers(db));

        expect(warn).toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0][0]);
        expect(msg).toContain('2'); // antalet drabbade konton
        expect(msg).toMatch(/nekas/i); // att de låses ute
        expect(msg).toMatch(/koppla loss sso/i); // hur en admin löser det
      } finally {
        warn.mockRestore();
      }
    });

    it('varnar INTE när inga legacy-rader finns', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        db.prepare("INSERT INTO users (id, email, password_hash, oidc_sub) VALUES ('u1', 'a@x.se', 'x', NULL)").run();
        migration068!.up(db, realHelpers(db));
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });
});
