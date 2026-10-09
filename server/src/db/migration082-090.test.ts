import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { migrations } from './migrations.js';
import { runMigrations } from './runner.js';

// 082 backup_config-felspårning · 083 must_change_password · 085 revoke_plaintext_refresh_tokens
// 086 ticket_reminders.attempts · 087 ticket_comments.email_message_id · 088 token_version
// 089 refresh_tokens.replaced_by · 090 kb_article_shares.expires_at
// (084 system user: lib/systemUser.test.ts, 081 kb-FTS: lib/fts.test.ts)

const dir = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(dir, 'schema.sql'), 'utf-8');
const upgradedSnapshot = readFileSync(join(dir, 'fixtures', 'upgraded-install-2026-08.sql'), 'utf-8');

const open = (): DatabaseType => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
};
const fresh = () => {
  const db = open();
  db.exec(schema);
  runMigrations(db);
  return db;
};
const upgraded = () => {
  const db = open();
  db.exec(upgradedSnapshot);
  db.exec(schema);
  runMigrations(db);
  return db;
};
const columns = (db: DatabaseType, table: string) =>
  db.prepare('SELECT name, "notnull" AS nn, dflt_value AS dflt FROM pragma_table_info(?)').all(table) as {
    name: string; nn: number; dflt: string | null;
  }[];
const column = (db: DatabaseType, table: string, name: string) => columns(db, table).find((c) => c.name === name);
const indexColumns = (db: DatabaseType, index: string) =>
  (db.prepare(`PRAGMA index_info("${index}")`).all() as { name: string }[]).map((c) => c.name);

describe.each([
  ['fresh install', fresh],
  ['upgraded install', upgraded],
])('new columns on a %s', (_label, make) => {
  let db: DatabaseType;
  beforeEach(() => { db = make(); });
  afterEach(() => db.close());

  it('082 backup_config tracks consecutive failures and the last error', () => {
    expect(column(db, 'backup_config', 'consecutive_failures')).toMatchObject({ nn: 1, dflt: '0' });
    expect(column(db, 'backup_config', 'last_error')).toMatchObject({ nn: 0 });
    db.prepare("INSERT OR IGNORE INTO backup_config (id, updated_at) VALUES (1, '2026-01-01T00:00:00.000Z')").run();
    expect(db.prepare('SELECT consecutive_failures, last_error FROM backup_config WHERE id = 1').get()).toEqual({
      consecutive_failures: 0,
      last_error: null,
    });
  });

  it('083 users.must_change_password defaults to 0 and is NOT NULL', () => {
    expect(column(db, 'users', 'must_change_password')).toMatchObject({ nn: 1, dflt: '0' });
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('u', 'u@x.se', 'h')").run();
    expect(db.prepare("SELECT must_change_password FROM users WHERE id = 'u'").get()).toEqual({ must_change_password: 0 });
  });

  it('086 ticket_reminders.attempts defaults to 0', () => {
    expect(column(db, 'ticket_reminders', 'attempts')).toMatchObject({ nn: 1, dflt: '0' });
  });

  it('087 ticket_comments.email_message_id exists, is the LAST column and is indexed', () => {
    const cols = columns(db, 'ticket_comments').map((c) => c.name);
    expect(cols[cols.length - 1]).toBe('email_message_id');
    expect(indexColumns(db, 'idx_ticket_comments_email_message_id')).toEqual(['email_message_id']);
  });

  it('088 users.token_version defaults to 0', () => {
    expect(column(db, 'users', 'token_version')).toMatchObject({ nn: 1, dflt: '0' });
  });

  it('089 refresh_tokens.replaced_by is the LAST column and is indexed', () => {
    const cols = columns(db, 'refresh_tokens').map((c) => c.name);
    expect(cols[cols.length - 1]).toBe('replaced_by');
    expect(indexColumns(db, 'idx_refresh_tokens_replaced_by')).toEqual(['replaced_by']);
  });

  it('090 kb_article_shares.expires_at is nullable (NULL = no expiry)', () => {
    expect(column(db, 'kb_article_shares', 'expires_at')).toMatchObject({ nn: 0 });
  });
});

describe('migration 085: revoke plaintext refresh tokens', () => {
  it('purges every stored refresh token once and leaves later inserts alone', () => {
    const db = open();
    db.exec(schema);
    runMigrations(db, migrations.filter((m) => m.id < '085'));
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('u', 'u@x.se', 'h')").run();
    const insert = db.prepare("INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, 'u', ?, '2099-01-01T00:00:00.000Z')");
    insert.run('r1', 'plaintext-token-1');
    insert.run('r2', 'plaintext-token-2');

    runMigrations(db, migrations.filter((m) => m.id === '085'));
    expect(db.prepare('SELECT COUNT(*) FROM refresh_tokens').pluck().get()).toBe(0);

    // Nya (hashade) tokens skrivs efter migrationen och överlever en omstart.
    insert.run('r3', 'a'.repeat(64));
    runMigrations(db);
    expect(db.prepare('SELECT COUNT(*) FROM refresh_tokens').pluck().get()).toBe(1);
    db.close();
  });
});

describe('migration 042: seed_default_sla_policies is a no-op for new installs', () => {
  it('keeps its id but inserts nothing', () => {
    const db = fresh();
    expect(db.prepare("SELECT name FROM schema_migrations WHERE id = '042'").get()).toEqual({ name: 'seed_default_sla_policies' });
    expect(db.prepare('SELECT COUNT(*) FROM sla_policies').pluck().get()).toBe(0);
    db.close();
  });
});

describe('migration idempotency helpers (IF NOT EXISTS)', () => {
  it('every CREATE TABLE / CREATE INDEX in the migrations is guarded', () => {
    const source = readFileSync(join(dir, 'migrations.ts'), 'utf-8');
    const bare = source.match(/CREATE (UNIQUE )?(INDEX|TABLE) (?!IF NOT EXISTS)(?!\w+_new\b)\w+/g) ?? [];
    expect(bare).toEqual([]);
  });
});
