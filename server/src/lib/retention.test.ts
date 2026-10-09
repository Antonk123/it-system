import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runMigrations } from '../db/runner.js';

vi.mock('./kbImages.js', () => ({ cleanupOrphanKbImages: vi.fn(() => 3) }));

import { runRetention } from './retention.js';
import { cleanupOrphanKbImages } from './kbImages.js';

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../db/schema.sql'), 'utf-8');
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const daysAhead = (d: number) => daysAgo(-d);

describe('runRetention', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(schema);
    runMigrations(db);
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('u', 'u@x.se', 'h')").run();
    db.prepare("INSERT INTO tickets (id, title, description) VALUES ('t', 'T', 'D')").run();
    db.prepare("INSERT INTO webhooks (id, url, secret) VALUES ('w', 'https://x.se', 's')").run();
  });
  afterEach(() => {
    db.close();
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
  });

  const ids = (table: string) => (db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: string }[]).map((r) => r.id);

  it('deletes webhook deliveries older than 30 days only', () => {
    const insert = db.prepare("INSERT INTO webhook_deliveries (id, webhook_id, event, payload, created_at) VALUES (?, 'w', 'e', '{}', ?)");
    insert.run('old', daysAgo(31));
    insert.run('recent', daysAgo(29));
    expect(runRetention(db).webhookDeliveries).toBe(1);
    expect(ids('webhook_deliveries')).toEqual(['recent']);
  });

  it('deletes used and expired reset tokens older than a day (any timestamp format), keeps live ones', () => {
    const insert = db.prepare('INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at) VALUES (?, \'u\', ?, ?, ?)');
    insert.run('used-old', 'h1', daysAhead(1), daysAgo(2));
    insert.run('used-old-sqlite-format', 'h2', daysAhead(1), daysAgo(2).replace('T', ' ').slice(0, 19));
    insert.run('expired-old', 'h3', daysAgo(2), null);
    insert.run('used-just-now', 'h4', daysAhead(1), daysAgo(0));
    insert.run('live', 'h5', daysAhead(1), null);
    expect(runRetention(db).passwordResetTokens).toBe(3);
    expect(ids('password_reset_tokens')).toEqual(['live', 'used-just-now']);
  });

  it('deletes ticket shares only 30 days after they expired; never-expiring shares stay', () => {
    const insert = db.prepare("INSERT INTO ticket_shares (id, ticket_id, share_token, expires_at) VALUES (?, 't', ?, ?)");
    insert.run('long-expired', 's1', daysAgo(31));
    insert.run('recently-expired', 's2', daysAgo(5));
    insert.run('active', 's3', daysAhead(5));
    insert.run('no-expiry', 's4', null);
    expect(runRetention(db).ticketShares).toBe(1);
    expect(ids('ticket_shares')).toEqual(['active', 'no-expiry', 'recently-expired']);
  });

  it('deletes audit log rows older than 365 days by default', () => {
    const insert = db.prepare("INSERT INTO audit_log (id, action, entity_type, created_at) VALUES (?, 'a', 'e', ?)");
    insert.run('old', daysAgo(366));
    insert.run('recent', daysAgo(364));
    expect(runRetention(db).auditLog).toBe(1);
    expect(ids('audit_log')).toEqual(['recent']);
  });

  it('honours AUDIT_LOG_RETENTION_DAYS and falls back on garbage', () => {
    const insert = db.prepare("INSERT INTO audit_log (id, action, entity_type, created_at) VALUES (?, 'a', 'e', ?)");
    insert.run('d40', daysAgo(40));
    insert.run('d10', daysAgo(10));
    process.env.AUDIT_LOG_RETENTION_DAYS = '30';
    expect(runRetention(db).auditLog).toBe(1);
    expect(ids('audit_log')).toEqual(['d10']);

    insert.run('d400', daysAgo(400));
    process.env.AUDIT_LOG_RETENTION_DAYS = 'nonsense';
    expect(runRetention(db).auditLog).toBe(1);
    expect(ids('audit_log')).toEqual(['d10']);
  });

  it('includes the orphan KB image sweep and is a no-op on an empty database', () => {
    expect(runRetention(db)).toEqual({
      webhookDeliveries: 0,
      passwordResetTokens: 0,
      ticketShares: 0,
      auditLog: 0,
      orphanKbImages: 3,
    });
    expect(cleanupOrphanKbImages).toHaveBeenCalledWith(db);
  });
});
