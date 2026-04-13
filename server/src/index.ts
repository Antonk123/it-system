import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';
import { initializeDatabase } from './db/connection.js';
import { startReminderScheduler } from './lib/reminderScheduler.js';
import { cleanupRefreshTokens } from './db/cleanup-refresh-tokens.js';
import { startAutoCloseScheduler } from './lib/autoCloseScheduler.js';
import { startRecurringScheduler } from './lib/recurringScheduler.js';
import { initWebPush } from './lib/push.js';
import { startPushScheduler } from './lib/pushScheduler.js';
import cron from 'node-cron';
import passport from './config/passport.js';

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
import slaRoutes from './routes/sla.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy - CRITICAL for correct IP detection behind nginx reverse proxy
// Without this, req.ip will be the proxy's IP, not the client's IP
// This affects rate limiting and logging
app.set('trust proxy', true);

// Initialize database
initializeDatabase();

// Init push notifications (VAPID keys are optional - gracefully disabled if not set)
const pushReady = initWebPush();
if (pushReady) {
  console.log('Push notifications enabled (VAPID configured)');
  startPushScheduler();
} else {
  console.log('Push notifications disabled (VAPID keys not set)');
}

// Start reminder scheduler (always enabled - push reminders fire even without SMTP)
startReminderScheduler();
console.log('Reminder scheduler enabled');

// Daily cleanup of expired/revoked refresh tokens at 03:00
cron.schedule('0 3 * * *', () => {
  try {
    cleanupRefreshTokens();
  } catch (error) {
    console.error('Error during scheduled refresh token cleanup:', error);
  }
});
console.log('✅ Refresh token cleanup scheduled (daily at 03:00)');

// Auto-close resolved tickets (daily at 02:30, configurable via AUTO_CLOSE_DAYS env var)
startAutoCloseScheduler();

// Recurring ticket scheduler (every minute)
startRecurringScheduler();

// Security headers with Helmet
// Protects against common web vulnerabilities
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for React apps
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
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
// Merge environment CORS_ORIGIN with localhost defaults for maximum flexibility
const envOrigins = process.env.CORS_ORIGIN?.split(',').filter(Boolean) || [];
const defaultOrigins = [
  'http://localhost:5173',          // Vite dev server (local)
  'http://localhost:8082',          // Docker frontend (local)
];
// Use Set to deduplicate in case of overlaps
const allowedOrigins = [...new Set([...envOrigins, ...defaultOrigins])];

// Log CORS configuration at startup for debugging
console.log('🔒 CORS Configuration:');
console.log('  Environment CORS_ORIGIN:', process.env.CORS_ORIGIN || '(not set - using defaults)');
console.log('  Allowed Origins:', allowedOrigins.join(', '));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`❌ CORS blocked: Origin '${origin}' not in allowed list.`);
      console.error(`   Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
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
const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || 'csrf-dev-secret-change-in-production',
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

// Paths exempt from CSRF validation (authenticate by credentials, not session cookies)
const csrfExemptPaths = new Set(['/api/auth/login', '/api/auth/refresh']);

const conditionalCsrf = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (csrfExemptPaths.has(req.path)) return next();
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
app.use('/api/sla', slaRoutes);

// Error handling
// HttpErrors (from csrf-csrf etc.) carry a .status field — forward it to the client
app.use((err: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 400 && status < 500) {
    // Client errors: forward the error message and optional code (e.g. EBADCSRFTOKEN)
    res.status(status).json({ error: err.message, code: err.code });
  } else {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
});
