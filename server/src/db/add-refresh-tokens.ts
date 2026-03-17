/**
 * Add Refresh Tokens Table Migration
 * Creates table for storing refresh tokens
 *
 * Run with: tsx src/db/add-refresh-tokens.ts
 */

import { db } from './connection.js';

console.log('🔒 Creating Refresh Tokens Table\n');
console.log('=' .repeat(60));

try {
  // Check if table already exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='refresh_tokens'
  `).get();

  if (tableExists) {
    console.log('⏭️  Table refresh_tokens already exists');
    console.log('✅ Migration already applied');
    process.exit(0);
  }

  console.log('Creating refresh_tokens table...\n');

  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT DEFAULT CURRENT_TIMESTAMP,
      revoked INTEGER DEFAULT 0
    );

    -- Index for fast token lookup
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);

    -- Index for user's tokens
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

    -- Index for cleanup (find expired/revoked tokens)
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
  `);

  console.log('✅ Created table: refresh_tokens');
  console.log('✅ Created index: idx_refresh_tokens_token');
  console.log('✅ Created index: idx_refresh_tokens_user');
  console.log('✅ Created index: idx_refresh_tokens_expires');

  console.log('\n' + '='.repeat(60));
  console.log('📊 Table Schema');
  console.log('='.repeat(60));
  console.log('  - id: Unique identifier for refresh token');
  console.log('  - user_id: User who owns this token');
  console.log('  - token: The refresh token (JWT)');
  console.log('  - expires_at: Expiration timestamp');
  console.log('  - created_at: When token was created');
  console.log('  - last_used_at: Last time token was used');
  console.log('  - revoked: Whether token has been manually revoked');

  console.log('\n🎉 Migration completed successfully!');
  process.exit(0);

} catch (error) {
  console.error('\n❌ Migration failed:');
  if (error instanceof Error) {
    console.error(`   ${error.message}`);
  }
  process.exit(1);
}
