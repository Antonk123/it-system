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
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();

  // Wrap in a transaction so the count + both DELETEs are atomic — avoids
  // a race where new tokens inserted between statements skew the count.
  const cleanup = db.transaction(() => {
    const beforeCount = (db.prepare('SELECT COUNT(*) as count FROM refresh_tokens').get() as { count: number }).count;
    const expiredResult = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now);
    const revokedResult = db.prepare('DELETE FROM refresh_tokens WHERE revoked = 1 AND created_at < ?').run(sevenDaysAgoIso);
    return { beforeCount, totalDeleted: expiredResult.changes + revokedResult.changes };
  });

  const { beforeCount, totalDeleted } = cleanup();
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
