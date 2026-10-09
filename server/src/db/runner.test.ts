import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Migration } from './migrations.js';

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { runMigrations, takePreMigrationSnapshot } from './runner.js';

const parentChild = (db: DatabaseType) => {
  db.exec(`
    CREATE TABLE parent (id TEXT PRIMARY KEY, label TEXT);
    CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE);
    INSERT INTO parent VALUES ('p1', 'a'), ('p2', 'b');
    INSERT INTO child VALUES ('c1', 'p1'), ('c2', 'p1'), ('c3', 'p2');
  `);
};

const rebuildParent: Migration['up'] = (db) => {
  db.exec('CREATE TABLE parent_new (id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT \'\')');
  db.exec("INSERT INTO parent_new (id, label) SELECT id, COALESCE(label, '') FROM parent");
  db.exec('DROP TABLE parent');
  db.exec('ALTER TABLE parent_new RENAME TO parent');
};

const childCount = (db: DatabaseType) => db.prepare('SELECT COUNT(*) FROM child').pluck().get() as number;

describe('runMigrations: disableForeignKeys', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    parentChild(db);
  });
  afterEach(() => db.close());

  it('without the flag, rebuilding the parent cascade-deletes the children', () => {
    runMigrations(db, [{ id: '1', name: 'rebuild', up: rebuildParent }]);
    expect(childCount(db)).toBe(0);
  });

  it('with the flag, children survive, foreign keys are back on, and the migration is recorded', () => {
    runMigrations(db, [{ id: '1', name: 'rebuild', disableForeignKeys: true, up: rebuildParent }]);
    expect(childCount(db)).toBe(3);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare('SELECT id FROM schema_migrations').all()).toEqual([{ id: '1' }]);
    // Barnen hänger fortfarande på den ombyggda föräldern.
    db.prepare("DELETE FROM parent WHERE id = 'p1'").run();
    expect(childCount(db)).toBe(1);
  });

  it('rolls back, rethrows and restores foreign keys when the migration introduces violations', () => {
    const breaking: Migration = {
      id: '1',
      name: 'orphans',
      disableForeignKeys: true,
      up: (d) => d.exec("INSERT INTO child VALUES ('bad', 'ghost')"),
    };
    expect(() => runMigrations(db, [breaking])).toThrow(/foreign_key_check/);
    expect(childCount(db)).toBe(3);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(0);
  });

  it('tolerates orphans that existed before the migration (only new violations fail)', () => {
    db.pragma('foreign_keys = OFF');
    db.exec("INSERT INTO child VALUES ('old-orphan', 'ghost')");
    db.pragma('foreign_keys = ON');
    expect(() => runMigrations(db, [{ id: '1', name: 'rebuild', disableForeignKeys: true, up: rebuildParent }])).not.toThrow();
  });

  it('fails on a NEW violation even when the migration also fixes an old one (equal count)', () => {
    db.pragma('foreign_keys = OFF');
    db.exec("INSERT INTO child VALUES ('old-orphan', 'ghost')");
    db.pragma('foreign_keys = ON');
    const swap: Migration = {
      id: '1',
      name: 'swap-orphans',
      disableForeignKeys: true,
      up: (d) => {
        d.exec("INSERT INTO child VALUES ('new-orphan', 'ghost')");
        d.exec("DELETE FROM child WHERE id = 'old-orphan'");
      },
    };
    expect(() => runMigrations(db, [swap])).toThrow(/introduced 1 foreign key violation/);
    expect(db.prepare("SELECT id FROM child WHERE id = 'old-orphan'").get()).toBeDefined();
  });

  it('restores foreign keys when the migration itself throws', () => {
    const failing: Migration = { id: '1', name: 'boom', disableForeignKeys: true, up: () => { throw new Error('boom'); } };
    expect(() => runMigrations(db, [failing])).toThrow('boom');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('skips already applied migrations and stops at the first failure', () => {
    const ran: string[] = [];
    const list: Migration[] = [
      { id: '1', name: 'a', up: () => ran.push('1') },
      { id: '2', name: 'b', up: () => { throw new Error('nope'); } },
      { id: '3', name: 'c', up: () => ran.push('3') },
    ];
    expect(() => runMigrations(db, list)).toThrow('nope');
    expect(ran).toEqual(['1']);
    list[1].up = () => ran.push('2');
    runMigrations(db, list);
    expect(ran).toEqual(['1', '2', '3']);
  });
});

describe('pre-migration snapshot', () => {
  let dir: string;
  let dbPath: string;
  let backupDir: string;
  let db: DatabaseType;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'itticket-snapshot-'));
    dbPath = join(dir, 'database.sqlite');
    backupDir = join(dir, 'backups');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE t (id TEXT PRIMARY KEY); INSERT INTO t VALUES ('before');");
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const snapshots = () => (existsSync(backupDir) ? readdirSync(backupDir) : []);
  const noop = (id: string): Migration => ({ id, name: `m${id}`, up: () => {} });

  it('writes a readable copy that includes data still sitting in the WAL', () => {
    const path = takePreMigrationSnapshot(db, backupDir, '072')!;
    expect(path).toMatch(/pre-migration-072-.*\.sqlite$/);
    const copy = new Database(path, { readonly: true });
    expect(copy.prepare('SELECT id FROM t').all()).toEqual([{ id: 'before' }]);
    copy.close();
  });

  it('snapshots before applying pending migrations on an existing database', () => {
    runMigrations(db, [noop('1')]);
    expect(snapshots()).toEqual([]); // helt ny databas: inget att skydda
    runMigrations(db, [noop('1'), noop('2')], { snapshotDir: backupDir });
    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0]).toMatch(/^pre-migration-2-/);
  });

  it('writes nothing for a fresh database, when nothing is pending, or for :memory:', () => {
    runMigrations(db, [noop('1')], { snapshotDir: backupDir });
    expect(snapshots()).toEqual([]);
    runMigrations(db, [noop('1')], { snapshotDir: backupDir });
    expect(snapshots()).toEqual([]);

    const mem = new Database(':memory:');
    runMigrations(mem, [noop('1')]);
    runMigrations(mem, [noop('1'), noop('2')], { snapshotDir: backupDir });
    expect(snapshots()).toEqual([]);
    mem.close();
  });

  it('keeps at most 3 snapshots and never touches backup-*.zip files', () => {
    runMigrations(db, [noop('0')]);
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, 'backup-2026-10-01.zip'), 'zip');
    for (let i = 1; i <= 5; i++) {
      takePreMigrationSnapshot(db, backupDir, String(i).padStart(3, '0'));
    }
    const kept = snapshots().filter((f) => f.startsWith('pre-migration-'));
    expect(kept).toHaveLength(3);
    expect(kept.every((f) => /pre-migration-00[345]-/.test(f))).toBe(true);
    expect(snapshots()).toContain('backup-2026-10-01.zip');
  });

  it('does not write a second snapshot for the same migration id (crash loop keeps the pre-upgrade copy)', () => {
    runMigrations(db, [noop('1')]);
    const failing: Migration = { id: '2', name: 'boom', up: () => { throw new Error('boom'); } };
    for (let i = 0; i < 3; i++) {
      expect(() => runMigrations(db, [noop('1'), failing], { snapshotDir: backupDir })).toThrow('boom');
    }
    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0]).toMatch(/^pre-migration-2-/);
    // Ett annat id får däremot en egen kopia.
    expect(takePreMigrationSnapshot(db, backupDir, '3')).not.toBeNull();
    expect(snapshots()).toHaveLength(2);
  });

  it('removes the partial target and returns null when the copy fails', () => {
    runMigrations(db, [noop('1')]);
    // Orimlig källfil: copyFileSync kastar och ingen kopia får bli kvar.
    const broken = { ...db, name: join(dir, 'does-not-exist.sqlite'), memory: false, pragma: db.pragma.bind(db) } as unknown as DatabaseType;
    expect(takePreMigrationSnapshot(broken, backupDir, '9')).toBeNull();
    expect(snapshots()).toEqual([]);
  });

  it('a failing snapshot does not block the migrations', () => {
    runMigrations(db, [noop('1')]);
    writeFileSync(backupDir, 'a file where the directory should be');
    expect(() => runMigrations(db, [noop('1'), noop('2')], { snapshotDir: backupDir })).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(2);
  });
});
