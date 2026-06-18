# External Integrations

**Analysis Date:** 2026-06-18

## APIs & External Services

**AI / LLM:**
- Anthropic Claude API — four AI features: KB-deflection for end users before ticket creation, reply drafting, ticket summarization, category suggestion
  - SDK: `@anthropic-ai/sdk` ^0.104.2
  - Auth: `ANTHROPIC_API_KEY` env var
  - Implementation: `server/src/lib/aiHelper.ts`
  - Default model: `claude-haiku-4-5-20251001` (configurable via `AI_MODEL` env var)
  - Smart model (draft + summary): configurable via `AI_MODEL_SMART` (e.g., `claude-sonnet-4-6`)
  - Token usage logged to `ai_usage_log` DB table for cost tracking
  - Monthly budget circuit breaker: `AI_MONTHLY_TOKEN_LIMIT` env var (default 5 000 000 tokens)
  - All functions return `null` on error — never blocks core ticket flow

**Microsoft 365 OAuth2 (IMAP):**
- Azure AD / Entra ID — client-credentials OAuth2 flow for accessing a shared mailbox via IMAP
  - SDK: `@azure/msal-node` ^5.2.0 (`ConfidentialClientApplication`)
  - Auth env vars: `IMAP_TENANT_ID`, `IMAP_CLIENT_ID`, `IMAP_CLIENT_SECRET`
  - Scope: `https://outlook.office365.com/.default`
  - Implementation: `server/src/lib/emailInbound.ts` (`getMsalClient()`, `getAccessToken()`)
  - Activation: OAuth2 used automatically when all three MSAL env vars are set; falls back to basic user/pass (`IMAP_PASS`) otherwise

## Data Storage

**Databases:**
- SQLite via `better-sqlite3` ^12.10.0
  - Connection: `server/src/db/connection.ts`
  - Path: `DB_PATH` env var (default `data/database.sqlite` inside the Docker volume)
  - WAL mode enabled, foreign keys enforced, cache 64 MB
  - Schema: `server/src/db/schema.sql`
  - Migrations: `server/src/db/migrations.ts` (applied at startup via `runMigrations()`)
- SQLite FTS5 full-text search (contentless virtual tables, `unicode61` tokenizer):
  - `tickets_fts` — covers title, description, notes, solution (migration 024)
  - `kb_articles_fts` — covers title, content_plain (migration 014)
  - Sync maintained via triggers (migration 050) and explicit updates in routes/lib
  - Query helper: `server/src/lib/ticketQuery.ts`

**File Storage:**
- Local filesystem inside Docker volume (`it-ticketing-data`)
- Upload path: `UPLOAD_DIR` env var (default `data/uploads`)
- Handled by `multer` ^2.1.1 (`server/src/routes/attachments.ts`)
- Allowed types: images, PDF, Office docs, text, ZIP
- Max file size enforced at upload

**Caching:**
- No external cache (Redis/Memcached not used)
- AI suggestion budget check cached in-memory for 5 minutes (`server/src/lib/aiHelper.ts`)
- AI summary result cached in `ai_summary_updated_at` DB column (1-hour TTL)

## Authentication & Identity

**JWT Access Tokens:**
- Library: `jsonwebtoken` ^9.0.2
- Expiry: 15 minutes (`ACCESS_TOKEN_EXPIRY = '15m'` in `server/src/routes/auth.ts`)
- Secret: `JWT_SECRET` env var (mandatory in production)
- Strategy: `passport-jwt` ^4.0.1 via `server/src/config/passport.ts`

**Rolling Refresh Tokens:**
- Cryptographically secure random token (`crypto.randomBytes(32)`)
- Expiry: 7 days, stored in DB table `refresh_tokens`
- Delivered via HttpOnly `refreshToken` cookie, scoped to `/api/auth`, `SameSite=strict`
- DB cleanup: daily cron at 03:00 (`server/src/db/cleanup-refresh-tokens.ts`)
- Implementation: `server/src/routes/auth.ts`

**API Keys:**
- Raw key shown once at creation; stored as SHA-256 hash (`createHash('sha256')` in `server/src/routes/apiKeys.ts`)
- Key prefix (first 8 chars) stored in plaintext for display
- Per-key permission scopes
- Max 10 keys per user

**CSRF Protection:**
- Library: `csrf-csrf` ^4.0.3 (double-submit cookie pattern)
- Secret: `CSRF_SECRET` env var — mandatory, no fallback, `process.exit(1)` on missing (`server/src/index.ts`)
- All mutating frontend calls go through `src/lib/api.ts` which attaches the CSRF token header

**Password Auth:**
- Library: `bcryptjs` ^3.0.3
- Strategy: `passport-local` ^1.0.0 via `server/src/config/passport.ts`
- Password policy enforced: `server/src/lib/passwordPolicy.ts`

## Mail

**Inbound — IMAP Mail-to-Ticket:**
- Library: `imapflow` ^1.4.0
- Parsing: `mailparser` ^3.9.8
- Polling interval: `IMAP_POLL_INTERVAL` env var (default 60 seconds)
- Connection env vars: `IMAP_HOST`, `IMAP_PORT` (default 993), `IMAP_USER`, `IMAP_SECURE` (default true)
- Auth mode A (M365 OAuth2): `IMAP_TENANT_ID` + `IMAP_CLIENT_ID` + `IMAP_CLIENT_SECRET` → access token via MSAL
- Auth mode B (basic): `IMAP_PASS`
- Auto-creates contact from sender if `IMAP_AUTO_CREATE_CONTACT=true`
- Thread detection via `Message-ID` / `In-Reply-To` headers to append replies as comments
- Dispatches `ticket.created` webhook on new ticket
- Sends confirmation email back to requester
- Implementation: `server/src/lib/emailInbound.ts`

**Outbound — SMTP:**
- Library: `nodemailer` ^8.0.11
- Connection env vars: `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`
- From/to: `EMAIL_FROM`, `EMAIL_TO`
- App URL (for links): `APP_BASE_URL`
- TLS: port 465 = `secure: true`, port 587 = `requireTLS: true`
- Events sent: new ticket notification, ticket status change, ticket received confirmation, password reset link, reminders
- Implementation: `server/src/lib/email.ts`

## Push Notifications

**Web Push / VAPID:**
- Library: `web-push` ^3.6.7
- Env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto fallback)
- Gracefully disabled if VAPID keys are not set (logs warning, no crash)
- Public key exposed to frontend via `GET /api/push/vapid-public-key`
- Subscription storage in DB; push scheduler fires at reminder time
- Implementation: `server/src/lib/push.ts`, `server/src/lib/pushScheduler.ts`
- Routes: `server/src/routes/push.ts`

## Webhooks

**Outgoing HMAC-Signed Webhooks:**
- Signing: `createHmac('sha256', secret)` over JSON payload, sent as `X-Webhook-Signature` header (`server/src/lib/webhookDispatcher.ts`)
- Per-webhook secret stored in DB (plaintext HMAC key, not a credential hash)
- Delivery queue with exponential backoff: 1 min → 5 min → 30 min → 2 h → 6 h (max 5 attempts)
- URL validation before each delivery (SSRF protection via `server/src/lib/webhookValidator.ts`)
- Retry scheduler: `server/src/lib/webhookRetryScheduler.ts`
- Management routes: `server/src/routes/webhooks.ts`
- Events dispatched: `ticket.created` (at minimum; others dispatched via `dispatchWebhook()` calls in ticket routes)

## Backup & Off-site Storage

**Local Automated Backup:**
- Daily cron at 04:00 (`server/src/index.ts`)
- ZIP archive via `archiver` ^7.0.1 (database + uploads directory)
- PRAGMA `integrity_check` run before archiving
- Retention: `BACKUP_RETENTION_DAYS` env var (default 7 days)
- Restore endpoint: `POST /api/backup/restore` (unzips via `unzipper` ^0.12.3)

**Off-site Backup (Optional):**
- Triggered after local backup completes
- Command template: `OFFSITE_BACKUP_CMD` env var (e.g., `rclone copy {file} remote:backups/`)
- File path injected via child process environment (`BACKUP_FILE`), never shell-interpolated
- Implementation: `server/src/lib/offsiteBackup.ts`
- No specific cloud SDK bundled — operator provides the tool (rclone, rsync, etc.)

## CI/CD & Deployment

**Hosting:**
- Proxmox server via Docker / Portainer
- Production stack: `it-ticket-system` (Portainer id 39), definition in `docker-compose.yml`
- Dev stack: `it-system-dev` (Portainer id 40), definition in `docker-compose.dev.portainer.yml`

**CI Pipeline:**
- None (manual deploy: `git pull` on server + Docker image rebuild + Portainer redeploy)

## Environment Configuration

**Required env vars (production):**
- `JWT_SECRET` — JWT signing secret
- `CSRF_SECRET` — CSRF double-submit secret (process crashes without this)
- `ADMIN_PASSWORD` — initial admin account password
- `ANTHROPIC_API_KEY` — Anthropic Claude API (optional; AI features disabled if absent)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — web push (optional)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `EMAIL_TO` — outbound mail (optional)
- `IMAP_HOST`, `IMAP_USER` — inbound mail (optional; basic + OAuth2 variants)
- `IMAP_TENANT_ID`, `IMAP_CLIENT_ID`, `IMAP_CLIENT_SECRET` — M365 OAuth2 for IMAP (optional)
- `APP_BASE_URL` — used in email links
- `DB_PATH`, `UPLOAD_DIR` — storage paths
- `OFFSITE_BACKUP_CMD` — off-site backup command (optional)

**Secrets location:**
- Portainer stack environment variables (GUI — not committed to repo)
- Local dev: `docker-compose.local.yml` environment section (not committed with secrets)

---

*Integration audit: 2026-06-18*
