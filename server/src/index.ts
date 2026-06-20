import { createApp } from './app.js';
import { initializeDatabase } from './db/connection.js';
import { startReminderScheduler } from './lib/reminderScheduler.js';
import { cleanupRefreshTokens } from './db/cleanup-refresh-tokens.js';
import { cleanupOldAiUsage } from './lib/aiHelper.js';
import { startAutoCloseScheduler, stopAutoCloseScheduler } from './lib/autoCloseScheduler.js';
import { startRecurringScheduler, stopRecurringScheduler } from './lib/recurringScheduler.js';
import { startWebhookRetryScheduler } from './lib/webhookRetryScheduler.js';
import { initWebPush } from './lib/push.js';
import { startPushScheduler, stopPushScheduler } from './lib/pushScheduler.js';
import { startBackupScheduler, stopBackupScheduler } from './lib/backupScheduler.js';
import cron from 'node-cron';
import { logger } from './lib/logger.js';

// Global error handlers — catch unhandled promises and exceptions
// Räkna avvisningar för att varna om de upprepas ovanligt ofta (möjligt läckage).
let _unhandledRejectionCount = 0;
const UNHANDLED_REJECTION_WARN_THRESHOLD = 10;
process.on('unhandledRejection', (reason, _promise) => {
  _unhandledRejectionCount++;
  logger.error('Unhandled promise rejection', { reason: String(reason), total: _unhandledRejectionCount });
  if (_unhandledRejectionCount >= UNHANDLED_REJECTION_WARN_THRESHOLD) {
    logger.warn(
      `Unhandled rejections har nått ${_unhandledRejectionCount} — möjligt löfte-läckage, undersök applikationsloggar`,
      { total: _unhandledRejectionCount }
    );
  }
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

import { startEmailPolling } from './lib/emailInbound.js';

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
const refreshTokenCleanupTask = cron.schedule('0 3 * * *', () => {
  try {
    cleanupRefreshTokens();
  } catch (error) {
    logger.error('Error during scheduled refresh token cleanup', { error: String(error) });
  }
});
logger.info('Refresh token cleanup scheduled (daily at 03:00)');

// Daily cleanup of old AI usage logs (older than 90 days) at 03:15
const aiUsageCleanupTask = cron.schedule('15 3 * * *', () => {
  try {
    cleanupOldAiUsage();
  } catch (error) {
    logger.error('Error during scheduled AI usage cleanup', { error: String(error) });
  }
});
logger.info('AI usage log cleanup scheduled (daily at 03:15)');

// Automatisk backup — schema (paus/tid/retention) styrs av backup_config-raden
// (migration 061) och kan redigeras i admin-UI:t. Logik i lib/backupScheduler.ts.
startBackupScheduler();

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

  // Stoppa e-postpolling och schemaläggare definierade i externa moduler
  stopEmailPolling();
  stopWebhookRetryScheduler();
  stopReminderScheduler();
  stopRecurringScheduler();
  stopAutoCloseScheduler();
  stopPushScheduler();

  // Stoppa inline cron-jobb definierade i denna fil
  refreshTokenCleanupTask.stop();
  aiUsageCleanupTask.stop();
  stopBackupScheduler();

  server.close(() => {
    try { closeDatabase(); } catch (err) { logger.error('Error closing DB', { error: String(err) }); }
    process.exit(0);
  });
  // Hard exit if cleanup hangs
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
