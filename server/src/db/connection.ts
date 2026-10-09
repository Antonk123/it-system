import Database, { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runMigrations, tableExists as tableExistsIn } from './runner.js';
import { checkFtsDrift } from '../lib/fts.js';
import { logger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/database.sqlite');
// Samma katalog som backupScheduler.ts använder (DB-filens katalog + /backups).
const BACKUP_DIR = join(dirname(DB_PATH), 'backups');

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

// Håll WAL-filen under 64MB efter checkpoint (default är obegränsad och filen
// krymper aldrig efter en stor skrivning). wal_autocheckpoint lämnas på default.
db.pragma('journal_size_limit = 67108864');

const tableExists = (name: string) => tableExistsIn(db, name);

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

// FTS-tabellerna är contentless och synkas av triggers resp. routes/kb.ts — driften
// syns bara som radantal som skiljer sig. Varnar, bygger aldrig om automatiskt.
function warnOnFtsDrift(): void {
  const drift = checkFtsDrift(db);
  if (drift.tickets.rows !== drift.tickets.fts || drift.kbArticles.rows !== drift.kbArticles.fts) {
    logger.warn('FTS index out of sync with source tables — rebuild with rebuildFts()', { drift });
  }
}

export function initializeDatabase() {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  // schema.sql contains multi-statement DDL — exec handles multiple statements at once
  db.exec(schema);
  runMigrations(db, undefined, { snapshotDir: BACKUP_DIR });
  // Fail fast if a core table is missing (catches partial/aborted migrations).
  verifySchemaIntegrity();
  warnOnFtsDrift();
  logger.info('Database initialized successfully');
}

export function closeDatabase() {
  db.close();
}
