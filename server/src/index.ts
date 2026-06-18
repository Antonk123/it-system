import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';
import { initializeDatabase } from './db/connection.js';
import { db } from './db/connection.js';
import { startReminderScheduler } from './lib/reminderScheduler.js';
import { cleanupRefreshTokens } from './db/cleanup-refresh-tokens.js';
import { cleanupOldAiUsage } from './lib/aiHelper.js';
import { startAutoCloseScheduler } from './lib/autoCloseScheduler.js';
import { startRecurringScheduler } from './lib/recurringScheduler.js';
import { startWebhookRetryScheduler } from './lib/webhookRetryScheduler.js';
import { initWebPush } from './lib/push.js';
import { startPushScheduler } from './lib/pushScheduler.js';
import cron from 'node-cron';
import archiver from 'archiver';
import { logger } from './lib/logger.js';

// ESM saknar __dirname — härled från import.meta.url (samma mönster som db/connection.ts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global error handlers — catch unhandled promises and exceptions
process.on('unhandledRejection', (reason, _promise) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

import { startEmailPolling } from './lib/emailInbound.js';
import { uploadBackupOffsite } from './lib/offsiteBackup.js';

const PORT = process.env.PORT || 3001;

// Initialize database
initializeDatabase();

// Init push notifications (VAPID keys are optional - gracefully disabled if not set)
const pushReady = initWebPush();
if (pushReady) {
  logger.info('Push notifications enabled (VAPID configured)');
  startPushScheduler();
} else {
  logger.info('Push notifications disabled (VAPID keys not set)');
}

// Start reminder scheduler (always enabled - push reminders fire even without SMTP)
startReminderScheduler();
logger.info('Reminder scheduler enabled');

// Daily cleanup of expired/revoked refresh tokens at 03:00
cron.schedule('0 3 * * *', () => {
  try {
    cleanupRefreshTokens();
  } catch (error) {
    logger.error('Error during scheduled refresh token cleanup', { error: String(error) });
  }
});
logger.info('Refresh token cleanup scheduled (daily at 03:00)');

// Daily cleanup of old AI usage logs (older than 90 days) at 03:15
cron.schedule('15 3 * * *', () => {
  try {
    cleanupOldAiUsage();
  } catch (error) {
    logger.error('Error during scheduled AI usage cleanup', { error: String(error) });
  }
});
logger.info('AI usage log cleanup scheduled (daily at 03:15)');

// Daily automatic backup at 04:00 — keeps last BACKUP_RETENTION_DAYS snapshots.
// Each snapshot is a ZIP containing data/database.sqlite + data/uploads, so it can
// be restored directly via POST /api/backup/restore (matches manual-download format).
// Pre-ZIP, PRAGMA integrity_check runs against the snapshot — a corrupted DB never
// reaches retention.
const BACKUP_DB_DEFAULT = path.join(__dirname, '../../data/database.sqlite');
const BACKUP_DIR = path.join(path.dirname(process.env.DB_PATH || BACKUP_DB_DEFAULT), 'backups');
const BACKUP_UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../data/uploads');
const BACKUP_RETENTION_DAYS = Math.max(1, parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10));

cron.schedule('0 4 * * *', async () => {
  const tmpDbPath = path.join(BACKUP_DIR, `tmp-${Date.now()}.sqlite`);
  let tmpDbCreated = false;

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    const backupPath = path.join(BACKUP_DIR, `backup-${dateStr}.zip`);

    // 1. Snapshot DB to tmp file (online backup, WAL-safe)
    await db.backup(tmpDbPath);
    tmpDbCreated = true;

    // 2. Verify snapshot integrity — corrupt files never roll into retention
    const Database = (await import('better-sqlite3')).default;
    const verifyDb = new Database(tmpDbPath, { readonly: true });
    try {
      const result = verifyDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      const passed = result.length === 1 && result[0].integrity_check === 'ok';
      if (!passed) {
        throw new Error(`integrity_check failed: ${JSON.stringify(result)}`);
      }
    } finally {
      verifyDb.close();
    }

    // 3. Bundle DB + uploads into ZIP (same structure as manual download → directly restorable)
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(backupPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      archive.file(tmpDbPath, { name: 'data/database.sqlite' });
      if (fs.existsSync(BACKUP_UPLOAD_DIR)) {
        archive.directory(BACKUP_UPLOAD_DIR, 'data/uploads');
      }
      archive.finalize();
    });

    fs.unlinkSync(tmpDbPath);
    tmpDbCreated = false;
    logger.info('Automatic backup completed', { path: backupPath });

    // 3b. Off-site upload (non-fatal stub — configure via OFFSITE_BACKUP_CMD)
    try {
      await uploadBackupOffsite(backupPath);
    } catch (offSiteErr) {
      logger.error('Off-site backup threw unexpectedly', { error: String(offSiteErr) });
    }

    // 4. Retention — keep newest N, delete older .zip and any legacy .sqlite snapshots
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f: string) => f.startsWith('backup-') && (f.endsWith('.zip') || f.endsWith('.sqlite')))
      .sort()
      .reverse();
    for (const old of files.slice(BACKUP_RETENTION_DAYS)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
      logger.info('Deleted old backup', { file: old });
    }
  } catch (error) {
    if (tmpDbCreated) {
      try { fs.unlinkSync(tmpDbPath); } catch { /* ignore */ }
    }
    logger.error('Automatic backup failed', { error: String(error) });
  }
});
logger.info(`Automatic backup scheduled (daily at 04:00, retain ${BACKUP_RETENTION_DAYS})`);

// Auto-close resolved tickets (daily at 02:30, configurable via AUTO_CLOSE_DAYS env var)
startAutoCloseScheduler();

// Recurring ticket scheduler (every minute)
startRecurringScheduler();

// Webhook retry scheduler (every minute) — re-attempts failed deliveries
// with exponential backoff up to 5 attempts.
startWebhookRetryScheduler();

// Bygg Express-appen (middleware + CSRF + routes + felhanterare) — definierad i
// app.ts utan sidoeffekter så att den kan importeras av tester (supertest).
// Anropas efter DB-init och schemaläggare, samma ordning som tidigare.
const app = createApp();

// Start server
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, { port: Number(PORT) });
  logger.info(`API available at http://localhost:${PORT}/api`);

  // Start email-to-ticket polling (non-blocking — logs its own errors)
  startEmailPolling().catch((err) => logger.error('Email polling failed to start', { error: String(err) }));
});

// Graceful shutdown so SQLite WAL checkpoints cleanly on container stop.
import { stopEmailPolling } from './lib/emailInbound.js';
import { closeDatabase } from './db/connection.js';
import { stopWebhookRetryScheduler } from './lib/webhookRetryScheduler.js';
import { stopReminderScheduler } from './lib/reminderScheduler.js';
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`, { signal });
  stopEmailPolling();
  stopWebhookRetryScheduler();
  stopReminderScheduler();
  server.close(() => {
    try { closeDatabase(); } catch (err) { logger.error('Error closing DB', { error: String(err) }); }
    process.exit(0);
  });
  // Hard exit if cleanup hangs
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
