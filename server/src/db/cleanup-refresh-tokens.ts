/**
 * Cleanup Expired Refresh Tokens
 * Removes expired and revoked refresh tokens from database
 *
 * Run with: tsx src/db/cleanup-refresh-tokens.ts
 * Or scheduled automatically via cron in index.ts (daily at 03:00)
 */

import { db } from './connection.js';

export function cleanupRefreshTokens() {
  const now = new Date().toISOString();

  const beforeCount = (db.prepare('SELECT COUNT(*) as count FROM refresh_tokens').get() as { count: number }).count;

  const expiredResult = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const revokedResult = db.prepare('DELETE FROM refresh_tokens WHERE revoked = 1 AND created_at < ?').run(sevenDaysAgo.toISOString());

  const totalDeleted = expiredResult.changes + revokedResult.changes;
  console.log(`🧹 Refresh token cleanup: removed ${totalDeleted} tokens (${beforeCount - totalDeleted} remaining)`);
}

// Allow running as standalone script
if (process.argv[1]?.includes('cleanup-refresh-tokens')) {
  console.log('🧹 Running refresh token cleanup manually...');
  try {
    cleanupRefreshTokens();
    process.exit(0);
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}
