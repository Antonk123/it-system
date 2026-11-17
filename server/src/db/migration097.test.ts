import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { migrations } from './migrations.js';
import { migrationHelpers, runMigrations } from './runner.js';

const migration = migrations.find(item => item.id === '097')!;
const ORIGINAL = '2020-01-02T09:00:00.000Z';
const CREATED = '2020-01-01T08:00:00.000Z';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function legacyDatabase() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE ticket_comments (
    id TEXT PRIMARY KEY, user_id TEXT, content TEXT NOT NULL, is_internal INTEGER,
    created_at TEXT, updated_at TEXT, deleted_at TEXT,
    email_from_name TEXT, email_from_address TEXT, email_message_id TEXT
  );
  CREATE TRIGGER update_comment_updated_at AFTER UPDATE ON ticket_comments FOR EACH ROW BEGIN
    UPDATE ticket_comments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
  END`);
  return db;
}

function seed(db: Database.Database, id = 'comment', timestamp: string | null = ORIGINAL) {
  db.prepare('INSERT INTO ticket_comments (id,user_id,content,is_internal,created_at,updated_at) VALUES (?,?,?,1,?,?)')
    .run(id, 'author', 'Original content', CREATED, timestamp);
}

const comment = (db: Database.Database, id = 'comment') => db.prepare('SELECT * FROM ticket_comments WHERE id=?').get(id) as
  { content: string; created_at: string; updated_at: string | null; user_id: string; deleted_at: string | null };
const trigger = (db: Database.Database) => db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='update_comment_updated_at'").pluck().get();

describe('migration 097: comment edit timestamps follow actual content changes', () => {
  it('replaces the shipped all-UPDATE trigger without rewriting comment history and is restart/idempotency safe', () => {
    const db = legacyDatabase();
    try {
      seed(db);
      seed(db, 'nullable-timestamp', null);
      const before = db.prepare('SELECT * FROM ticket_comments ORDER BY id').all();
      expect(trigger(db)).toContain('AFTER UPDATE ON ticket_comments');
      expect(migration).toBeDefined();
      runMigrations(db, [migration]);
      expect(db.prepare('SELECT * FROM ticket_comments ORDER BY id').all()).toEqual(before);
      const sql = trigger(db);
      expect(sql).toContain('AFTER UPDATE OF content ON ticket_comments');
      expect(sql).toContain('WHEN NEW.content IS NOT OLD.content');
      runMigrations(db, [migration]);
      migration.up(db, migrationHelpers(db));
      expect(trigger(db)).toBe(sql);
      expect(db.prepare('SELECT * FROM ticket_comments ORDER BY id').all()).toEqual(before);
      expect(db.prepare('SELECT id FROM schema_migrations').pluck().all()).toEqual(['097']);
    } finally { db.close(); }
  });

  it.each([
    "user_id='system'", 'is_internal=0', "deleted_at='2026-11-17T12:00:00.000Z'",
    "email_from_name='Sender'", "email_from_address='sender@example.test'", "email_message_id='message-id'",
    'content=content', "content='Original content', user_id='system'",
  ])('preserves edit history for metadata/unchanged content: %s', update => {
    const db = legacyDatabase();
    try {
      seed(db);
      seed(db, 'nullable-timestamp', null);
      runMigrations(db, [migration]);
      db.exec(`UPDATE ticket_comments SET ${update}`);
      expect(comment(db)).toMatchObject({ content: 'Original content', created_at: CREATED, updated_at: ORIGINAL });
      expect(comment(db, 'nullable-timestamp')).toMatchObject({ content: 'Original content', created_at: CREATED, updated_at: null });
    } finally { db.close(); }
  });

  it('stamps real content edits with ISO UTC time, preserves creation time and does not recurse', () => {
    const db = legacyDatabase();
    try {
      seed(db);
      seed(db, 'other');
      seed(db, 'nullable-timestamp', null);
      runMigrations(db, [migration]);
      db.pragma('recursive_triggers=ON');
      const before = Date.now();
      db.prepare('UPDATE ticket_comments SET content=? WHERE id=?').run('Edited content', 'comment');
      const edited = comment(db);
      expect(edited).toMatchObject({ content: 'Edited content', created_at: CREATED });
      expect(edited.updated_at).toMatch(ISO);
      expect(Date.parse(edited.updated_at!)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(edited.updated_at!)).toBeLessThanOrEqual(Date.now());
      expect(comment(db, 'other').updated_at).toBe(ORIGINAL);
      db.prepare('UPDATE ticket_comments SET content=? WHERE id=?').run('First edited content', 'nullable-timestamp');
      expect(comment(db, 'nullable-timestamp').updated_at).toMatch(ISO);
      // Content itself is NOT NULL in both installed schemas; null is never a valid edit.
      expect(() => db.prepare('UPDATE ticket_comments SET content=NULL WHERE id=?').run('comment')).toThrow(/NOT NULL/);
    } finally { db.close(); }
  });

  it('allows explicit timestamp maintenance without immediately stamping over the supplied value', () => {
    const db = legacyDatabase();
    try {
      seed(db);
      runMigrations(db, [migration]);
      const corrected = '2020-01-02T10:00:00.000Z';
      db.prepare('UPDATE ticket_comments SET updated_at=? WHERE id=?').run(corrected, 'comment');
      expect(comment(db)).toMatchObject({ created_at: CREATED, updated_at: corrected, content: 'Original content' });
    } finally { db.close(); }
  });

  it('fresh schema alone has the same content-only behavior as an upgraded database', () => {
    const fresh = new Database(':memory:');
    const upgraded = legacyDatabase();
    try {
      fresh.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
      fresh.exec("INSERT INTO users(id,email,password_hash) VALUES ('author','author@example.test','x'),('system','system@example.test','x'); INSERT INTO tickets(id,title,description) VALUES ('ticket','Timestamp fixture','Description')");
      fresh.prepare("INSERT INTO ticket_comments(id,ticket_id,user_id,content,created_at,updated_at) VALUES ('comment','ticket','author','Original content',?,?)")
        .run(CREATED, ORIGINAL);
      seed(upgraded);
      runMigrations(upgraded, [migration]);
      for (const db of [fresh, upgraded]) {
        db.prepare("UPDATE ticket_comments SET user_id='system',content=content WHERE id='comment'").run();
        expect(comment(db)).toMatchObject({ content: 'Original content', created_at: CREATED, updated_at: ORIGINAL });
        db.prepare("UPDATE ticket_comments SET content='Edited content' WHERE id='comment'").run();
        expect(comment(db).updated_at).toMatch(ISO);
      }
    } finally { fresh.close(); upgraded.close(); }
  });
});
