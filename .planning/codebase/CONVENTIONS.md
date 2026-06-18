# Coding Conventions

**Analysis Date:** 2026-06-18

## Naming Patterns

**Files:**
- React components: PascalCase (e.g., `CategoryBadge.tsx`, `TicketDetail.tsx`)
- React hooks: camelCase with `use` prefix (e.g., `useTickets.ts`, `useCategories.ts`)
- Utility/lib files: camelCase (e.g., `validations.ts`, `contentMigration.ts`)
- Backend route modules: camelCase, plural noun (e.g., `tickets.ts`, `comments.ts`, `kb.ts`)
- Backend lib modules: camelCase, descriptive (e.g., `slaHelper.ts`, `automationHelper.ts`, `emailInbound.ts`)
- Test files: same name as source with `.test.ts` suffix (co-located)

**Functions:**
- Frontend React components: PascalCase named exports (`export const CategoryBadge = ...`)
- Frontend hooks: camelCase (`export const useTickets = ...`)
- Backend handlers: arrow functions assigned to `router.get/post/put/delete()`
- Pure helpers: camelCase named exports
- Event handlers in components: `handle` prefix (`handleClick`, `handleKeyDown`)

**Variables:**
- camelCase throughout both frontend and backend
- DB column names: `snake_case` (SQLite convention, e.g., `ticket_id`, `created_at`)
- Type/interface fields bridging DB↔frontend: DB rows use `snake_case`, mapped TypeScript types use `camelCase`

**Types:**
- Interfaces: PascalCase with `I`-prefix absent (e.g., `UseTicketsOptions`, `AuthRequest`, `Migration`)
- Type aliases: PascalCase (e.g., `TicketStatus`, `TicketPriority`, `LogLevel`)
- Enums: not used — string literal union types preferred (`'open' | 'in-progress' | ...`)

## Code Style

**Formatting:**
- No Prettier config present — formatting is not enforced by tooling
- TypeScript 5.8 (frontend), TypeScript 5.7 (backend)
- ESM throughout (`"type": "module"` in both `package.json` files)

**Linting:**
- ESLint 9 flat config: `eslint.config.js` at repo root
- Frontend: `typescript-eslint` recommended + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`
- Backend: `no-console: error` (must use `logger` from `server/src/lib/logger.ts`)
- Backend: `no-restricted-globals` blocks bare `__dirname`/`__filename` (ESM; must define locally via `fileURLToPath`)
- `@typescript-eslint/no-unused-vars`: off; `@typescript-eslint/no-explicit-any`: off

## API Call Rule (Frontend — ENFORCED)

**All HTTP calls from frontend must go through `src/lib/api.ts` `api.request()` method or its wrappers.**

`no-restricted-syntax` ESLint rules block:
- `fetch('/api/...')` with a string literal starting `/api`
- `fetch(\`${API_BASE_URL}...\`)` template literals using `API_BASE_URL`

Reason: `api.request()` in `src/lib/api.ts` provides CSRF token injection, `Authorization` header, and 401 → refresh-token retry automatically. Raw fetch misses these and causes 403 in production.

Exceptions in `eslint.config.js`:
- `src/lib/api.ts` itself (implements the wrapper, needs raw fetch)
- `src/lib/secureFileAccess.ts` (calls `/auth/refresh` which is CSRF-exempt)

## Import Organization

**Order (frontend):**
1. React/framework imports (`react`, `react-router-dom`, `date-fns`)
2. Third-party libraries (`lucide-react`, `@tanstack/react-query`, etc.)
3. Internal hooks (`@/hooks/...`)
4. Internal components (`@/components/...`)
5. Internal lib/utils (`@/lib/...`)
6. Types (`@/types/...`)

**Path Aliases:**
- `@/*` → `./src/*` (defined in `tsconfig.app.json` and root `tsconfig.json`)
- Backend has no path aliases — uses relative imports with `.js` extension (ESM resolution)

**Backend import note:**
Backend imports always use `.js` extension even for `.ts` source files (TypeScript ESM convention):
```typescript
import { db } from '../db/connection.js';
import { logger } from '../lib/logger.js';
```

## TypeScript Strictness

**Frontend (`tsconfig.app.json`):**
- `strict: false` but `strictNullChecks: true` explicitly set
- `noImplicitAny: false`, `noUnusedLocals: false`
- The app build is checked with null-safety but not full strict mode

**Root `tsconfig.json` (references only):**
- `strictNullChecks: false` — this applies to the node/tool config layer, NOT the app source
- App source is always compiled via `tsconfig.app.json`

**Backend (`server/tsconfig.json`):**
- `strict: true` — full strict mode including `strictNullChecks`

## Error Handling

**Backend routes:**
- All route handlers wrapped in `try/catch`
- Errors logged via `logger.error('message', { error: String(error) })` then HTTP 500 returned
- Pattern: `res.status(500).json({ error: 'Human-readable message' })`
- Specific error codes returned for known failures (400 for bad input, 401 for auth, 403 for CSRF/permission)

**Frontend:**
- React Query handles async error state; `isError` returned from `useQuery`
- User-facing errors shown via `sonner` toast (`toast.error(...)`)
- `ErrorBoundary` component at `src/components/ErrorBoundary.tsx` for unexpected render errors

## Logging (Backend)

**Framework:** Custom structured logger at `server/src/lib/logger.ts`

**Pattern:**
```typescript
import { logger } from '../lib/logger.js';

logger.info('Ticket created', { ticketId, userId });
logger.error('Failed to fetch tickets', { error: String(error), query: req.query });
logger.warn('SLA deadline missed', { ticketId, deadline });
```

**Output format:** JSON with `{ timestamp, level, message, ...meta }` — one entry per `console.log/error/warn` call. Structured fields passed as second argument (`meta: Record<string, unknown>`).

**Enforcement:** `no-console: error` in ESLint for all `server/**/*.ts` files. Exceptions: `server/src/lib/logger.ts` (implements the wrapper), `server/src/db/migrations.ts`, `server/src/db/cleanup-refresh-tokens.ts` (standalone scripts).

## Input Sanitization (Backend)

- Rich HTML content: `sanitizeRichText()` from `server/src/lib/htmlSanitizer.ts` (uses `sanitize-html`)
- Plain text fields: `sanitizePlainText()` from the same module
- Applied at route handler level before DB writes, e.g. `sanitizePlainText(title.trim())`, `sanitizeRichText(content)`

## Validation

**Frontend:** Zod schemas in `src/lib/validations.ts` — `ticketInsertSchema`, `ticketUpdateSchema`, `contactSchema`, `companySchema`, `categorySchema`, etc. Parsed with `.parse()` or checked via `getValidationError()` helper.

**Backend:** Input validated ad-hoc in route handlers (no central schema layer for backend). Common pattern: check required fields, return `res.status(400).json({ error: '...' })` early if invalid.

## Database Access

**Backend:** All DB access via `better-sqlite3` synchronous API through the singleton `db` exported from `server/src/db/connection.ts`.

**Migrations:** Must be added to the `migrations` array in `server/src/db/migrations.ts`. `runMigrations()` runs at server startup via `initializeDatabase()`. Standalone `npx tsx` migration scripts are NOT run at startup.

**Pattern:**
```typescript
const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
db.prepare('UPDATE tickets SET status = ? WHERE id = ?').run(status, id);
```

## Component Design

**React components:** Functional only, no class components. Named exports preferred (`export const Foo = ...`). Default exports only for pages in `src/pages/`.

**Hooks:** Custom hooks in `src/hooks/` — each wraps React Query calls for a single resource domain (e.g., `useTickets.ts`, `useCategories.ts`). Query keys defined as factory objects in the same file (e.g., `ticketKeys.all`, `ticketKeys.list(filters)`).

## Git Hooks

**Pre-commit:** Husky + lint-staged runs `eslint` on staged `*.{ts,tsx}` files. Config in root `package.json` under `"lint-staged"`. Never skip with `--no-verify`.

---

*Convention analysis: 2026-06-18*
