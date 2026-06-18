# Architecture

**Analysis Date:** 2026-06-18

## Pattern Overview

**Overall:** Monorepo with a React SPA frontend and an Express REST API backend, connected over HTTP. No shared code between the two halves — frontend types are duplicated from backend types by convention.

**Key Characteristics:**
- Strict app/boot split on the backend: `server/src/app.ts` is a pure `createApp()` factory (no side-effects), `server/src/index.ts` owns DB init, schedulers, and `app.listen()`.
- Frontend uses a hooks-as-data-layer pattern: all server I/O flows through `@tanstack/react-query` hooks in `src/hooks/`, which delegate to the single `ApiClient` in `src/lib/api.ts`.
- SQLite is the only data store — no Redis, no secondary DB, no ORM. All queries are raw better-sqlite3 prepared statements.
- Background work runs as in-process cron schedulers (node-cron) launched in `server/src/index.ts`.

## Layers

**Backend — Boot layer:**
- Purpose: Start the process, initialise DB, wire schedulers, call `createApp()`, then `listen()`.
- Location: `server/src/index.ts`
- Contains: `initializeDatabase()`, all `cron.schedule()` calls, graceful-shutdown handlers, VAPID/email init.
- Depends on: `server/src/app.ts`, `server/src/db/connection.ts`, every `lib/*Scheduler.ts`.
- Used by: Nothing (process entry point).

**Backend — App factory:**
- Purpose: Construct and configure the Express app with all middleware, CSRF, and routes — importable without side-effects for use in supertest.
- Location: `server/src/app.ts`
- Contains: `createApp()` — Helmet, CORS, JSON body parser, cookie-parser, Passport init, conditional CSRF middleware, health/csrf-token endpoints, all 26 `app.use('/api/…')` route mounts, global error handler.
- Depends on: `server/src/routes/*.ts`, `server/src/config/passport.ts`, `server/src/lib/logger.ts`.
- Used by: `server/src/index.ts`, test files via supertest.

**Backend — Route handlers (27 files):**
- Purpose: HTTP endpoint definitions grouped by domain resource. Each file exports a Router.
- Location: `server/src/routes/`
- Contains: Request validation, DB queries via `db` singleton, calls to lib helpers.
- Note: `server/src/routes/template-fields.ts` is mounted as a nested router inside `server/src/routes/templates.ts` (`router.use('/:templateId/fields', templateFieldsRouter)`), not directly in `app.ts`. The remaining 26 routers are mounted in `createApp()`.
- Depends on: `server/src/db/connection.ts`, `server/src/middleware/auth.ts`, lib helpers.
- Used by: `server/src/app.ts`.

**Backend — Middleware:**
- Purpose: Authentication (JWT + API key) and rate limiting.
- Location: `server/src/middleware/`
- Files: `auth.ts` — `authenticate`, `requireAdmin`, `getUser`; `rateLimit.ts` — `createRateLimiter`, pre-built `loginRateLimiter`, `writeRateLimiter`, `publicWriteRateLimiter`, `publicAiRateLimiter`.
- Auth strategy: API-key check runs first (`Bearer itk_live_…` prefix); if absent or invalid, falls through to Passport JWT strategy.
- Depends on: `server/src/db/connection.ts`, `server/src/lib/logger.ts`.

**Backend — Domain helpers (lib/):**
- Purpose: Reusable business logic called from route handlers. Each file is narrowly scoped.
- Location: `server/src/lib/`
- Key files:
  - `aiHelper.ts` — four AI features (KB deflection, category suggestion, reply draft, ticket summary) via Anthropic SDK. Lazy-initialised; all functions return `null` on failure so core flows are never blocked. Usage logged to `ai_usage_log` table for cost tracking. Monthly token-budget circuit breaker (configurable via `AI_MONTHLY_TOKEN_LIMIT`).
  - `ticketQuery.ts` — `buildWhereClause`, `buildOrderByClause`, `validatePaginationParams` — extracted from `tickets.ts` to keep the route file navigable.
  - `slaHelper.ts` — `applySLAToTicket`, `handleSLAStatusChange`, `recalculateSLAOnPriorityChange`.
  - `automationHelper.ts` — `applyAutoTags`, `detectAutoPriority`.
  - `auditLog.ts` — `logAudit` fire-and-forget helper writing to `audit_log` table.
  - `webhookDispatcher.ts` — HMAC-signed outbound delivery with exponential-backoff retry queue (up to 5 attempts).
  - `emailInbound.ts` — IMAP polling (ImapFlow) with M365 OAuth2 (`@azure/msal-node`) or basic-auth, converts emails to tickets.
  - `email.ts` — outbound SMTP notifications.
  - `logger.ts` — structured JSON logger (`{timestamp, level, message, ...meta}`) output to stdout/stderr. Custom implementation (not a third-party library). Imported throughout the codebase.
  - `push.ts` + `pushScheduler.ts` — Web Push (VAPID) for PWA notifications.
  - `htmlSanitizer.ts`, `htmlUtils.ts` — sanitise user-supplied HTML before DB storage.
  - `passwordPolicy.ts` — password strength validation.
  - `offsiteBackup.ts` — configurable off-site backup stub (driven by `OFFSITE_BACKUP_CMD` env var).
- Depends on: `server/src/db/connection.ts`, `server/src/lib/logger.ts`.

**Backend — Database layer:**
- Purpose: Schema bootstrap, migration runner, raw DB singleton.
- Location: `server/src/db/`
- Files:
  - `connection.ts` — exports `db: DatabaseType` (module-level singleton), `initializeDatabase()` (runs `schema.sql` then `runMigrations()`), `closeDatabase()`. WAL mode + `foreign_keys = ON` set at init.
  - `schema.sql` — 17 base tables (tickets, users, contacts, categories, kb_articles, kb_categories, kb_article_shares, ticket_attachments, ticket_checklists, ticket_comments, ticket_shares, ticket_links, tags, ticket_tags, ticket_reminders, refresh_tokens, ticket_kb_links).
  - `migrations.ts` — 59 migrations (ids `001`–`059`) in a single exported `migrations: Migration[]` array. `runMigrations()` in `connection.ts` iterates the array and records applied migrations in `schema_migrations`. Each migration runs in a transaction.
  - `cleanup-refresh-tokens.ts` — standalone helper called by cron.
- Depends on: nothing (foundational layer).

**Backend — Schedulers:**
- Purpose: Periodic background tasks, all started in `server/src/index.ts`.
- Location: `server/src/lib/`
- Files: `reminderScheduler.ts`, `autoCloseScheduler.ts`, `recurringScheduler.ts`, `webhookRetryScheduler.ts`, `pushScheduler.ts`.
- Patterns: Most use `node-cron`; email polling uses a custom interval loop via `ImapFlow`.

**Frontend — Pages:**
- Purpose: Top-level route components. Each maps to a URL in `src/App.tsx`.
- Location: `src/pages/`
- Contains: 23 page components + `src/pages/settings/` (4 tab components: AdminTab, GeneralTab, IntegrationsTab, TicketsTab).
- Pattern: Pages compose hooks + components; they do not call `api.*` directly.

**Frontend — Hooks (data layer):**
- Purpose: All server communication. Each hook wraps `useQuery`/`useMutation` from `@tanstack/react-query` and calls `api.request()`.
- Location: `src/hooks/`
- Contains: 34+ hook files (`useTickets.ts`, `useKbArticles.ts`, `useSLAPolicies.ts`, `useDashboardOverview.ts`, etc.).
- Key pattern: Query keys are co-located as exported const objects (e.g. `ticketKeys`) to enable targeted cache invalidation.

**Frontend — ApiClient:**
- Purpose: Single point of egress. Handles JWT attachment, CSRF token lazy-fetch and caching, 401 → refresh-token retry.
- Location: `src/lib/api.ts`
- Exports: `api` singleton, `ApiClient` class, `PaginatedResponse<T>`, `AuthUser`.
- Enforced: ESLint `no-restricted-syntax` blocks raw `fetch('/api/…')` calls project-wide.

**Frontend — Components:**
- Purpose: Reusable UI. Two sub-levels: domain components and primitive shadcn/ui components.
- Location: `src/components/` (66 domain components) + `src/components/ui/` (27 shadcn/ui primitives).
- Notable: `CommandPalette.tsx`, `KanbanView.tsx`, `UnifiedFilterBar.tsx`, `QuickCaptureFAB.tsx`.

**Frontend — Context:**
- Purpose: Auth state shared across the tree.
- Location: `src/contexts/AuthContext.tsx`
- Exports: `AuthProvider`, `useAuth`. Stores `AuthUser | null`, exposes `signIn`, `signOut`.

## Data Flow

**Authenticated browser request:**
1. Component calls a `src/hooks/use*.ts` hook.
2. Hook invokes `api.request(method, path, body)` in `src/lib/api.ts`.
3. `ApiClient` attaches `Authorization: Bearer <jwt>` and, for mutating methods, `x-csrf-token` header.
4. Express receives request → CORS → Helmet → JSON parser → `authenticate` middleware.
5. `authenticate` tries API-key auth first (`Bearer itk_live_…`); on `no_key`, falls through to Passport JWT strategy.
6. Route handler validates input, queries SQLite via `db` prepared statements, calls lib helpers.
7. Response JSON flows back; React Query updates cache and triggers re-render.

**Email → ticket ingest:**
1. `emailInbound.ts` polls IMAP on configurable interval (default 60 s).
2. M365 OAuth2 or basic-auth; `simpleParser` parses raw message.
3. Contact looked up/created; ticket row inserted; `dispatchWebhook` fires `ticket.created` event; confirmation email sent via `email.ts`.

**AI deflection (public portal):**
1. Visitor types problem description on `/submit-ticket`.
2. Frontend calls `POST /api/public/ai-suggest` (no auth, rate-limited at 10/min via `publicAiRateLimiter`).
3. `aiHelper.suggestSolutionFromKB` embeds search terms, queries `kb_articles` with FTS5, builds conservative Claude prompt, returns suggestion or `null`.
4. If suggestion shown and accepted, no ticket is created; otherwise visitor submits ticket normally.

**Scheduled backup:**
1. `cron.schedule('0 4 * * *', …)` in `server/src/index.ts` fires at 04:00.
2. `db.backup(tmpPath)` creates WAL-safe snapshot; `PRAGMA integrity_check` verifies it.
3. ZIP bundles `data/database.sqlite` + `data/uploads/`; stored in `data/backups/`.
4. Optional off-site upload via `offsiteBackup.ts`. Retention window enforced (default 7 days, env `BACKUP_RETENTION_DAYS`).

**State Management:**
- Server state: `@tanstack/react-query` cache — all mutations call `queryClient.invalidateQueries` on success.
- UI state: `useState`/`useReducer` local to components.
- Auth: `AuthContext` (React Context).
- No Redux, Zustand, or global state library.

## Key Abstractions

**Migration:**
- Purpose: Incremental DB schema change, idempotent (guards via `tableExists`/`columnExists` helpers).
- Examples: `server/src/db/migrations.ts` (ids `001`–`059`).
- Pattern: Each migration is `{ id: string, name: string, up(db, helpers): void }`. New migrations appended at the end of the array; never inserted mid-array.

**ApiClient:**
- Purpose: CSRF + auth-token lifecycle management for all frontend→backend calls.
- Location: `src/lib/api.ts`.
- Pattern: `api.request<T>(method, path, body?)` is the sole public surface for data-mutating calls; GET helpers are named wrapper methods on the same class.

**Query key factories:**
- Purpose: Structured cache invalidation in React Query.
- Examples: `ticketKeys` in `src/hooks/useTickets.ts`; similar pattern in all hook files.
- Pattern: `{ all, lists, list(filters), details, detail(id) }` hierarchy; invalidate by parent key to bust related queries.

**Route factory (Express):**
- Purpose: Each route file creates its own `Router` and exports it as default; mounted in `createApp()`.
- Examples: `server/src/routes/tickets.ts`, `server/src/routes/kb.ts`.
- Pattern: `const router = Router()` at top, `export default router` at bottom.

## Entry Points

**Backend process:**
- Location: `server/src/index.ts`
- Triggers: `node` / `tsx` process start (Docker `CMD`).
- Responsibilities: DB init → scheduler start → `createApp()` → `app.listen(PORT)` → email polling start.

**Express app factory:**
- Location: `server/src/app.ts` — `export function createApp()`
- Triggers: Called by `server/src/index.ts` and by test files.
- Responsibilities: All middleware registration, route mounting, error handler. No side-effects.

**Frontend SPA:**
- Location: `index.html` → `src/main.tsx` → `src/App.tsx`
- Triggers: Vite dev server or nginx serving `dist/`.
- Responsibilities: `AuthProvider` wrapper, React Router `BrowserRouter`, lazy-loaded route components.

**Public ticket form (unauthenticated):**
- Location: `src/pages/PublicTicketForm.tsx`
- Route: `/submit-ticket`
- Backend: `server/src/routes/public.ts` — CSRF-exempt, rate-limited at 30 req/min.

## Error Handling

**Strategy:** Fail loudly at startup for missing secrets (`process.exit(1)`); fail gracefully at runtime for non-critical features (AI, webhooks, audit log).

**Patterns:**
- Missing `CSRF_SECRET` → `process.exit(1)` in `server/src/app.ts` (unconditional, no `NODE_ENV` gate, no fallback).
- Missing `JWT_SECRET` → `process.exit(1)` in `server/src/config/passport.ts`.
- AI functions always return `null` on error — callers must handle `null`.
- `auditLog.ts` catches DB errors internally — audit failure never propagates to caller.
- Webhook delivery failures are queued for retry with exponential backoff (1, 5, 30, 120, 360 min) via `webhookRetryScheduler.ts`.
- Global Express error handler in `createApp()` forwards `err.status` 4xx to client; logs and returns 500 for all other errors.
- `process.on('unhandledRejection')` and `process.on('uncaughtException')` both log via `logger.error`; uncaughtException exits.

## Cross-Cutting Concerns

**Logging:** `server/src/lib/logger.ts` — custom structured JSON logger, emits `{timestamp, level, message, ...meta}` to stdout/stderr. Used in routes, middleware, db layer, lib helpers, and schedulers throughout the codebase.

**Validation:** Input validated in route handlers using inline checks; `server/src/lib/htmlSanitizer.ts` sanitises rich-text fields before DB writes; frontend validates forms via `src/lib/validations.ts`.

**Authentication:** Dual-credential: JWT (15-min access token via Passport JWT strategy) + rolling refresh tokens (httpOnly cookie). API keys (`itk_live_…` prefix, SHA-256 stored) checked first in `authenticate` middleware; scoped to `read` or `read+write`.

**CSRF:** Double Submit Cookie (csrf-csrf library). Exempt: `/api/auth/login`, `/api/auth/refresh`, `/api/public/*`. Frontend fetches token once per session via `GET /api/csrf-token`, cached in `ApiClient`.

**Rate limiting:** In-memory per-IP. Four pre-built limiters in `server/src/middleware/rateLimit.ts`; applied per-route or per-router.

---

*Architecture analysis: 2026-06-18*
