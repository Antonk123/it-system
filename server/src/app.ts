import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';
import { randomUUID } from 'crypto';
import passport from './config/passport.js';
import { logger } from './lib/logger.js';

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

/**
 * Bygger Express-appen med all middleware och alla routes — men UTAN sidoeffekter
 * (ingen DB-init, inga schemaläggare, ingen app.listen). Det gör appen importerbar
 * i tester (supertest) utan att starta servern, cron-jobb eller IMAP-polling.
 *
 * index.ts ansvarar för startordningen: initializeDatabase() + schemaläggare körs
 * FÖRE createApp() (samma ordning som tidigare), sedan app.listen().
 */
export function createApp() {
  const app = express();

  // Trust proxy - CRITICAL for correct IP detection behind nginx reverse proxy
  // Without this, req.ip will be the proxy's IP, not the client's IP
  // This affects rate limiting and logging.
  // One hop: nginx -> express. Trusting 'true' (all hops) lets a misconfigured
  // chain spoof X-Forwarded-For and bypass rate limiting.
  app.set('trust proxy', 1);

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

  return app;
}
