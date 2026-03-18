/**
 * Add KB Article Shares Migration
 * Creates the kb_article_shares table for public sharing of KB articles
 *
 * Run with: npx tsx src/db/add-kb-shares.ts
 */

import { db } from './connection.js';

console.log('🔗 Creating KB Article Shares Table\n');
console.log('='.repeat(60));

try {
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='kb_article_shares'
  `).get();

  if (tableExists) {
    console.log('⏭️  Table kb_article_shares already exists');
    console.log('✅ Migration already applied');
    process.exit(0);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_article_shares (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      share_token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kb_article_shares_token ON kb_article_shares(share_token);
    CREATE INDEX IF NOT EXISTS idx_kb_article_shares_article ON kb_article_shares(article_id);
  `);

  console.log('✅ Created table: kb_article_shares');
  console.log('✅ Created indexes');
  console.log('\n🎉 Migration completed successfully!');
  process.exit(0);

} catch (error) {
  console.error('\n❌ Migration failed:');
  if (error instanceof Error) console.error(`   ${error.message}`);
  process.exit(1);
}
