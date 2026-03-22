# External Integrations

**Analysis Date:** 2026-03-22

## APIs & External Services

**Supabase (Optional):**
- Auth service - User authentication and password reset
  - SDK/Client: `@supabase/supabase-js` 2.89.0
  - Auth: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` environment variables
  - Location: `src/integrations/supabase/client.ts` (auto-generated, initialized with localStorage session persistence)
  - Usage: `src/pages/ResetPassword.tsx` integrates Supabase auth for password reset flow
  - Status: Optional - system functions without it using local authentication

**Email/SMTP (Optional):**
- Nodemailer integration for ticket notifications and reminders
  - SDK/Client: `nodemailer` 6.10.0
  - Configuration: `server/src/lib/email.ts`
  - Auth: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` environment variables
  - Sender: `EMAIL_FROM` environment variable
  - Recipient: `EMAIL_TO` environment variable (single destination for notifications)
  - TLS: Configured for port 587 (TLS required) and 465 (implicit SSL)
  - Status: Optional - reminders and scheduled emails disabled if SMTP not configured
  - Connected to: Reminder scheduler (`server/src/lib/reminderScheduler.ts`)

## Data Storage

**Databases:**
- SQLite 3 (local file-based)
  - Connection: `server/src/db/connection.ts`
  - Client: `better-sqlite3` 11.7.0 (synchronous driver)
  - Database file: `DB_PATH` environment variable (default: `/app/data/database.sqlite`)
  - Pragmas: WAL mode (write-ahead logging), foreign keys enabled, 64MB cache
  - Runs in production container at `/app/data/database.sqlite` (persistent volume)

**File Storage:**
- Local filesystem uploads
  - Location: `UPLOAD_DIR` environment variable (default: `/app/data/uploads`)
  - Mount point: `/app/data` volume in Docker
  - Limits: 10MB max file size per `server/src/routes/attachments.ts`
  - Allowed types: Images (JPEG, PNG, GIF, WebP), PDFs, Office docs, archives
  - Handled by: `multer` 1.4.5-lts.1 with disk storage backend
  - Naming: Files renamed to prevent path traversal (timestamp + random suffix + original extension)

**Caching:**
- None - no Redis or memcached integration
- Frontend: Workbox service worker with Network-First strategy for `/api/` calls (24 hour cache)
- Browser: LocalStorage for auth tokens and session data

## Authentication & Identity

**Auth Provider:**
- Custom implementation (local authentication)
  - Implementation: Passport.js with LocalStrategy + JwtStrategy
  - Password hashing: `bcryptjs` 2.4.3
  - JWT signing: `jsonwebtoken` 9.0.2
  - Secret: `JWT_SECRET` environment variable (must be set, crashes if missing)
  - Token expiry: Access token 1 hour, Refresh token 7 days
  - Session storage: Refresh tokens stored in SQLite `refresh_tokens` table
  - Flow: Login endpoint (`server/src/routes/auth.ts`) → Access token + Refresh token
  - Refresh: `/auth/refresh` endpoint for expired access tokens (no request to re-authenticate)

**Optional Supabase Auth:**
- Password reset flow in `src/pages/ResetPassword.tsx`
- Used only for password recovery, not primary authentication
- Does not integrate with main login system

**Rate Limiting:**
- Login endpoint: 5 attempts per 15 minutes via `express-rate-limit`
- Implemented in `server/src/middleware/rateLimit.ts`
- IP detection: Uses `trust proxy` setting for correct client IP behind nginx

## Security & CSRF

**CSRF Protection:**
- Library: `csrf-csrf` 4.0.3
- Server-side token generation and validation
- Tokens include in request headers for stateless verification
- Applied to state-changing endpoints (POST, PUT, DELETE)
- Token not found in code - verify implementation in routes

**Security Headers:**
- Helmet.js 8.1.0 for HTTP security headers
- CSP directives:
  - defaultSrc: 'self'
  - styleSrc: 'self', 'unsafe-inline' (for inline React styles)
  - scriptSrc: 'self'
  - imgSrc: 'self', data:, https:
  - connectSrc: 'self'
  - frameFrame: 'none' (blocks framing)
- HSTS: 1 year max-age with preload
- X-Content-Type-Options: nosniff
- X-XSS-Protection enabled
- Powered-By header hidden

**CORS Configuration:**
- Environment variable: `CORS_ORIGIN` (comma-separated list)
- Default origins (development):
  - `http://localhost:5173` (Vite dev server)
  - `http://localhost:8082` (Docker frontend)
- Middleware: `cors` 2.8.5 with `credentials: true` for cookies
- Never uses wildcard '*' with credentials
- Applied at `server/src/index.ts` line 88-96

## Monitoring & Observability

**Error Tracking:**
- None detected - no Sentry, Rollbar, or similar integration

**Logs:**
- Console logging only (`console.log`, `console.error`)
- Docker compose logging driver: JSON file with 10MB max size, 3 file rotation
- Server startup logs: Database initialization, scheduler status, CORS config
- Error logs: Database errors, email failures, auth failures

**Performance Metrics:**
- None - no New Relic, Datadog, or APM integration

## CI/CD & Deployment

**Hosting:**
- Docker Compose (self-hosted)
- Development: `docker-compose.local.yml` with configurable ports and env vars
- Production: `docker-compose.yml` with hardcoded ports (backend 3002→3001, frontend 8082→80)

**CI Pipeline:**
- None detected - no GitHub Actions, GitLab CI, or similar

**Deployment Process:**
- Manual via Docker:
  1. Build images: `docker build -t it-ticketing-backend:latest -f Dockerfile.server .`
  2. Deploy via Portainer UI or `docker restart it-ticketing-backend`
  3. Database migrated via scripts in `server/src/db/` (manual execution required)

## Environment Configuration

**Required env vars (Backend):**
- `JWT_SECRET` - Cryptographic secret for signing JWTs (MUST be set, app crashes without it)

**Optional env vars (Backend):**
- `NODE_ENV` - Set to `production` to disable development features
- `DB_PATH` - SQLite database file path (default: `/app/data/database.sqlite`)
- `UPLOAD_DIR` - File upload directory (default: `/app/data/uploads`)
- `CORS_ORIGIN` - Comma-separated list of allowed origins (merged with localhost defaults)
- `APP_BASE_URL` - Base URL for email links (e.g., `https://tickets.company.com`)
- `PORT` - Server port (default: 3001)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` - Email server credentials (all required if SMTP enabled)
- `EMAIL_FROM`, `EMAIL_TO` - Email addresses for notifications (required if SMTP enabled)

**Secrets location:**
- Docker: Environment variables passed via `docker-compose.yml` or `.env` file (Git-ignored)
- Local: Set via `.env` file (never committed)
- Vault: Not implemented

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- Email notifications via SMTP (not webhooks, but asynchronous outbound)
- Scheduled reminders via `node-cron` 3.0.3 and 4.2.1
  - Reminder scheduler: `server/src/lib/reminderScheduler.ts` (runs every 5 minutes)
  - Auto-close scheduler: `server/src/lib/autoCloseScheduler.ts` (runs daily at 02:30)
  - Refresh token cleanup: Cron job daily at 03:00

## API Communication

**Frontend to Backend:**
- HTTP over `/api` proxy (vite.config.ts line 13-17)
- Port: 3001 (internal Docker network)
- Proxy target: `http://it-ticketing-backend-dev:3001` (development)
- Actual runtime: `http://it-ticketing-backend:3001` (production via nginx)

**Nginx Reverse Proxy:**
- Location: Runs in frontend container, proxies `/api/` requests to backend
- Configuration: `nginx.conf` with priority prefix match for API routes
- Headers: X-Real-IP, X-Forwarded-For, X-Forwarded-Proto set for client tracking
- Upgrade: WebSocket upgrade headers configured (for potential future upgrades)

## Data Export/Integration

**None detected** - no CSV export, API webhooks, or third-party sync

## Third-Party JavaScript

**Workbox (Service Worker):**
- Library: `workbox-window` 7.0.0 (PWA support)
- Cache strategy: Network-First for API calls (24 hour max age)
- File cache: Browser caches JS, CSS, images, fonts for offline support
- Max cached file size: 3MB per file

---

*Integration audit: 2026-03-22*
