import Database, { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { migrations } from './migrations.js';
import { logger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/database.sqlite');

export const db: DatabaseType = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Enable WAL mode for better concurrency and performance
// WAL mode allows concurrent readers and writers, improving performance
db.pragma('journal_mode = WAL');

// Wait up to 5s for a held write lock instead of failing immediately with
// SQLITE_BUSY. With WAL + 6 background schedulers + the backup job all writing,
// brief lock contention is expected; without this a busy moment throws
// "database is locked" mid-request. 5000ms covers any realistic single write.
db.pragma('busy_timeout = 5000');

// Set synchronous mode to NORMAL for better write performance
// NORMAL is safe for most applications and much faster than FULL
db.pragma('synchronous = NORMAL');

// Increase cache size to 64MB for better performance
db.pragma('cache_size = -64000');

const tableExists = (name: string) => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { name: string } | undefined;
  return !!row;
};

// SQLite-identifier whitelist regex: bokstäver, siffror, underscore — startar inte med siffra.
// Skyddar PRAGMA table_info(${tableName}) mot injection eftersom det inte går att parametrisera.
const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const columnExists = (tableName: string, columnName: string) => {
  if (!VALID_IDENTIFIER.test(tableName)) {
    throw new Error(`columnExists: invalid table name "${tableName}"`);
  }
  // Returnera false om tabellen inte finns istället för att kasta — migrations kan
  // legitimt kolla columnExists FÖRE tabellen skapas (defensiv idempotent kod).
  if (!tableExists(tableName)) return false;
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return columns.some((column) => column.name === columnName);
};

function createSchemaMigrationsTable(): void {
  db.prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

function runMigrations(): void {
  createSchemaMigrationsTable();

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map(r => r.id)
  );

  const markApplied = db.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    logger.info(`Running migration ${migration.id}: ${migration.name}`);
    try {
      db.transaction(() => {
        migration.up(db, { tableExists, columnExists });
        markApplied.run(migration.id, migration.name, new Date().toISOString());
      })();
    } catch (err) {
      logger.error(`Migration ${migration.id} (${migration.name}) failed`, { error: String(err) });
      throw err; // Stop startup — don't run further migrations on partial state
    }
    logger.info(`Migration ${migration.id} applied`);
  }
}

// Kärntabeller som ALLTID måste finnas efter schema + migrations. Saknas någon
// är databasen i ett inkonsekvent läge (t.ex. avbruten migration) och servern
// ska vägra starta hellre än att köra mot ett trasigt schema.
const REQUIRED_TABLES = ['users', 'tickets'] as const;

function verifySchemaIntegrity(): void {
  const missing = REQUIRED_TABLES.filter((name) => !tableExists(name));
  if (missing.length > 0) {
    logger.error('Schema integrity check failed — required tables missing after migrations', {
      missing,
    });
    throw new Error(
      `Database schema integrity check failed: missing table(s) ${missing.join(', ')}. ` +
        'Schema or migrations did not complete correctly — refusing to start.'
    );
  }
  logger.info('Schema integrity check passed', { verified: REQUIRED_TABLES });
}

export function initializeDatabase() {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  // schema.sql contains multi-statement DDL — exec handles multiple statements at once
  db.exec(schema);
  runMigrations();
  // Fail fast if a core table is missing (catches partial/aborted migrations).
  verifySchemaIntegrity();
  logger.info('Database initialized successfully');
}

export function closeDatabase() {
  db.close();
}
