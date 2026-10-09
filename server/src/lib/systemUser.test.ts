import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runMigrations } from '../db/runner.js';
import { SYSTEM_USER_ID, SYSTEM_USER_EMAIL, getSystemUserId } from './systemUser.js';

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../db/schema.sql'), 'utf-8');

describe('system user (migration 084)', () => {
  it('exposes the contract constants', () => {
    expect(SYSTEM_USER_ID).toBe('00000000-0000-4000-8000-000000000001');
    expect(SYSTEM_USER_EMAIL).toBe('system@it-ticket.local');
    expect(getSystemUserId()).toBe(SYSTEM_USER_ID);
  });

  it('exists after migrations as a non-admin user nobody can log in as', () => {
    const db = new Database(':memory:');
    db.exec(schema);
    runMigrations(db);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(getSystemUserId()) as {
      email: string; display_name: string; role: string; password_hash: string; must_change_password: number;
    };
    expect(row).toMatchObject({ email: SYSTEM_USER_EMAIL, display_name: 'System (e-post)', role: 'user' });
    expect(row.password_hash).toMatch(/^\$2[aby]\$10\$/);
    expect(bcrypt.compareSync('', row.password_hash)).toBe(false);
    expect(bcrypt.compareSync('system', row.password_hash)).toBe(false);
    // Ingen admin skapas av migrationen (init.ts letar efter role = 'admin').
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get()).toEqual({ n: 0 });
    db.close();
  });

  it('can own an email comment (FK satisfied) and is created only once', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(schema);
    runMigrations(db);
    runMigrations(db);
    db.prepare("INSERT INTO tickets (id, title, description) VALUES ('t', 'T', 'D')").run();
    expect(() =>
      db.prepare("INSERT INTO ticket_comments (id, ticket_id, user_id, content) VALUES ('c', 't', ?, 'hej')").run(SYSTEM_USER_ID)
    ).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(SYSTEM_USER_ID)).toEqual({ n: 1 });
    db.close();
  });
});
