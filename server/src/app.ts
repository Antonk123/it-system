import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { doubleCsrf } from 'csrf-csrf';
import { randomUUID, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { MulterError } from 'multer';
import passport from './config/passport.js';
import { logger } from './lib/logger.js';
import { cookieSecure } from './config/cookies.js';
import { validateSecret } from './config/secretValidation.js';
import { isApiKeyRequest } from './middleware/auth.js';
import { createWriteRateLimiter } from './middleware/rateLimit.js';
import { db } from './db/connection.js';

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
import backupRoutes from './routes/backup.js';
import pushRoutes from './routes/push.js';
import companiesRoutes from './routes/companies.js';
import apiKeyRoutes from './routes/apiKeys.js';
import webhookRoutes from './routes/webhooks.js';
import emailInboundRoutes from './routes/emailInbound.js';
import settingsRoutes from './routes/settings.js';
import architectureMapRoutes from './routes/architectureMap.js';

declare global {
  namespace Express {
    interface Request {
      // Korrelations-id för loggar och 5xx-svar (X-Request-ID eller genererat).
      id?: string;
    }
  }
}

const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Egna begränsare finns redan för dessa (login/refresh/… resp. publika formulär).
const WRITE_LIMIT_EXEMPT_PREFIXES = ['/auth/', '/public/'];

// Nyckel för skrivbegränsaren: API-nyckelns id eller (verifierat) användar-id ur JWT.
// authenticate körs per route och har inte hunnit sätta req.user här, så identiteten
// härleds på nytt — okända/ogiltiga uppgifter faller tillbaka på IP.
function writeLimitKey(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const raw = header.slice('Bearer '.length);
  if (isApiKeyRequest(req)) {
    const keyHash = createHash('sha256').update(raw).digest('hex');
    const row = db.prepare('SELECT id FROM api_keys WHERE key_hash = ?').get(keyHash) as { id: string } | undefined;
    return row ? `key:${row.id}` : undefined;
  }
  try {
    const payload = jwt.verify(raw, process.env.JWT_SECRET!, { algorithms: ['HS256'] });
    const sub = typeof payload === 'object' ? payload.sub : undefined;
    return sub ? `user:${sub}` : undefined;
  } catch {
    return undefined;
  }
}

// Webbläsare skickar Sec-Fetch-Site på alla anrop och JS kan inte förfalska den.
// Saknas headern (curl, serversidan, äldre webbläsare) görs ingen kontroll.
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);
function requireSameOriginFetch(req: express.Request, res: express.Response, next: express.NextFunction) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && !ALLOWED_FETCH_SITES.has(String(site))) {
    logger.warn('Blocked cross-site cookie-authenticated request', { path: req.path, site });
    return res.status(403).json({ error: 'Förfrågan nekades' });
  }
  next();
}

const CACHEABLE_API_PATH = /^\/(?:public\/branding\/logo|kb\/images\/[^/]+)$/;

function isMulterError(err: unknown): err is MulterError {
  return err instanceof Error && err.name === 'MulterError';
}

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
  // Inkommande id:n valideras — annars hamnar godtycklig klientdata i svarshuvud och loggar.
  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-ID', requestId);
    req.id = requestId;
    next();
  });

  // nginx sätter ingen Cache-Control för /api/ — utan den här kan svar (ärenden,
  // bilagor, tokens) heuristiskt cachas i webbläsare och mellanlager. Allt under /api
  // är no-store utom det avsiktligt publika: varumärkeslogotypen och KB-bilderna, som
  // sätter/får sin egen policy. Routes som själva sätter Cache-Control skriver över,
  // och res.sendFile respekterar en redan satt header.
  app.use('/api', (req, res, next) => {
    if (!CACHEABLE_API_PATH.test(req.path)) res.setHeader('Cache-Control', 'no-store');
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
  // Express 5 lämnar req.body undefined utan body — destrukturering i routes skulle ge 500.
  app.use((req, _res, next) => {
    req.body ??= {};
    next();
  });
  app.use(cookieParser());
  app.use(passport.initialize());

  // CSRF protection (Double Submit Cookie Pattern via csrf-csrf)
  // Protects all state-changing endpoints (POST, PUT, PATCH, DELETE) under /api
  // Exempt: /api/auth/login and /api/auth/refresh (authenticate with credentials, not cookies)
  // Validation logic lives in secretValidation.ts (pure, unit-tested) — this
  // block just wires the result to logging + process.exit for CSRF_SECRET.
  const csrfSecretResult = validateSecret('CSRF_SECRET', process.env.CSRF_SECRET, process.env);
  if (!csrfSecretResult.ok) {
    logger.error(`FATAL: ${csrfSecretResult.reason} Generate with \`openssl rand -hex 64\`.`);
    process.exit(1);
  }
  if (csrfSecretResult.warning) {
    logger.warn(csrfSecretResult.warning);
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
      secure: cookieSecure(),
      path: '/',
      httpOnly: true,
    },
    getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'] as string,
  });

  // Paths exempt from CSRF validation
  // - /api/auth/* — authenticate by credentials, not session cookies
  // - /api/public/* — credentialless endpoints for the unauthenticated public ticket form
  // - /api/auth/refresh och /api/auth/logout autentiseras av refresh-cookien (SameSite=strict)
  //   och saknar CSRF-token — logout kräver ingen access-token, så en utgången ska inte hindra
  //   utloggning. Som försvar på djupet nekas de när webbläsaren själv uppger att anropet inte
  //   är same-origin (Sec-Fetch-Site; se requireSameOriginFetch). Klienter utan headern släpps.
  const csrfExemptPrefixes = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/public/'];

  const conditionalCsrf = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // API-nyckel-requests (Authorization: Bearer itk_live_…) autentiseras
    // kryptografiskt av nyckeln, inte av en session-cookie. CSRF (double-submit-
    // cookie) skyddar bara mot cookie-ridning — en angripare kan inte få offrets
    // webbläsare att sätta en custom Authorization-header med offrets nyckel, så
    // CSRF är irrelevant för bearer-token-auth. Därför hoppar vi över CSRF för
    // dessa: de bär ingen ambient cookie-autentisering att rida på. Utan detta
    // undantag blockeras ALLA skrivanrop med API-nyckel av CSRF (EBADCSRFTOKEN)
    // → `write`-scopen blir död.
    // (En ogiltig itk_live_-nyckel avvisas ändå av authenticate med 401.)
    if (isApiKeyRequest(req)) {
      logger.debug('CSRF bypassed for API-key request (authenticated via key, not cookie)', {
        method: req.method,
        path: req.path,
      });
      return next();
    }
    if (csrfExemptPrefixes.some((p) => req.path === p || req.path.startsWith(p))) return next();
    doubleCsrfProtection(req, res, next);
  };

  app.use(conditionalCsrf);
  app.post(['/api/auth/refresh', '/api/auth/logout'], requireSameOriginFetch);

  // Skrivbegränsning för alla muterande /api-anrop (300 per 5 min och användare/nyckel).
  // Efter CSRF så att avvisade anrop inte räknas.
  const writeLimiter = createWriteRateLimiter(writeLimitKey);
  app.use('/api', (req, res, next) => {
    if (!WRITE_METHODS.has(req.method) || WRITE_LIMIT_EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) {
      return next();
    }
    writeLimiter(req, res, next);
  });

  // Health check — verifies the process is up AND the DB is reachable. A trivial
  // `SELECT 1` proves the SQLite handle responds; on failure we return 503 so
  // orchestrators/load-balancers can stop routing to an unhealthy instance.
  // Happy path keeps the existing 200 { status: 'ok', timestamp } shape.
  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (err) {
      logger.error('Health check failed — DB not reachable', { error: String(err) });
      res.status(503).json({ status: 'error', timestamp: new Date().toISOString() });
    }
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
  app.use('/api/backup', backupRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/companies', companiesRoutes);
  app.use('/api/api-keys', apiKeyRoutes);
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/email-inbound', emailInboundRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/architecture-map', architectureMapRoutes);

  // Catch-all for unknown /api/* routes — without this, Express falls back to
  // its built-in HTML 404 page ("Cannot GET /api/xyz") instead of the API's
  // JSON error shape. Bad for external API-key integrations that expect JSON.
  // Must sit AFTER all /api/... mounts above (so real routes still match) and
  // BEFORE the error middleware below (so it never reaches there).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handling
  // HttpErrors (from csrf-csrf etc.) carry a .status field — forward it to the client
  app.use((err: Error & { status?: number; code?: string }, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);

    // Multer-fel (för stor fil, oväntat fält …) är klientfel även när routen glömt fånga dem.
    if (isMulterError(err)) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? 'Filen är för stor' : 'Ogiltig filuppladdning',
        code: err.code,
      });
    }

    const status = err.status ?? 500;
    if (status >= 400 && status < 500) {
      // Client errors: forward the error message and optional code (e.g. EBADCSRFTOKEN)
      res.status(status).json({ error: err.message, code: err.code });
    } else {
      logger.error('Unhandled error', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        error: err.message,
        stack: err.stack,
      });
      res.status(500).json({ error: 'Internal server error', requestId: req.id });
    }
  });

  return app;
}
