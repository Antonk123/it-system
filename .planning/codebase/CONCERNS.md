# Codebase Concerns

**Analysis Date:** 2026-06-18
**Last re-verified:** 2026-06-18

## Tech Debt

**Monolithic Route Files:**
- Issue: `server/src/routes/tickets.ts` is 1644 lines — handles CRUD, CSV import/export, dashboard overview, activity feed, status counts, reminders, bulk operations, and history all in one file. (Down from 2152; CSV/query helpers extracted 2026-06-18.)
- Files: `server/src/routes/tickets.ts`
- Impact: Hard to navigate, high merge conflict risk, cognitive overhead for any ticket-related change.
- Fix approach: Move dashboard endpoints (`/dashboard-overview`, `/activity-feed`, `/status-counts`, `/upcoming-reminders`) into `server/src/routes/dashboard.ts`. Keep core CRUD in tickets.ts.
- ~~Extract CSV import/export into a helper~~ PARTIALLY RESOLVED 2026-06-18: CSV import/export logic now lives in `server/src/lib/ticketImportExport.ts` and query/filter building in `server/src/lib/ticketQuery.ts`. Dashboard-endpoint split remains open.

**Monolithic Frontend Pages:**
- Issue: Several page components are large with mixed concerns (state, layout, API calls, dialogs).
- Files: `src/pages/settings/TicketsTab.tsx` (1230 lines), `src/pages/TicketForm.tsx` (1125 lines), `src/pages/TicketDetail.tsx` (1033 lines), `src/components/ui/rich-text-editor.tsx` (1033 lines), `src/components/TemplateEditorModal.tsx` (964 lines), `src/pages/Reports.tsx` (956 lines)
- Impact: Slow to understand, hard to modify without side effects, poor reusability.
- Fix approach: Break `TicketsTab.tsx` into sub-components per concern (categories, tags, statuses, fields). Extract form logic from TicketForm into custom hooks.
- ~~`src/pages/Settings.tsx` (1774 lines)~~ RESOLVED 2026-06-18: Now a 55-line shell composing tab components under `src/pages/settings/`.

**Monolithic Frontend API Client:**
- Issue: `src/lib/api.ts` is 1766 lines — one file that holds the ApiClient class, all API call methods, and all shared interface/type definitions for the entire frontend.
- Files: `src/lib/api.ts`
- Impact: Any change to any API call or type touches the same large file; types defined here (e.g. `TicketRow`, `InvoiceRow`) leak type responsibility into what should be a transport layer.
- Fix approach: Extract shared types to `src/types/` (co-located by domain: `src/types/ticket.ts`, `src/types/billing.ts`, etc.), then split API methods into domain modules (e.g. `src/lib/api/tickets.ts`). This is a large but mechanical refactor.

**Excessive `any` Types in Backend:**
- Issue: Database query results and request body values are cast to `any` across route files. 17 explicit `: any` / `as any` occurrences remain across routes (contacts.ts, billing.ts, public.ts, checklistTemplates.ts, webhooks.ts, tickets.ts, etc.).
- Files: `server/src/routes/contacts.ts`, `server/src/routes/billing.ts`, `server/src/routes/public.ts`, `server/src/routes/checklistTemplates.ts`, `server/src/routes/webhooks.ts`, `server/src/routes/tickets.ts`
- Impact: Loses TypeScript safety; masks potential runtime errors. Server has `"strict": true` in `server/tsconfig.json` but these explicit `any` annotations bypass it.
- Fix approach: Create shared type definitions in `server/src/types/` for all database row types. Replace `any` with proper types in route handlers.

**`SELECT *` Usage:**
- Issue: `SELECT *` is used across multiple route files (~31 occurrences in: `checklistTemplates.ts`, `templates.ts`, `companies.ts`, `sla.ts`, `checklists.ts`, `template-fields.ts`), despite `tickets.ts` explicitly optimizing with column lists.
- Files: `server/src/routes/sla.ts`, `server/src/routes/templates.ts`, `server/src/routes/checklists.ts`, `server/src/routes/checklistTemplates.ts`, `server/src/routes/companies.ts`, `server/src/routes/template-fields.ts`
- Impact: Transfers unnecessary data, breaks if columns are added/renamed, masks which columns are actually needed.
- Fix approach: Follow the pattern in `server/src/routes/tickets.ts` (`TICKET_COLUMNS`, line ~47) — define explicit column lists per table.

**Duplicate CSV Helper Functions:**
- Issue: `escapeCSVField()` is still duplicated: a shared exported copy in `server/src/lib/ticketImportExport.ts` (line ~46) and a private copy in `server/src/routes/contacts.ts` (line 41).
- Files: `server/src/lib/ticketImportExport.ts` (line 46), `server/src/routes/contacts.ts` (line 41)
- Impact: Bug fixes must be applied in two places.
- Fix approach: Import `escapeCSVField` from `server/src/lib/ticketImportExport.ts` in contacts.ts and delete the private copy.

## Known Bugs

No explicit bugs found via TODO/FIXME markers (codebase has zero TODO/FIXME comments). No obvious broken logic detected during analysis.

## Security Considerations

**JWT Access Token in localStorage:**
- Risk: The JWT access token is stored in `localStorage` (`auth_token` key — see `src/lib/api.ts` lines 34-46, `src/contexts/AuthContext.tsx` line 22). Any XSS vulnerability can exfiltrate it.
- Files: `src/lib/api.ts`, `src/contexts/AuthContext.tsx`
- Current mitigation: Refresh tokens were moved to httpOnly cookie (resolved). Access tokens are short-lived (15 min). Helmet CSP blocks inline scripts and external `scriptSrc`.
- Note: Moving short-lived access tokens to memory (React state/context) rather than localStorage would fully close this surface; it is a meaningful but non-trivial refactor.
- Priority: Low — CSP + CSRF + short-lived tokens significantly reduce exploitability, but the theoretical risk is real.

**~~CSRF Secret Fallback~~ RESOLVED 2026-06-18:**
- `server/src/app.ts` unconditionally calls `process.exit(1)` if `CSRF_SECRET` is missing. No fallback, no NODE_ENV gate.

**Default Admin Credentials:**
- Risk: `server/src/db/init.ts` creates a default admin on first startup using `ADMIN_EMAIL` env (fallback `admin@example.com`) and `ADMIN_PASSWORD` env.
- Files: `server/src/db/init.ts` (lines ~14-33)
- Current mitigation: Startup requires `ADMIN_PASSWORD` — if unset, init logs an error and does not create admin. Email only (not password) is logged. Only runs if no admin exists.
- ~~hardcoded password `admin123`~~ RESOLVED 2026-06-18: no hardcoded password exists.
- Remaining recommendation (low): force a password change on first login.

**~~Public Ticket Endpoint — No Rate Limiting~~ RESOLVED 2026-06-18:**
- `server/src/routes/public.ts` applies `publicWriteRateLimiter` to `POST /tickets` and `publicAiRateLimiter` to `POST /ai-suggest`.

**~~Refresh Tokens Stored in localStorage~~ RESOLVED 2026-06-18:**
- Refresh tokens now live in an httpOnly cookie. Frontend only clears a legacy `localStorage.removeItem('refreshToken')` key during logout.

**File Upload — No Path Traversal Guard:**
- Risk: Attachment file paths stored in DB are joined with `UPLOAD_DIR` via `join(UPLOAD_DIR, attachment.file_path)` and served without verifying the resolved path stays inside `UPLOAD_DIR`.
- Files: `server/src/routes/attachments.ts` (lines ~257, ~305)
- Current mitigation: Multer generates filenames server-side (`Date.now()-random.ext`), so stored paths are safe in practice.
- Recommendation: Add `path.resolve()` + `startsWith(resolvedUploadDir)` check to prevent any future regression if filename generation changes.

**CORS Misconfiguration Risk in Production:**
- Risk: In production, if `CORS_ORIGIN` is not set, `uniqueOrigins` will be an empty array. All browser requests (with an Origin header) will be blocked. Requests without an Origin header (curl, server-to-server) still pass.
- Files: `server/src/app.ts` (lines 92-126)
- Current mitigation: The startup log prints the effective `allowedOrigins` — a misconfiguration would surface quickly.
- Recommendation: Add a startup warning (or `process.exit(1)`) if `NODE_ENV === 'production'` and `CORS_ORIGIN` is unset.

## Performance Bottlenecks

**Search Query — Multiple LEFT JOINs:**
- Problem: When a search term is provided, the ticket list query JOINs across relation tables (contacts, categories, tags, field_values) to search relation fields.
- Files: `server/src/lib/ticketQuery.ts` (FTS condition at line ~205)
- Cause: FTS5 handles ticket content efficiently, but relation field search falls back to LIKE with multiple JOINs.
- Improvement path: Not a problem at current single-user scale. If slow: index relation fields in FTS5, or denormalize searchable fields.

**CSV Export Builds Full String in Memory:**
- Problem: `generateCSV()` builds the entire CSV as a single string before sending the response.
- Files: `server/src/lib/ticketImportExport.ts` (`generateCSV`)
- Cause: No streaming; concatenates all rows into one string.
- Improvement path: Use `res.write()` to stream rows. For 10k tickets (~2-3MB), current approach is fine but won't scale.

**Migrations File Growth:**
- Problem: `server/src/db/migrations.ts` is 1166 lines with 59 migration entries and growing. Every schema change appends a new migration.
- Files: `server/src/db/migrations.ts`
- Cause: Append-only migration array with no squashing.
- Improvement path: Periodically squash old migrations into the base schema (`server/src/db/schema.sql`) and reset the migrations array.

## Fragile Areas

**Email Configuration Scattered:**
- Files: `server/src/lib/email.ts` (`getEmailConfig` at line 19, `createTransporter` at line ~35), `server/src/lib/emailInbound.ts` (`getEmailConfig` at line 52)
- Why fragile: Email configuration is read from env vars in two separate files with different validation logic. `getEmailConfig()` in email.ts requires `SMTP_HOST + EMAIL_FROM + EMAIL_TO`, while `emailInbound.ts` has its own `getEmailConfig()` checking IMAP vars. A third SMTP_HOST check exists in `email.ts` at line 499 for reminder email.
- Safe modification: Centralize all email config into a single validation module that exports both SMTP and IMAP configs.
- Test coverage: Inbound parsing has `server/src/lib/emailInbound.test.ts`; SMTP/IMAP config validation split is untested.

**~~FTS5 Index Synchronization~~ RESOLVED 2026-06-18:**
- FTS sync is handled by SQLite triggers (`tickets_fts_ai`, `tickets_fts_au`, `tickets_fts_ad`) in `server/src/db/migrations.ts` (lines ~991-1130). No manual inline `INSERT INTO tickets_fts` remains.

**~~Webhook Dispatcher — No Retry Logic~~ RESOLVED 2026-06-18:**
- `server/src/lib/webhookDispatcher.ts` implements exponential backoff with `RETRY_DELAYS_MINUTES` (1m/5m/30m/2h). `server/src/lib/webhookRetryScheduler.ts` runs every minute.

**Public Ticket Endpoint — Contact Auto-Creation:**
- Files: `server/src/routes/public.ts` (lines ~141-146)
- Why fragile: The public endpoint auto-creates contacts if an email doesn't exist. Deduplication is on email only; repeated submissions with the same email but a different name silently keep the original contact name.
- Safe modification: Consider updating the existing contact name if email matches but name differs, or flagging the mismatch.
- Test coverage: No tests for the auto-create branch.

**Pre-commit Hook — Type Errors Not Caught:**
- Files: `.husky/pre-commit` (runs only `npx lint-staged`), `package.json` (`lint-staged` runs only `eslint` on `*.{ts,tsx}`)
- Why fragile: TypeScript type errors do not block commits. `tsc --noEmit` is not in the pre-commit hook. Frontend `tsconfig.app.json` has `"strict": false` and `"noImplicitAny": false` — only `strictNullChecks` is on — so many type issues can exist silently.
- Safe modification: Add `npm run typecheck` (or `tsc --noEmit`) to the pre-commit hook, or enforce it in CI.

## Scaling Limits

**SQLite Single-Writer:**
- Current capacity: Single user, low write volume. WAL mode and performance pragmas enabled.
- Limit: SQLite handles one writer at a time. Under heavy concurrent writes, writers serialize.
- Scaling path: Not a concern for single-user system. If multi-user is ever needed, migrate to PostgreSQL.

**In-Memory Rate Limiter:**
- Current capacity: Works for single-instance deployment.
- Limit: Rate limit state is lost on server restart. Multiple server instances would not share state.
- Files: `server/src/middleware/rateLimit.ts`
- Scaling path: Use Redis-backed rate limiter if horizontal scaling is needed.

**Local File Storage:**
- Current capacity: Disk-limited by container/server space. 10MB per file upload limit.
- Limit: No archival, no cleanup of orphaned files, no storage quota monitoring.
- Files: `server/src/routes/attachments.ts` (UPLOAD_DIR)
- Scaling path: Add storage monitoring. Consider S3 if volume grows.

## Dependencies at Risk

No critical dependency risks identified. The stack uses mature, well-maintained packages (Express, better-sqlite3, React, Vite, Tailwind). No deprecated packages detected.

## Missing Critical Features

**~~No Automated Backup Schedule~~ RESOLVED 2026-06-18:**
- `server/src/index.ts` runs an automatic daily backup at 04:00 with `BACKUP_RETENTION_DAYS` retention and an optional off-site upload hook (`server/src/lib/offsiteBackup.ts`).

**No Input Validation Library (backend):**
- Problem: Backend request-body validation is done manually with inline `if` checks across route files. `zod` is a frontend dependency (`src/lib/validations.ts`) but is not imported in any server route.
- Blocks: Consistent backend validation, clear error messages, type inference from schemas.

## Test Coverage Gaps

**~~Near-Zero Backend Test Coverage~~ DOWNGRADED 2026-06-18:**
- Was: zero test files. Now: Vitest suite with supertest HTTP tests in `server/src/app.test.ts` and unit tests: `server/src/lib/emailInbound.test.ts`, `server/src/lib/ticketQuery.test.ts`, `server/src/lib/ticketImportExport.test.ts`, `server/src/lib/automationHelper.test.ts`, `server/src/lib/slaHelper.test.ts`, `server/src/lib/passwordPolicy.test.ts`, `server/src/lib/aiHelper.test.ts`, `server/src/lib/htmlUtils.test.ts`, `server/src/scripts/repair-kb-tables.test.ts`, `server/src/routes/reports.test.ts`.
- Still untested: most route files (auth, tickets, contacts, billing, kb, attachments, etc.), all schedulers, email config validation, webhook dispatch end-to-end.
- Priority: Medium (was High).

**Frontend Tests — Utility-Only:**
- What's not tested: pages, components, hooks, and the API client. Coverage is utility-level only.
- Files (tested): `src/lib/contentMigration.test.ts`, `src/lib/duration.test.ts`, `src/lib/html.test.ts`, `src/lib/date.test.ts`, `src/lib/validations.test.ts`, `src/lib/secureFileAccess.test.ts`.
- Risk: UI regressions, broken form validation, auth flow issues.
- Priority: Medium

**No E2E Tests:**
- What's not tested: Complete user flows (login, create ticket, update, close, export, public form submission).
- Files: No E2E test framework configured.
- Risk: UI/API contract mismatches go undetected.
- Priority: Medium — single-user system with manual QA, but still risky for regressions.

## Resolved This Session (2026-06-18)

- **KB preview DOM-XSS:** KB list/search preview rendered user content via `dangerouslySetInnerHTML` without escaping. Fixed with `escapeHtml()` in `src/lib/html.ts`, applied before injecting `<mark>` tags in `src/pages/KnowledgeBase.tsx` and `src/components/KBLinksSection.tsx`. Covered by `src/lib/html.test.ts`.
- **Frontend `strictNullChecks` off:** Now ENABLED in `tsconfig.app.json`. Note `"strict": false` and `"noImplicitAny": false` are still off — full strict mode remains future work.
- **Dev lockfile write-back:** `docker-compose.dev.portainer.yml` now uses `npm ci` (not `npm install`) for both backend and frontend containers, preventing package-lock.json write-back in the shared git checkout.
- **KB markdown import broken GFM tables:** The import path now uses `markdown-it` (`src/lib/contentMigration.ts`). `server/src/scripts/repair-kb-tables.ts` exists as a one-time fix for previously-imported articles.

---

*Concerns audit: 2026-04-29; re-verified and updated against HEAD 2026-06-18*
