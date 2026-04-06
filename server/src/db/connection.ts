import Database, { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { migrations } from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/database.sqlite');

export const db: DatabaseType = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Enable WAL mode for better concurrency and performance
// WAL mode allows concurrent readers and writers, improving performance
db.pragma('journal_mode = WAL');

// Set synchronous mode to NORMAL for better write performance
// NORMAL is safe for most applications and much faster than FULL
db.pragma('synchronous = NORMAL');

// Increase cache size to 64MB for better performance
db.pragma('cache_size = -64000');

const tableExists = (name: string) => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { name: string } | undefined;
  return !!row;
};

const VALID_TABLE_NAMES = new Set([
  'tickets', 'categories', 'contacts', 'users', 'tags', 'ticket_tags',
  'ticket_templates', 'template_checklists', 'template_fields', 'ticket_field_values',
  'ticket_attachments', 'ticket_comments', 'ticket_history', 'ticket_reminders',
  'ticket_checklists', 'checklist_templates', 'checklist_template_items',
  'kb_articles', 'kb_articles_fts', 'kb_categories', 'kb_article_tags', 'kb_article_links', 'kb_article_shares',
  'recurring_templates', 'recurring_ticket_history', 'filter_views',
  'time_entries',
  'push_subscriptions',
]);

const columnExists = (tableName: string, columnName: string) => {
  if (!VALID_TABLE_NAMES.has(tableName)) {
    throw new Error(`columnExists: unknown table "${tableName}"`);
  }
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
    console.log(`Running migration ${migration.id}: ${migration.name}`);
    migration.up(db, { tableExists, columnExists });
    markApplied.run(migration.id, migration.name, new Date().toISOString());
    console.log(`Migration ${migration.id} applied`);
  }
}

export function initializeDatabase() {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  // schema.sql contains multi-statement DDL — exec handles multiple statements at once
  db.exec(schema);
  runMigrations();
  console.log('Database initialized successfully');
}

export function closeDatabase() {
  db.close();
}
