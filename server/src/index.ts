import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
import passport from './config/passport.js';
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

// Import routes
import authRoutes from './routes/auth.js';
import ticketRoutes from './routes/tickets.js';
import categoryRoutes from './routes/categories.js';
import contactRoutes from './routes/contacts.js';
import attachmentRoutes from './routes/attachments.js';
import checklistRoutes from './routes/checklists.js';
import checklistTemplateRoutes from './routes/checklistTemplates.js';
import commentsRoutes from './routes/comments.js';
import linkRoutes from './routes/links.js';
import shareRoutes from './routes/shares.js';
import userRoutes from './routes/users.js';
import publicRoutes from './routes/public.js';
import templateRoutes from './routes/templates.js';
import tagRoutes from './routes/tags.js';
import kbRoutes from './routes/kb.js';
import reportsRoutes from './routes/reports.js';
import recurringRoutes from './routes/recurring.js';
import timeEntryRoutes from './routes/time-entries.js';
import backupRoutes from './routes/backup.js';
import pushRoutes from './routes/push.js';
import companiesRoutes from './routes/companies.js';
import billingRoutes from './routes/billing.js';
import apiKeyRoutes from './routes/apiKeys.js';
import webhookRoutes from './routes/webhooks.js';
import emailInboundRoutes from './routes/emailInbound.js';
import slaRoutes from './routes/sla.js';
import { startEmailPolling } from './lib/emailInbound.js';
import { uploadBackupOffsite } from './lib/offsiteBackup.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy - CRITICAL for correct IP detection behind nginx reverse proxy
// Without this, req.ip will be the proxy's IP, not the client's IP
// This affects rate limiting and logging.
// One hop: nginx -> express. Trusting 'true' (all hops) lets a misconfigured
// chain spoof X-Forwarded-For and bypass rate limiting.
app.set('trust proxy', 1);

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

// Request ID tracking — allows tracing requests through logs
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] as string || randomUUID();
  res.setHeader('X-Request-ID', requestId);
  (req as any).requestId = requestId;
  next();
});

// Security headers with Helmet
// Protects against common web vulnerabilities
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for React apps
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
}));

// Middleware
// CORS configuration - NEVER use '*' with credentials
// Merge environment CORS_ORIGIN with localhost defaults for dev flexibility
const envOrigins = process.env.CORS_ORIGIN?.split(',').filter(Boolean) || [];
const allowedOrigins = [...envOrigins];

// Only allow localhost origins in non-production environments
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:5173', 'http://localhost:8082');
}

// Deduplicate
const uniqueOrigins = [...new Set(allowedOrigins)];

// Log CORS configuration at startup for debugging
logger.info('CORS configuration loaded', {
  envOrigin: process.env.CORS_ORIGIN || '(not set)',
  allowedOrigins: uniqueOrigins,
  nodeEnv: process.env.NODE_ENV || 'development',
});

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman, curl, health-check scrapers).
    // This is intentional — blocking no-origin requests would break server-side callers and
    // container health checks. Credentials are still protected by JWT + CSRF on all mutating routes.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (uniqueOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked request', { origin, allowedOrigins: uniqueOrigins });
      callback(null, false);
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

// CSRF protection (Double Submit Cookie Pattern via csrf-csrf)
// Protects all state-changing endpoints (POST, PUT, PATCH, DELETE) under /api
// Exempt: /api/auth/login and /api/auth/refresh (authenticate with credentials, not cookies)
if (!process.env.CSRF_SECRET) {
  logger.error('FATAL: CSRF_SECRET must be set (no dev fallback — generate with `openssl rand -hex 64`)');
  process.exit(1);
}

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET!,
  // Use the Authorization header as session identifier so each JWT session gets its own CSRF token
  getSessionIdentifier: (req) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return '';
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      return payload.sub ?? '';
    } catch {
      return '';
    }
  },
  cookieName: 'csrf-token',
  cookieOptions: {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    httpOnly: true,
  },
  getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'] as string,
});

// Paths exempt from CSRF validation
// - /api/auth/* — authenticate by credentials, not session cookies
// - /api/public/* — credentialless endpoints for the unauthenticated public ticket form
const csrfExemptPrefixes = ['/api/auth/login', '/api/auth/refresh', '/api/public/'];

const conditionalCsrf = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (csrfExemptPrefixes.some((p) => req.path === p || req.path.startsWith(p))) return next();
  doubleCsrfProtection(req, res, next);
};

app.use(conditionalCsrf);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Expose CSRF token for SPA — frontend calls this once and caches the token
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/checklists', checklistRoutes);
app.use('/api/checklist-templates', checklistTemplateRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/links', linkRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/users', userRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/kb', kbRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/recurring', recurringRoutes);
app.use('/api/time-entries', timeEntryRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/email-inbound', emailInboundRoutes);
app.use('/api/sla', slaRoutes);

// Error handling
// HttpErrors (from csrf-csrf etc.) carry a .status field — forward it to the client
app.use((err: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 400 && status < 500) {
    // Client errors: forward the error message and optional code (e.g. EBADCSRFTOKEN)
    res.status(status).json({ error: err.message, code: err.code });
  } else {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
