# Architecture

**Analysis Date:** 2026-03-22

## Pattern Overview

**Overall:** Full-stack monolithic application with client-server separation

**Key Characteristics:**
- React SPA frontend with client-side routing
- Express.js backend with SQLite database
- API-driven separation between client and server
- Session-based authentication with JWT tokens
- Scheduler-driven background jobs (reminders, auto-close)
- Component-based UI architecture with shared UI library (shadcn)

## Layers

**Frontend (Client) - Presentation Layer:**
- Purpose: User interface and client-side logic
- Location: `src/`
- Contains: React components, pages, hooks, contexts, utilities
- Depends on: Express API via `src/lib/api.ts`
- Used by: Browser clients, PWA

**API Layer - Express Routes:**
- Purpose: RESTful endpoints for CRUD and business logic
- Location: `server/src/routes/`
- Contains: Route handlers for tickets, auth, categories, attachments, KB, etc.
- Depends on: Database, middleware (auth, CSRF, rate limiting), business logic helpers
- Used by: Frontend via HTTP, external integrations

**Database Layer - SQLite:**
- Purpose: Persistent data storage with schema and migrations
- Location: `server/src/db/`
- Contains: Schema definition, connection management, migration scripts
- Depends on: better-sqlite3 driver
- Used by: All routes and services

**Business Logic - Utility Libraries:**
- Purpose: Shared logic for email, automation, scheduling
- Location: `server/src/lib/`
- Contains: Email service, reminder scheduler, auto-close scheduler, automation helpers
- Depends on: Database, nodemailer, node-cron
- Used by: Routes and scheduled tasks

**Configuration & Security:**
- Purpose: Authentication strategy, rate limiting, CSRF protection
- Location: `server/src/config/`, `server/src/middleware/`
- Contains: Passport strategies (local + JWT), CORS, rate limiter
- Depends on: Express, bcryptjs, jsonwebtoken
- Used by: Express middleware chain

## Data Flow

**Ticket Creation (Public):**
1. User submits form on `PublicTicketForm` (React page)
2. Frontend calls `api.createPublicTicket()` via `POST /api/public/tickets`
3. Route handler: `server/src/routes/public.ts` → validates input
4. Applies auto-tags via `automationHelper.ts` → detects priority
5. Inserts ticket to SQLite `tickets` table
6. Returns ticket ID + share token
7. Email notification sent via `email.ts` (if SMTP configured)

**Ticket List View (Authenticated):**
1. Page: `src/pages/TicketList.tsx` reads URL search params
2. Calls `useTickets()` hook with filter options
3. Hook uses React Query → calls `api.getTickets(queryString)`
4. Frontend makes `GET /api/tickets?page=1&status=open&...`
5. Route handler: `server/src/routes/tickets.ts` → builds SQL with filters
6. Paginated response: `{ data: Ticket[], pagination: { page, limit, total, ... } }`
7. Hook maps response to type `Ticket[]`, React Query caches with 2min staleTime
8. Component renders `TicketTable` or `KanbanView` based on `viewMode` state

**Authentication Flow:**
1. User submits email/password on `Login` page
2. Calls `api.login(email, password)` → `POST /api/auth/login`
3. Passport local strategy validates credentials (bcryptjs hash compare)
4. On success: generates JWT token + refresh token, returns `{ user, token, refreshToken }`
5. Frontend stores in localStorage: `auth_token`, `refreshToken`, `token` (for axios)
6. API client automatically includes `Authorization: Bearer ${token}` on requests
7. `setupTokenRefreshInterceptor()` in `src/main.tsx` auto-refreshes expired tokens
8. All subsequent requests use middleware `authenticate` to verify JWT

**Background Task Execution:**
1. Daily 02:30 UTC: `autoCloseScheduler` triggers
2. Queries tickets with `status='resolved'` and age > AUTO_CLOSE_DAYS env var
3. Updates status to 'closed', sets `closed_at` timestamp
4. Sends `sendTicketClosedEmail()` to requester
5. Daily 03:00 UTC: `cleanupRefreshTokens` removes expired tokens from DB
6. On demand: Reminder scheduler runs when ticket reminders are queued

**Knowledge Base (KB) Rendering:**
1. Editor: `KBArticleForm` uses Tiptap (rich text editor)
2. Stores HTML + markdown in `kb_articles` table
3. Reader: `KBArticleDetail` hydrates from DB, renders with `HtmlRenderer`
4. Sanitizes HTML with dompurify to prevent XSS
5. Images embedded as Base64 or uploaded to attachments via `uploadKbImage`

## Key Abstractions

**ApiClient (Singleton):**
- Purpose: Encapsulates HTTP communication with CSRF protection
- Examples: `src/lib/api.ts`
- Pattern: Singleton class with static methods for each endpoint
- Handles: Token management, CSRF token fetching/caching, automatic retries on CSRF failure, error mapping

**React Query Integration:**
- Purpose: Server state management with caching
- Examples: `useTickets()`, `useUsers()`, `useCategories()`
- Pattern: Typed query keys (`ticketKeys.list()`) for automatic invalidation
- Caching: staleTime=5min, gcTime=10min for tickets; short TTL for mutations

**Ticket Filtering & Search:**
- Purpose: Complex multi-field filtering via URL params
- Examples: `TicketList.tsx` reads `search`, `status[]`, `priority`, `category`, `tags[]`, `dateFrom/To`
- Pattern: URL-driven state (persistent across page refresh), built query string in hook
- Server-side: SQL WHERE clauses + LIKE for search, JOIN for tags/categories

**Custom Fields (Dynamic Schema):**
- Purpose: Per-tenant field customization without schema changes
- Pattern: `field_values` JSON column in tickets + `ticket_custom_fields` definition table
- Frontend: `DynamicField.tsx` renders based on field type (text, select, checkbox, date)
- Server: Stores as JSON, validates against template definition

**View Management (Filter Presets):**
- Purpose: Save and apply complex filter combinations
- Examples: `useFilterViews()` hook, `FilterViewManager.tsx`
- Pattern: Stored in localStorage as `filterViews_*`, synced to server optionally
- Includes: Named views with snapshots of all active filters

## Entry Points

**Frontend:**
- Location: `src/main.tsx`
- Triggers: `index.html` loads via Vite dev server or built bundle
- Responsibilities:
  - Mounts React root component
  - Sets up token refresh interceptor
  - Initializes theme from localStorage

**App Component:**
- Location: `src/App.tsx`
- Triggers: Rendered by main.tsx
- Responsibilities:
  - Wraps with providers (Theme, QueryClient, Router, Auth)
  - Defines protected/public routes
  - Renders route matching via React Router

**Backend Entry Point:**
- Location: `server/src/index.ts`
- Triggers: Node process starts via `npm run dev` (tsx watch) or `npm start` (compiled)
- Responsibilities:
  - Initializes Express app
  - Loads environment variables
  - Mounts middleware (security, CORS, auth, rate limiting)
  - Registers route groups
  - Starts scheduler: reminder, auto-close, token cleanup
  - Listens on `process.env.PORT || 3001`

## Error Handling

**Strategy:** Async/await with try-catch at route level; error codes standardized

**Patterns:**
- Routes catch errors, return 400/401/403/500 with `{ error: string }`
- Frontend catches API errors in mutation handlers, displays via `toast.error()`
- Database errors propagate to route handler, logged to console
- Validation errors: Zod schemas in frontend + server-side Zod re-validation
- CSRF failures: Auto-retry once after clearing stale token

**Specific Examples:**
- Login failure: Returns 401 with "Incorrect email or password"
- Rate limit exceeded: Returns 429 (via express-rate-limit)
- Invalid CSRF: Returns 403, frontend clears token and retries
- Database constraint violation: Returns 400 with constraint message

## Cross-Cutting Concerns

**Logging:**
- Console.log for startup events (scheduler enabled, CORS config)
- Server logs to stdout (captured by Docker logs)
- No structured logging configured; no log aggregation

**Validation:**
- Frontend: Zod schemas in `src/lib/validations.ts` (ticketInsertSchema, ticketUpdateSchema)
- Server: Validates in route handlers before DB operations
- Types: TypeScript enforces at compile time; runtime validation via Zod

**Authentication:**
- Passport with local + JWT strategies
- Session stored in JWT token (stateless)
- Refresh tokens in DB for invalidation
- CSRF token fetched lazily, cached in memory

**Authorization:**
- User role (admin/user) checked in routes via `user.role` from JWT payload
- Public endpoints allow anonymous access (e.g., `/api/public/tickets`)
- Protected endpoints require valid JWT via `authenticate` middleware

**CORS:**
- Configured for localhost dev (5173, 8082) + environment variable
- Credentials allowed (includes cookies for CSRF)
- No wildcard origins with credentials

**Rate Limiting:**
- Applied per IP address
- Rate limiter config in `server/src/middleware/rateLimit.ts`
- Prevents brute force on auth endpoints

---

*Architecture analysis: 2026-03-22*
