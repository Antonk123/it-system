/**
 * Add Knowledge Base Tables Migration
 * Creates tables for kb_categories, kb_articles, ticket_kb_links
 *
 * Run with: npx tsx src/db/add-kb-tables.ts
 */

import { db } from './connection.js';

console.log('📚 Creating Knowledge Base Tables\n');
console.log('='.repeat(60));

try {
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='kb_articles'
  `).get();

  if (tableExists) {
    console.log('⏭️  Tables kb_articles already exists');
    console.log('✅ Migration already applied');
    process.exit(0);
  }

  console.log('Creating kb_categories, kb_articles, ticket_kb_links tables...\n');

  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      position INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kb_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      category_id TEXT REFERENCES kb_categories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_kb_links (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(ticket_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS kb_article_shares (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      share_token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kb_article_shares_token ON kb_article_shares(share_token);
    CREATE INDEX IF NOT EXISTS idx_kb_article_shares_article ON kb_article_shares(article_id);
    CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON kb_articles(category_id);
    CREATE INDEX IF NOT EXISTS idx_kb_articles_updated ON kb_articles(updated_at);
    CREATE INDEX IF NOT EXISTS idx_ticket_kb_links_ticket ON ticket_kb_links(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_kb_links_article ON ticket_kb_links(article_id);
  `);

  console.log('✅ Created table: kb_categories');
  console.log('✅ Created table: kb_articles');
  console.log('✅ Created table: ticket_kb_links');
  console.log('✅ Created indexes');

  console.log('\n🎉 Migration completed successfully!');
  process.exit(0);

} catch (error) {
  console.error('\n❌ Migration failed:');
  if (error instanceof Error) {
    console.error(`   ${error.message}`);
  }
  process.exit(1);
}
