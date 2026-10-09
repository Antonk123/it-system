import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { migrations } from './migrations.js';
import { runMigrations } from './runner.js';

// 072: updated_at-triggern fyrar bara på innehållskolumner.
// 073: SQLite-format ('YYYY-MM-DD HH:MM:SS') normaliseras till ISO.
// 074: kvarglömda resolved_at/closed_at på återöppnade ärenden nollställs.

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf-8');

/** Databas som den ser ut precis FÖRE migration `beforeId` (schema.sql + alla tidigare). */
function bootBefore(beforeId: string): DatabaseType {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  runMigrations(db, migrations.filter((m) => m.id < beforeId));
  return db;
}

const only = (id: string) => migrations.filter((m) => m.id === id);
const SQLITE_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ISO_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('migration 072: updated_at trigger only on content columns', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = bootBefore('073'); // 072 ingår
    db.prepare("INSERT INTO tickets (id, title, description, updated_at) VALUES ('t1', 'T', 'D', '2020-01-01T00:00:00.000Z')").run();
  });
  afterEach(() => db.close());

  const updatedAt = () => (db.prepare("SELECT updated_at FROM tickets WHERE id = 't1'").get() as { updated_at: string }).updated_at;

  it('registered with the expected id/name', () => {
    expect(migrations.find((m) => m.id === '072')?.name).toBe('update_ticket_updated_at_only_on_content_columns');
  });

  it.each([
    ['last_aging_notified_at', "UPDATE tickets SET last_aging_notified_at = '2026-10-01T00:00:00.000Z' WHERE id = 't1'"],
    ['email_message_id', "UPDATE tickets SET email_message_id = '<a@b>' WHERE id = 't1'"],
    ['ai_draft_response', "UPDATE tickets SET ai_draft_response = 'x' WHERE id = 't1'"],
    ['ai_suggested_confidence', 'UPDATE tickets SET ai_suggested_confidence = 0.9 WHERE id = \'t1\''],
    ['sla_response_met', 'UPDATE tickets SET sla_response_met = 1 WHERE id = \'t1\''],
    ['sla_paused_duration', 'UPDATE tickets SET sla_paused_duration = 5 WHERE id = \'t1\''],
    ['created_by', "UPDATE tickets SET created_by = NULL WHERE id = 't1'"],
  ])('does not touch updated_at when only %s changes', (_col, sql) => {
    db.exec(sql);
    expect(updatedAt()).toBe('2020-01-01T00:00:00.000Z');
  });

  it.each([
    ['title', "UPDATE tickets SET title = 'New' WHERE id = 't1'"],
    ['status', "UPDATE tickets SET status = 'in-progress' WHERE id = 't1'"],
    ['priority', "UPDATE tickets SET priority = 'high' WHERE id = 't1'"],
    ['notes', "UPDATE tickets SET notes = 'n' WHERE id = 't1'"],
    ['solution', "UPDATE tickets SET solution = 's' WHERE id = 't1'"],
  ])('stamps updated_at (ISO) when %s changes', (_col, sql) => {
    db.exec(sql);
    expect(updatedAt()).toMatch(ISO_FORMAT);
    expect(updatedAt()).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('migration 073: normalize SQLite timestamps to ISO', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = bootBefore('073');
    db.prepare("INSERT INTO users (id, email, password_hash, created_at, last_login) VALUES ('u1', 'u@x.se', 'h', '2026-01-02 03:04:05', '2026-02-03 04:05:06')").run();
    db.prepare(
      "INSERT INTO tickets (id, title, description, created_at, updated_at) VALUES ('t-space', 'T', 'D', '2026-10-01 08:30:00', '2026-10-02 09:00:00')"
    ).run();
    db.prepare(
      "INSERT INTO tickets (id, title, description, created_at, updated_at) VALUES ('t-iso', 'T', 'D', '2026-10-01T08:30:00.123Z', '2026-10-02T09:00:00.456Z')"
    ).run();
    db.prepare("INSERT INTO ticket_history (id, ticket_id, field_name, changed_at) VALUES ('h1', 't-space', 'status', '2026-10-01 10:00:00')").run();
    db.prepare("INSERT INTO ticket_comments (id, ticket_id, user_id, content, created_at, updated_at) VALUES ('c1', 't-space', 'u1', 'hej', '2026-10-01 11:00:00', '2026-10-01 11:00:00')").run();
    db.prepare("INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at) VALUES ('p1', 'u1', 'th', '2026-10-01T00:00:00.000Z', '2026-09-30 12:00:00', '2026-09-30 11:00:00')").run();
  });
  afterEach(() => db.close());

  const run = () => runMigrations(db, only('073'));

  it('converts every SQLite-format value to ISO with the same instant', () => {
    run();
    const t = db.prepare("SELECT created_at, updated_at FROM tickets WHERE id = 't-space'").get();
    expect(t).toEqual({ created_at: '2026-10-01T08:30:00.000Z', updated_at: '2026-10-02T09:00:00.000Z' });
    expect(db.prepare("SELECT changed_at FROM ticket_history WHERE id = 'h1'").get()).toEqual({ changed_at: '2026-10-01T10:00:00.000Z' });
    expect(db.prepare("SELECT last_login, created_at FROM users WHERE id = 'u1'").get()).toEqual({
      last_login: '2026-02-03T04:05:06.000Z',
      created_at: '2026-01-02T03:04:05.000Z',
    });
    expect(db.prepare("SELECT used_at, created_at FROM password_reset_tokens WHERE id = 'p1'").get()).toEqual({
      used_at: '2026-09-30T12:00:00.000Z',
      created_at: '2026-09-30T11:00:00.000Z',
    });
  });

  it('leaves values that are already ISO untouched', () => {
    run();
    expect(db.prepare("SELECT created_at, updated_at FROM tickets WHERE id = 't-iso'").get()).toEqual({
      created_at: '2026-10-01T08:30:00.123Z',
      updated_at: '2026-10-02T09:00:00.456Z',
    });
  });

  it('does not re-stamp updated_at on tickets or comments (triggers suspended and restored)', () => {
    run();
    expect((db.prepare("SELECT updated_at FROM ticket_comments WHERE id = 'c1'").get() as { updated_at: string }).updated_at).toBe(
      '2026-10-01T11:00:00.000Z'
    );
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'update_%'").all();
    expect(triggers).toHaveLength(3);
    // Återställd trigger fungerar fortfarande.
    db.prepare("UPDATE ticket_comments SET content = 'ändrad' WHERE id = 'c1'").run();
    expect((db.prepare("SELECT updated_at FROM ticket_comments WHERE id = 'c1'").get() as { updated_at: string }).updated_at).toMatch(ISO_FORMAT);
  });

  it('leaves no SQLite-format value in the normalised columns', () => {
    run();
    const rows = db.prepare('SELECT created_at, updated_at FROM tickets').all() as { created_at: string; updated_at: string }[];
    for (const r of rows) {
      expect(r.created_at).not.toMatch(SQLITE_FORMAT);
      expect(r.updated_at).not.toMatch(SQLITE_FORMAT);
    }
  });
});

describe('migration 074: clear stale resolved_at / closed_at', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = bootBefore('074');
    const insert = db.prepare(
      'INSERT INTO tickets (id, title, description, status, resolved_at, closed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const stamp = '2026-05-01T00:00:00.000Z';
    insert.run('reopened', 'T', 'D', 'open', stamp, stamp, stamp);
    insert.run('waiting', 'T', 'D', 'waiting', stamp, null, stamp);
    insert.run('resolved', 'T', 'D', 'resolved', stamp, stamp, stamp);
    insert.run('closed', 'T', 'D', 'closed', stamp, stamp, stamp);
  });
  afterEach(() => db.close());

  const row = (id: string) =>
    db.prepare('SELECT resolved_at, closed_at, updated_at FROM tickets WHERE id = ?').get(id) as {
      resolved_at: string | null;
      closed_at: string | null;
      updated_at: string;
    };

  it('nulls the timestamps that do not belong to the current status', () => {
    runMigrations(db, only('074'));
    expect(row('reopened')).toMatchObject({ resolved_at: null, closed_at: null });
    expect(row('waiting')).toMatchObject({ resolved_at: null, closed_at: null });
    // resolved behåller resolved_at men closed_at hör bara till closed
    expect(row('resolved')).toMatchObject({ resolved_at: '2026-05-01T00:00:00.000Z', closed_at: null });
    expect(row('closed')).toMatchObject({ resolved_at: '2026-05-01T00:00:00.000Z', closed_at: '2026-05-01T00:00:00.000Z' });
  });

  it('does not change updated_at of the cleaned tickets', () => {
    runMigrations(db, only('074'));
    expect(row('reopened').updated_at).toBe('2026-05-01T00:00:00.000Z');
  });
});
