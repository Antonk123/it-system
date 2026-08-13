import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const schemaPath = join(__dirname, 'schema.sql');

/**
 * Regression: prod crash 2026-07-05 — "SqliteError: no such column: oidc_sub"
 * crash-loop after the first deploy that shipped the OIDC schema.
 *
 * initializeDatabase() runs `db.exec(schema.sql)` BEFORE runMigrations(). So
 * schema.sql must be safe to exec against an OLDER, already-populated DB whose
 * base tables predate columns that later migrations add. `CREATE TABLE IF NOT
 * EXISTS` is a no-op on an existing table, so a
 * `CREATE INDEX ... ON <existing_table>(<migration_added_column>)` line in
 * schema.sql references a column that isn't there yet → exec throws → the
 * process crash-loops before runMigrations() (which would add the column) ever
 * runs. Indexes on retrofitted columns must therefore live ONLY in a migration,
 * never in the base schema.sql. The OIDC identity index is the live example:
 * migration 065 first created idx_users_oidc_sub, and migration 068 took over
 * ownership — it drops that index and creates idx_users_oidc_identity on the
 * (oidc_iss, oidc_sub) pair instead. Both columns are retrofitted, so the index
 * stays in 068 and out of schema.sql.
 */
describe('schema.sql is forward-compatible with an older populated DB', () => {
  it('exec()s cleanly when the users table predates the oidc_sub column', () => {
    const db = new Database(':memory:');
    // Simulate a pre-OIDC prod DB: a users table without oidc_sub.
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_login TEXT
      );
    `);

    const schema = readFileSync(schemaPath, 'utf-8');
    // Must NOT throw "no such column: oidc_sub" — mirrors the exact prod boot.
    expect(() => db.exec(schema)).not.toThrow();

    db.close();
  });
});
