import { createApp } from './app.js';
import { initializeDatabase, closeDatabase } from './db/connection.js';
import { startReminderScheduler, stopReminderScheduler } from './lib/reminderScheduler.js';
import { cleanupRefreshTokens } from './db/cleanup-refresh-tokens.js';
import { cleanupOldAiUsage } from './lib/aiHelper.js';
import { startAutoCloseScheduler, stopAutoCloseScheduler } from './lib/autoCloseScheduler.js';
import { startRecurringScheduler, stopRecurringScheduler } from './lib/recurringScheduler.js';
import { startWebhookRetryScheduler, stopWebhookRetryScheduler } from './lib/webhookRetryScheduler.js';
import { initWebPush } from './lib/push.js';
import { startPushScheduler, stopPushScheduler } from './lib/pushScheduler.js';
import { startBackupScheduler, stopBackupScheduler } from './lib/backupScheduler.js';
import { startEmailPolling, stopEmailPolling } from './lib/emailInbound.js';
import cron from 'node-cron';
import { logger } from './lib/logger.js';

// Global error handlers — catch unhandled promises and exceptions
// Räkna avvisningar för att varna om de upprepas ovanligt ofta (möjligt läckage).
// Vi dödar ALDRIG processen automatiskt på avvisningar (för riskabelt i prod) —
// vi loggar bara, och eskalerar till en kritisk logg över ett tröskelvärde.
let _unhandledRejectionCount = 0;
const UNHANDLED_REJECTION_WARN_THRESHOLD = 10;
const UNHANDLED_REJECTION_CRITICAL_THRESHOLD = 50;
process.on('unhandledRejection', (reason, _promise) => {
  _unhandledRejectionCount++;
  logger.error('Unhandled promise rejection', { reason: String(reason), total: _unhandledRejectionCount });
  if (_unhandledRejectionCount >= UNHANDLED_REJECTION_CRITICAL_THRESHOLD) {
    logger.error(
      `CRITICAL: unhandled rejections har nått ${_unhandledRejectionCount} — sannolikt löfte-läckage, undersök OMEDELBART (processen dödas INTE automatiskt)`,
      { total: _unhandledRejectionCount, critical: true }
    );
  } else if (_unhandledRejectionCount >= UNHANDLED_REJECTION_WARN_THRESHOLD) {
    logger.warn(
      `Unhandled rejections har nått ${_unhandledRejectionCount} — möjligt löfte-läckage, undersök applikationsloggar`,
      { total: _unhandledRejectionCount }
    );
  }
});

// Nollställ räknaren efter en längre ren period så att enstaka avvisningar
// utspridda över dagar inte ackumuleras till en falsk kritisk varning. Körs
// varje timme; om inga nya avvisningar inträffat sedan förra kollen → reset.
let _lastSeenRejectionCount = 0;
const unhandledRejectionResetTimer = setInterval(() => {
  if (_unhandledRejectionCount > 0 && _unhandledRejectionCount === _lastSeenRejectionCount) {
    logger.info('Unhandled-rejection-räknaren nollställs efter en ren period', {
      previousTotal: _unhandledRejectionCount,
    });
    _unhandledRejectionCount = 0;
  }
  _lastSeenRejectionCount = _unhandledRejectionCount;
}, 60 * 60 * 1000);
unhandledRejectionResetTimer.unref();

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

const PORT = Number(process.env.PORT) || 3001;

// Hur länge vi väntar på att pågående requests + cleanup ska avslutas innan vi
// tvångsavslutar (hard exit). Behåller 10s som default men gör det justerbart.
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000;

// APP_BASE_URL används för att bygga absoluta länkar i utgående mail (t.ex.
// glömt-lösenord). Saknas den blir länkarna trasiga — varna och fall tillbaka
// på CORS_ORIGIN om det finns (icke-fatalt för att inte bryta befintliga deploys).
if (!process.env.APP_BASE_URL) {
  const fallback = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean)[0];
  if (fallback) {
    process.env.APP_BASE_URL = fallback;
    logger.warn('APP_BASE_URL saknas — faller tillbaka på CORS_ORIGIN. Sätt APP_BASE_URL explicit för korrekta mail-länkar.', {
      fallback,
    });
  } else {
    logger.warn('APP_BASE_URL saknas och ingen CORS_ORIGIN att falla tillbaka på — glömt-lösenord-länkar i mail blir trasiga. Sätt APP_BASE_URL.');
  }
}

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
  logger.info(`Server running on port ${PORT}`, { port: PORT });
  logger.info(`API available at http://localhost:${PORT}/api`);

  // Start email-to-ticket polling (non-blocking — logs its own errors)
  startEmailPolling().catch((err) => logger.error('Email polling failed to start', { error: String(err) }));
});

// Graceful shutdown so SQLite WAL checkpoints cleanly on container stop.
// Hanterar BÅDE SIGTERM (container stop / orchestrator) och SIGINT (Ctrl-C) via
// samma logik — en enda handler-funktion, inga duplicerade signal-listeners.
let _shuttingDown = false;
const gracefulShutdown = (signal: string) => {
  // Idempotent — en andra signal under pågående avslut ska inte starta om flödet.
  if (_shuttingDown) return;
  _shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`, { signal });

  // Stoppa e-postpolling och schemaläggare definierade i externa moduler
  stopEmailPolling();
  stopWebhookRetryScheduler();
  stopReminderScheduler();
  stopRecurringScheduler();
  stopAutoCloseScheduler();
  stopPushScheduler();

  // Stoppa inline cron-jobb och timers definierade i denna fil
  refreshTokenCleanupTask.stop();
  aiUsageCleanupTask.stop();
  stopBackupScheduler();
  clearInterval(unhandledRejectionResetTimer);

  server.close(() => {
    try { closeDatabase(); } catch (err) { logger.error('Error closing DB', { error: String(err) }); }
    process.exit(0);
  });
  // Hard exit if cleanup hangs (configurable via SHUTDOWN_TIMEOUT_MS, default 10s)
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
