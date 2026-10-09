import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { migrations } from './migrations.js';
import { runMigrations } from './runner.js';

// 078: saknade FK-index. 079: redundanta index släpps (bekräftas via PRAGMA).
// 080: tickets.template_id nollas när mallen raderas.

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf-8');

function bootBefore(beforeId: string): DatabaseType {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  runMigrations(db, migrations.filter((m) => m.id < beforeId));
  return db;
}

const only = (id: string) => migrations.filter((m) => m.id === id);
const indexNames = (db: DatabaseType, table: string) =>
  (db.prepare(`PRAGMA index_list("${table}")`).all() as { name: string }[]).map((i) => i.name);
const indexColumns = (db: DatabaseType, index: string) =>
  (db.prepare(`PRAGMA index_info("${index}")`).all() as { name: string }[]).map((c) => c.name);

describe('migration 078: missing foreign-key indexes', () => {
  const expected: [string, string, string[]][] = [
    ['ticket_shares', 'idx_ticket_shares_ticket', ['ticket_id']],
    ['ticket_shares', 'idx_ticket_shares_created_by', ['created_by']],
    ['ticket_links', 'idx_ticket_links_created_by', ['created_by']],
    ['ticket_templates', 'idx_ticket_templates_category', ['category_id']],
    ['ticket_templates', 'idx_ticket_templates_created_by', ['created_by']],
    ['tickets', 'idx_tickets_ai_suggested_category', ['ai_suggested_category_id']],
    ['ticket_comments', 'idx_ticket_comments_ticket_deleted_created', ['ticket_id', 'deleted_at', 'created_at']],
  ];

  it.each(expected)('%s has %s', (table, name, columns) => {
    const db = bootBefore('079');
    expect(indexNames(db, table)).toContain(name);
    expect(indexColumns(db, name)).toEqual(columns);
    db.close();
  });

  it('is idempotent', () => {
    const db = bootBefore('079');
    expect(() => migrations.find((m) => m.id === '078')!.up(db, { tableExists: () => true, columnExists: () => true })).not.toThrow();
    db.close();
  });

  it('turns the ticket_shares(ticket_id) lookup from a SCAN into a SEARCH', () => {
    const db = bootBefore('079');
    const plan = (db.prepare("EXPLAIN QUERY PLAN SELECT id FROM ticket_shares WHERE ticket_id = 'x'").all() as { detail: string }[])
      .map((p) => p.detail)
      .join(' ');
    expect(plan).toContain('SEARCH');
    expect(plan).not.toContain('SCAN');
    db.close();
  });
});

describe('migration 079: drop redundant indexes', () => {
  // [index, tabell, kolumner] — varje rad måste vara en dubblett eller ett prefix av något annat index.
  const redundant: [string, string, string[]][] = [
    ['idx_users_email', 'users', ['email']],
    ['idx_refresh_tokens_token', 'refresh_tokens', ['token']],
    ['idx_ticket_shares_token', 'ticket_shares', ['share_token']],
    ['idx_kb_article_shares_token', 'kb_article_shares', ['share_token']],
    ['idx_password_reset_token_hash', 'password_reset_tokens', ['token_hash']],
    ['idx_billing_rates_company', 'billing_rates', ['company_id']],
    ['idx_push_subscriptions_endpoint', 'push_subscriptions', ['endpoint']],
    ['idx_checklist_templates_name', 'checklist_templates', ['name']],
    ['idx_ticket_tags_ticket', 'ticket_tags', ['ticket_id']],
    ['idx_ticket_kb_links_ticket', 'ticket_kb_links', ['ticket_id']],
    ['idx_ticket_links_source', 'ticket_links', ['source_ticket_id']],
    ['idx_kb_article_tags_article', 'kb_article_tags', ['article_id']],
    ['idx_kb_article_links_source', 'kb_article_links', ['source_article_id']],
    ['idx_sla_policies_company', 'sla_policies', ['company_id']],
    ['idx_tickets_status', 'tickets', ['status']],
    ['idx_ticket_field_values_ticket', 'ticket_field_values', ['ticket_id']],
    ['idx_ticket_field_values_field', 'ticket_field_values', ['field_name']],
    ['idx_ticket_comments_ticket', 'ticket_comments', ['ticket_id']],
  ];

  let db: DatabaseType;
  beforeEach(() => {
    db = bootBefore('079');
    // Index som tidigare kom från schema.sql (nu borttagna där) återskapas så testet
    // bevisar redundansen mot samma tillstånd som prod har.
    for (const [name, table, columns] of redundant) {
      db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns.join(', ')})`);
    }
  });
  afterEach(() => db.close());

  /** Finns ett annat index på tabellen vars första kolumner är exakt `columns`? */
  const coveredElsewhere = (table: string, redundantName: string, columns: string[]) =>
    (db.prepare(`PRAGMA index_list("${table}")`).all() as { name: string }[])
      .filter((i) => i.name !== redundantName)
      .some((i) => {
        const cols = indexColumns(db, i.name);
        return columns.every((c, idx) => cols[idx] === c);
      });

  it.each(redundant)('%s is a duplicate or strict prefix of another index (PRAGMA index_info)', (name, table, columns) => {
    expect(indexNames(db, table)).toContain(name);
    expect(coveredElsewhere(table, name, columns)).toBe(true);
  });

  it('drops all of them and keeps the covering indexes', () => {
    runMigrations(db, only('079'));
    for (const [name, table, columns] of redundant) {
      expect(indexNames(db, table)).not.toContain(name);
      expect(coveredElsewhere(table, name, columns)).toBe(true);
    }
  });

  it('keeps the indexes that are NOT redundant', () => {
    runMigrations(db, only('079'));
    expect(indexNames(db, 'ticket_reminders')).toContain('idx_ticket_reminders_sent');
    expect(indexNames(db, 'tickets')).toContain('idx_tickets_status_updated');
  });

  it('a fresh start no longer recreates them (schema.sql does not mention them)', () => {
    const fresh = new Database(':memory:');
    fresh.exec(schema);
    runMigrations(fresh);
    for (const [name, table] of redundant) expect(indexNames(fresh, table)).not.toContain(name);
    fresh.close();
  });
});

describe('migration 080: clear tickets.template_id when a template is deleted', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = bootBefore('081');
    db.prepare("INSERT INTO ticket_templates (id, name, title_template, description_template) VALUES ('tpl', 'Mall', 't', 'd')").run();
    db.prepare("INSERT INTO ticket_templates (id, name, title_template, description_template) VALUES ('keep', 'Annan', 't', 'd')").run();
    db.prepare("INSERT INTO tickets (id, title, description, template_id, updated_at) VALUES ('t1', 'T', 'D', 'tpl', '2026-01-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO tickets (id, title, description, template_id) VALUES ('t2', 'T', 'D', 'keep')").run();
  });
  afterEach(() => db.close());

  const templateOf = (id: string) => (db.prepare('SELECT template_id FROM tickets WHERE id = ?').get(id) as { template_id: string | null }).template_id;

  it('nulls only the tickets that used the deleted template, without bumping updated_at', () => {
    db.prepare("DELETE FROM ticket_templates WHERE id = 'tpl'").run();
    expect(templateOf('t1')).toBeNull();
    expect(templateOf('t2')).toBe('keep');
    expect((db.prepare("SELECT updated_at FROM tickets WHERE id = 't1'").get() as { updated_at: string }).updated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('backfills already-dangling template_id values', () => {
    const pre = bootBefore('080');
    pre.prepare("INSERT INTO tickets (id, title, description, template_id) VALUES ('d', 'T', 'D', 'deleted-long-ago')").run();
    runMigrations(pre, only('080'));
    expect((pre.prepare("SELECT template_id FROM tickets WHERE id = 'd'").get() as { template_id: string | null }).template_id).toBeNull();
    pre.close();
  });

  it('survives the template rebuild order: trigger exists after 075 rebuilt the table', () => {
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'ticket_templates_clear_ticket_template_id'").get()).toBeDefined();
  });
});
