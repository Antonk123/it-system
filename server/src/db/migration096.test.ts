import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { migrations } from './migrations.js';
import { migrationHelpers, runMigrations } from './runner.js';

const migration = migrations.find(item => item.id === '096')!;
const ref = (id: string) => `<img src="/api/attachments/file/${id}">`;

function legacyDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tickets (id TEXT PRIMARY KEY, description TEXT, solution TEXT, notes TEXT);
    CREATE TABLE ticket_field_values (ticket_id TEXT, field_value TEXT);
    CREATE TABLE ticket_comments (ticket_id TEXT, content TEXT, is_internal INTEGER, deleted_at TEXT);
    CREATE TABLE ticket_attachments (id TEXT PRIMARY KEY, ticket_id TEXT, file_name TEXT, file_path TEXT, file_size INTEGER, file_type TEXT, created_at TEXT);
    CREATE TABLE support_ticket_files (attachment_id TEXT PRIMARY KEY);
  `);
  return db;
}

describe('migration 096 attachment sharing intent', () => {
  it('preserves proven public origins, protects private references, and leaves ambiguous historical files internal', () => {
    expect(migration).toBeDefined();
    const db = legacyDatabase();
    try {
      const names = ['description', 'solution', 'field', 'comment', 'notes', 'both', 'deleted-private', 'deleted-public', 'unknown', 'other-ticket', 'portal', 'private-portal', 'unknown-comment'] as const;
      const ids = Object.fromEntries(names.map(name => [name, randomUUID()])) as Record<typeof names[number], string>;
      db.prepare('INSERT INTO tickets VALUES (?,?,?,?)').run('ticket-one', ref(ids.description) + ref(ids.both) + ref(ids['deleted-private']), ref(ids.solution), ref(ids.notes) + ref(ids.both) + ref(ids['private-portal']));
      db.prepare('INSERT INTO tickets VALUES (?,?,?,?)').run('ticket-two', ref(ids['other-ticket']), '', '');
      db.prepare('INSERT INTO ticket_field_values VALUES (?,?)').run('ticket-one', ref(ids.field));
      const comment = db.prepare('INSERT INTO ticket_comments VALUES (?,?,?,?)');
      comment.run('ticket-one', ref(ids.comment), 0, null);
      comment.run('ticket-one', ref(ids['unknown-comment']), null, null);
      comment.run('ticket-one', ref(ids['deleted-private']), 1, '2026-01-01T00:00:00.000Z');
      comment.run('ticket-one', ref(ids['deleted-public']), 0, '2026-01-01T00:00:00.000Z');
      const insert = db.prepare('INSERT INTO ticket_attachments(id,ticket_id,file_name,file_path) VALUES (?,?,?,?)');
      for (const name of names) insert.run(ids[name], 'ticket-one', `${name}.png`, `original-${name}.png`);
      db.prepare('INSERT INTO support_ticket_files VALUES (?)').run(ids.portal);
      db.prepare('INSERT INTO support_ticket_files VALUES (?)').run(ids['private-portal']);

      runMigrations(db, [migration]);

      const rows = db.prepare('SELECT id,share_visibility,file_path FROM ticket_attachments').all() as Array<{ id: string; share_visibility: string; file_path: string }>;
      for (const name of names) {
        const row = rows.find(row => row.id === ids[name]);
        const expected = name === 'portal' ? 'public' : ['description', 'solution', 'field', 'comment'].includes(name) ? 'referenced' : 'internal';
        expect(row?.share_visibility, name).toBe(expected);
        expect(row?.file_path, name).toBe(`original-${name}.png`);
      }
      expect(rows).toHaveLength(names.length);
      expect(db.prepare('SELECT id FROM schema_migrations').pluck().all()).toEqual(['096']);

      // A second boot must preserve migrated policy and subsequent explicit choices.
      db.prepare("UPDATE ticket_attachments SET share_visibility='public' WHERE id=?").run(ids.unknown);
      runMigrations(db, [migration]);
      migration.up(db, migrationHelpers(db));
      expect(db.prepare('SELECT share_visibility FROM ticket_attachments WHERE id=?').pluck().get(ids.unknown)).toBe('public');
      expect(db.prepare('SELECT COUNT(*) FROM ticket_attachments').pluck().get()).toBe(names.length);
    } finally { db.close(); }
  });

  it('fresh installations have the same private default and reject missing or unknown classifications', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
      runMigrations(db);
      db.prepare('INSERT INTO tickets(id,title,description) VALUES (?,?,?)').run('fresh-ticket', 'Fresh', 'Description');
      db.prepare('INSERT INTO ticket_attachments(id,ticket_id,file_name,file_path) VALUES (?,?,?,?)').run('default-file', 'fresh-ticket', 'file.png', 'stored.png');
      expect(db.prepare('SELECT share_visibility FROM ticket_attachments WHERE id=?').pluck().get('default-file')).toBe('internal');
      const insert = db.prepare('INSERT INTO ticket_attachments(id,ticket_id,file_name,file_path,share_visibility) VALUES (?,?,?,?,?)');
      expect(() => insert.run('bad-classification', 'fresh-ticket', 'bad.png', 'bad.png', 'unclassified')).toThrow();
      expect(() => insert.run('missing-classification', 'fresh-ticket', 'bad.png', 'bad.png', null)).toThrow();
      const legacy = legacyDatabase();
      try {
        runMigrations(legacy, [migration]);
        const column = (database: Database.Database) => database.prepare("SELECT type,\"notnull\",dflt_value FROM pragma_table_info('ticket_attachments') WHERE name='share_visibility'").get();
        expect(column(db)).toEqual(column(legacy));
      } finally { legacy.close(); }
    } finally { db.close(); }
  });
});
