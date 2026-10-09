import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { migrations } from './migrations.js';
import { runMigrations } from './runner.js';

// 075: ticket_templates byggs om (FK på created_by, NOT NULL description_template, CHECK).
// 076: tags.color blir NOT NULL DEFAULT #3b82f6.
// 077: contacts dedupas skiftlägesokänsligt, därefter unikt index.
//
// 075/076 prövas mot den uppgraderade formen (fixturen) med riktig data — det är där
// ON DELETE CASCADE från template_fields/template_checklists/ticket_tags hotar barnraderna.

const dir = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(dir, 'schema.sql'), 'utf-8');
const upgradedSnapshot = readFileSync(join(dir, 'fixtures', 'upgraded-install-2026-08.sql'), 'utf-8');

const newDb = () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
};

function bootBefore(beforeId: string): DatabaseType {
  const db = newDb();
  db.exec(schema);
  runMigrations(db, migrations.filter((m) => m.id < beforeId));
  return db;
}

const count = (db: DatabaseType, sql: string) => (db.prepare(sql).pluck().get() as number);

/** Uppgraderad databas (fixturen) med data i tabellerna som byggs om, redo att startas. */
function upgradedWithData(): DatabaseType {
  const db = newDb();
  db.exec(upgradedSnapshot);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u@x.se', 'h')").run();
  db.prepare("INSERT INTO categories (id, name, label) VALUES ('cat1', 'n', 'Nätverk')").run();
  db.prepare(
    `INSERT INTO ticket_templates (id, name, description, template_type, title_template, description_template, category_id, created_by, position)
     VALUES ('tpl1', 'Mall 1', 'd', 'dynamic', 'Titel', NULL, 'cat1', 'u1', 1)`
  ).run();
  // created_by saknade FK i den uppgraderade formen → kan peka på en raderad användare.
  db.prepare(
    `INSERT INTO ticket_templates (id, name, title_template, description_template, created_by)
     VALUES ('tpl2', 'Mall 2', 'Titel 2', 'Beskrivning', 'borta')`
  ).run();
  db.prepare("INSERT INTO template_fields (id, template_id, field_name, field_label, field_type) VALUES ('f1', 'tpl1', 'a', 'A', 'text')").run();
  db.prepare("INSERT INTO template_fields (id, template_id, field_name, field_label, field_type) VALUES ('f2', 'tpl1', 'b', 'B', 'text')").run();
  db.prepare("INSERT INTO template_checklists (id, template_id, label) VALUES ('k1', 'tpl1', 'Steg')").run();
  db.prepare("INSERT INTO tickets (id, title, description, template_id) VALUES ('t1', 'T', 'D', 'tpl1')").run();
  db.prepare("INSERT INTO tags (id, name, color) VALUES ('tag1', 'vip', '#ff0000')").run();
  db.prepare("INSERT INTO ticket_tags (id, ticket_id, tag_id) VALUES ('tt1', 't1', 'tag1')").run();
  db.prepare("INSERT INTO kb_articles (id, title, content) VALUES ('a1', 'Artikel', '<p>Text</p>')").run();
  db.prepare("INSERT INTO kb_article_tags (id, article_id, tag, tag_id) VALUES ('kt1', 'a1', 'vip', 'tag1')").run();
  return db;
}

function startUp(db: DatabaseType) {
  db.exec(schema);
  runMigrations(db);
}

describe('migration 075: rebuild ticket_templates', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = upgradedWithData();
    startUp(db);
  });
  afterEach(() => db.close());

  it('keeps every template and all CASCADE children', () => {
    expect(count(db, 'SELECT COUNT(*) FROM ticket_templates')).toBe(2);
    expect(count(db, 'SELECT COUNT(*) FROM template_fields')).toBe(2);
    expect(count(db, 'SELECT COUNT(*) FROM template_checklists')).toBe(1);
  });

  it('copies data with explicit columns and repairs what the old form allowed', () => {
    expect(db.prepare("SELECT template_type, description_template, category_id, created_by, position FROM ticket_templates WHERE id = 'tpl1'").get()).toEqual({
      template_type: 'dynamic',
      description_template: '',
      category_id: 'cat1',
      created_by: 'u1',
      position: 1,
    });
    // Dangling created_by blir NULL i stället för att bryta FK-kontrollen.
    expect((db.prepare("SELECT created_by FROM ticket_templates WHERE id = 'tpl2'").get() as { created_by: string | null }).created_by).toBeNull();
  });

  it('ends with foreign keys on and no violations', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('enforces the new constraints', () => {
    expect(() =>
      db.prepare("INSERT INTO ticket_templates (id, name, title_template, description_template, created_by) VALUES ('x', 'X', 't', 'd', 'nobody')").run()
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db.prepare("INSERT INTO ticket_templates (id, name, title_template, description_template, template_type) VALUES ('y', 'Y', 't', 'd', 'weird')").run()
    ).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO ticket_templates (id, name, title_template) VALUES ('z', 'Z', 't')").run()).toThrow(/NOT NULL/);
  });

  it('keeps the children wired to the rebuilt table (cascade still works)', () => {
    db.prepare("DELETE FROM ticket_templates WHERE id = 'tpl1'").run();
    expect(count(db, 'SELECT COUNT(*) FROM template_fields')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) FROM template_checklists')).toBe(0);
  });

  it('would have wiped the children without disableForeignKeys (why the flag exists)', () => {
    const plain = upgradedWithData();
    const migration = migrations.find((m) => m.id === '075')!;
    const helpers = {
      tableExists: () => true,
      columnExists: () => true,
    };
    plain.transaction(() => migration.up(plain, helpers))();
    expect(count(plain, 'SELECT COUNT(*) FROM template_fields')).toBe(0);
    plain.close();
    expect(migration.disableForeignKeys).toBe(true);
  });
});

describe('migration 076: rebuild tags', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = upgradedWithData();
    startUp(db);
  });
  afterEach(() => db.close());

  it('keeps tags and the CASCADE children that hang on them', () => {
    expect(db.prepare("SELECT name, color FROM tags WHERE id = 'tag1'").get()).toEqual({ name: 'vip', color: '#ff0000' });
    expect(count(db, 'SELECT COUNT(*) FROM ticket_tags')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) FROM kb_article_tags')).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('has color NOT NULL DEFAULT #3b82f6', () => {
    const color = db.prepare("SELECT \"notnull\" AS nn, dflt_value AS dflt FROM pragma_table_info('tags') WHERE name = 'color'").get();
    expect(color).toEqual({ nn: 1, dflt: "'#3b82f6'" });
    db.prepare("INSERT INTO tags (id, name) VALUES ('t2', 'default-color')").run();
    expect((db.prepare("SELECT color FROM tags WHERE id = 't2'").get() as { color: string }).color).toBe('#3b82f6');
  });

  it('is a no-op on a fresh install that already has the target form', () => {
    const fresh = newDb();
    fresh.exec(schema);
    runMigrations(fresh, migrations.filter((m) => m.id < '076'));
    const before = (fresh.prepare("SELECT sql FROM sqlite_master WHERE name = 'tags'").get() as { sql: string }).sql;
    runMigrations(fresh, migrations.filter((m) => m.id === '076'));
    expect((fresh.prepare("SELECT sql FROM sqlite_master WHERE name = 'tags'").get() as { sql: string }).sql).toBe(before);
    fresh.close();
  });
});

describe('migration 077: dedupe contacts + unique email (NOCASE)', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = bootBefore('077');
    const insert = db.prepare('INSERT INTO contacts (id, name, email, created_at) VALUES (?, ?, ?, ?)');
    insert.run('oldest', 'Anna', 'Anna@Foretag.se', '2025-01-01T00:00:00.000Z');
    insert.run('dup-lower', 'Anna A', 'anna@foretag.se', '2025-06-01T00:00:00.000Z');
    insert.run('dup-upper', 'Anna B', 'ANNA@FORETAG.SE', '2025-07-01T00:00:00.000Z');
    insert.run('other', 'Bo', 'bo@foretag.se', '2025-02-01T00:00:00.000Z');
    const ticket = db.prepare("INSERT INTO tickets (id, title, description, requester_id, updated_at) VALUES (?, 'T', 'D', ?, '2026-01-01T00:00:00.000Z')");
    ticket.run('t-oldest', 'oldest');
    ticket.run('t-lower', 'dup-lower');
    ticket.run('t-upper', 'dup-upper');
    ticket.run('t-other', 'other');
  });
  afterEach(() => db.close());

  it('keeps the oldest contact per address, repoints tickets, deletes the rest', () => {
    runMigrations(db, migrations.filter((m) => m.id === '077'));
    expect((db.prepare('SELECT id FROM contacts ORDER BY id').all() as { id: string }[]).map((c) => c.id)).toEqual(['oldest', 'other']);
    const requesters = db.prepare('SELECT id, requester_id FROM tickets ORDER BY id').all();
    expect(requesters).toEqual([
      { id: 't-lower', requester_id: 'oldest' },
      { id: 't-oldest', requester_id: 'oldest' },
      { id: 't-other', requester_id: 'other' },
      { id: 't-upper', requester_id: 'oldest' },
    ]);
  });

  it('does not re-stamp updated_at on the repointed tickets', () => {
    runMigrations(db, migrations.filter((m) => m.id === '077'));
    expect(count(db, "SELECT COUNT(*) FROM tickets WHERE updated_at != '2026-01-01T00:00:00.000Z'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'update_ticket_updated_at'")).toBe(1);
  });

  it('enforces case-insensitive uniqueness afterwards', () => {
    runMigrations(db, migrations.filter((m) => m.id === '077'));
    expect(() => db.prepare("INSERT INTO contacts (id, name, email) VALUES ('n', 'N', 'BO@foretag.se')").run()).toThrow(/UNIQUE/);
    expect(() => db.prepare("INSERT INTO contacts (id, name, email) VALUES ('m', 'M', 'ny@foretag.se')").run()).not.toThrow();
  });

  it('is a no-op for the data when there are no duplicates (and a second run is safe)', () => {
    runMigrations(db, migrations.filter((m) => m.id === '077'));
    expect(() => migrations.find((m) => m.id === '077')!.up(db, { tableExists: () => true, columnExists: () => true })).not.toThrow();
    expect(count(db, 'SELECT COUNT(*) FROM contacts')).toBe(2);
  });
});
