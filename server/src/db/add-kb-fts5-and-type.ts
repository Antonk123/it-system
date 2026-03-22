/**
 * Add KB FTS5 Virtual Table and article_type Column Migration
 * Creates FTS5 virtual table for full-text search, delete trigger, and article_type column
 *
 * Run with: npx tsx src/db/add-kb-fts5-and-type.ts
 */

import { db } from './connection.js';

console.log('Creating KB FTS5 virtual table and article_type column\n');
console.log('='.repeat(60));

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

try {
  // Check if FTS5 virtual table already exists
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='kb_articles_fts'"
  ).get();

  if (!ftsExists) {
    console.log('Creating kb_articles_fts virtual table...');
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts
        USING fts5(title, content_plain, content='', tokenize='unicode61');
    `);
    console.log('  Created kb_articles_fts');
  } else {
    console.log('  kb_articles_fts already exists, skipping CREATE');
  }

  // Create delete trigger (IF NOT EXISTS handles idempotency)
  console.log('Creating delete trigger...');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS kb_articles_fts_delete
      AFTER DELETE ON kb_articles BEGIN
        DELETE FROM kb_articles_fts WHERE rowid = OLD.rowid;
      END;
  `);
  console.log('  kb_articles_fts_delete trigger ready');

  // Add article_type column if it doesn't exist
  const columns = db.prepare('PRAGMA table_info(kb_articles)').all() as { name: string }[];
  const articleTypeExists = columns.some((col) => col.name === 'article_type');

  if (!articleTypeExists) {
    console.log('Adding article_type column to kb_articles...');
    db.exec(`
      ALTER TABLE kb_articles ADD COLUMN article_type TEXT CHECK(article_type IN ('how-to', 'solution'));
    `);
    console.log('  Added article_type column');
  } else {
    console.log('  article_type column already exists, skipping ALTER');
  }

  // Backfill FTS table — skip if already has rows
  const ftsRowCount = (db.prepare('SELECT COUNT(*) as count FROM kb_articles_fts').get() as { count: number }).count;

  if (ftsRowCount === 0) {
    console.log('Backfilling FTS table from existing articles...');
    const articles = db.prepare('SELECT rowid, title, content FROM kb_articles').all() as {
      rowid: number;
      title: string;
      content: string;
    }[];

    if (articles.length > 0) {
      const stmt = db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)');
      const backfill = db.transaction(() => {
        for (const a of articles) {
          stmt.run(a.rowid, a.title, stripHtml(a.content));
        }
      });
      backfill();
      console.log(`  Backfilled ${articles.length} articles into FTS table`);
    } else {
      console.log('  No existing articles to backfill');
    }
  } else {
    console.log(`  FTS table already has ${ftsRowCount} rows, skipping backfill`);
  }

  console.log('\nMigration completed successfully!');
  process.exit(0);

} catch (error) {
  console.error('\nMigration failed:');
  if (error instanceof Error) {
    console.error(`  ${error.message}`);
  }
  process.exit(1);
}
