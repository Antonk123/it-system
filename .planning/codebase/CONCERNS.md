# Codebase Concerns

**Analysis Date:** 2026-04-29
**Last re-verified:** 2026-06-18

## Tech Debt

**Monolithic Route Files:**
- Issue: `server/src/routes/tickets.ts` is 1644 lines — handles CRUD, CSV import/export, dashboard overview, activity feed, status counts, reminders, bulk operations, and history all in one file. (Down from 2152; CSV/query helpers extracted 2026-06-18 — see note below.)
- Files: `server/src/routes/tickets.ts`
- Impact: Hard to navigate, high merge conflict risk, cognitive overhead for any ticket-related change.
- Fix approach: Move dashboard endpoints (`/dashboard-overview`, `/activity-feed`, `/status-counts`, `/upcoming-reminders`) into `server/src/routes/dashboard.ts`. Keep core CRUD in tickets.ts.
- ~~Extract CSV import/export into a helper~~ PARTIALLY RESOLVED 2026-06-18: CSV import/export logic now lives in `server/src/lib/ticketImportExport.ts` (`parseCSV`, `generateCSV`, `escapeCSVField`) and query/filter building in `server/src/lib/ticketQuery.ts`; tickets.ts imports them. Dashboard-endpoint split remains open.

**Monolithic Frontend Pages:**
- Issue: Several page components are large with mixed concerns (state, layout, API calls, dialogs).
- Files: `src/pages/settings/TicketsTab.tsx` (1230 lines), `src/pages/TicketForm.tsx` (1125 lines), `src/components/ui/rich-text-editor.tsx` (1033 lines), `src/components/TemplateEditorModal.tsx` (964 lines), `src/pages/Reports.tsx` (956 lines)
- Impact: Slow to understand, hard to modify without side effects, poor reusability.
- Fix approach: Break `TicketsTab.tsx` into sub-components per concern (categories, tags, statuses, fields). Extract form logic from TicketForm into custom hooks.
- ~~`src/pages/Settings.tsx` (1774 lines)~~ RESOLVED 2026-06-18: Settings.tsx is now a 55-line shell that composes tab components under `src/pages/settings/` (`GeneralTab` 267, `AdminTab` 346, `IntegrationsTab` 430, `TicketsTab` 1230). The remaining large file is `TicketsTab.tsx` (now cited above).

**Excessive `any` Types in Backend:**
- Issue: Database query results are frequently cast as `any` or use inline interfaces across route files. (tickets.ts itself is now down to ~2 `any` uses after the 2026-06-18 helper extraction, so it is no longer the worst offender — broader route-file usage remains.)
- Files: `server/src/routes/contacts.ts`, and most route files
- Impact: Loses TypeScript safety, masks potential runtime errors, makes refactoring risky.
- Fix approach: Create shared type definitions in `server/src/types/` for all database row types. Replace `any` with proper types in route handlers.

**`SELECT *` Usage:**
- Issue: `SELECT *` is still used across route files (e.g. `checklistTemplates.ts` and `templates.ts` ~8 each, `companies.ts`/`sla.ts`/`checklists.ts`/`template-fields.ts` ~5 each), despite tickets.ts explicitly optimizing with column lists. Inconsistent approach.
- Files: `server/src/routes/sla.ts`, `server/src/routes/templates.ts`, `server/src/routes/checklists.ts`, `server/src/routes/checklistTemplates.ts`, `server/src/routes/companies.ts`, `server/src/routes/template-fields.ts`, and others
- Impact: Transfers unnecessary data, breaks if columns are added/renamed, masks which columns are actually needed.
- Fix approach: Follow the pattern in `server/src/routes/tickets.ts` (`TICKET_COLUMNS`, line ~47) — define explicit column lists per table.

**Duplicate CSV Helper Functions:**
- Issue: `escapeCSVField()` is still duplicated: a shared exported copy lives in `server/src/lib/ticketImportExport.ts` (line ~46), but `server/src/routes/contacts.ts` (line ~41) keeps its own private copy.
- Files: `server/src/lib/ticketImportExport.ts` (line 46), `server/src/routes/contacts.ts` (line 41)
- Impact: Bug fixes must be applied in two places.
- Fix approach: Import `escapeCSVField` from `server/src/lib/ticketImportExport.ts` in contacts.ts and delete the private copy.
- Note 2026-06-18: tickets.ts no longer has its own copy — it imports from `ticketImportExport.ts`. Only the contacts.ts duplication remains.

## Known Bugs

No explicit bugs found via TODO/FIXME markers (codebase has zero TODO/FIXME comments). No obvious broken logic detected during analysis.

## Security Considerations

**~~CSRF Secret Fallback~~ RESOLVED 2026-06-18:**
- Was: claimed a hardcoded fallback `'csrf-dev-secret-change-in-production'` at `server/src/index.ts` (line 152) with no runtime enforcement.
- Now FALSE: the CSRF_SECRET check lives in `server/src/app.ts` (`createApp`, lines 137-139): `if (!process.env.CSRF_SECRET) { logger.error('FATAL: ...'); process.exit(1); }` — unconditional, no dev fallback, no `NODE_ENV` gate. `getSecret` reads `process.env.CSRF_SECRET!` directly. There is no `csrf-dev-secret-*` string anywhere in the codebase.

**Default Admin Credentials:**
- Risk: `server/src/db/init.ts` creates a default admin (`ADMIN_EMAIL` env or fallback `admin@example.com`). Concern downgraded — see resolved note below.
- Files: `server/src/db/init.ts` (lines ~14-33)
- Current mitigation: Startup now **requires** `ADMIN_PASSWORD` — if unset, init logs an error and does not hardcode a password. Only runs if no admin exists. Email (not password) is logged.
- ~~hardcoded password `admin123` logged to stdout~~ RESOLVED 2026-06-18: there is no `admin123` literal; password comes from `ADMIN_PASSWORD` (required) and is never logged.
- Remaining recommendation (low): force a password change on first login.

**~~Public Ticket Endpoint — No Rate Limiting~~ RESOLVED 2026-06-18:**
- Was: `POST /api/public/tickets` had no rate limiting.
- Now: `server/src/routes/public.ts` imports `publicWriteRateLimiter` and `publicAiRateLimiter` from `../middleware/rateLimit.js` and applies `publicWriteRateLimiter` to `POST /tickets` (line ~87). Length validation (name 100, title 200, description 5000) still applies.

**~~Refresh Tokens Stored in localStorage~~ RESOLVED 2026-06-18:**
- Was: refresh tokens were stored in `localStorage` (XSS-accessible).
- Now: refresh tokens live in an httpOnly cookie — `server/src/routes/auth.ts` (`REFRESH_COOKIE = 'refreshToken'`, `httpOnly: true`, set via `setRefreshCookie`, read via `readRefreshToken`/`req.cookies`). The frontend only *clears* a legacy `localStorage.removeItem('refreshToken')` key (`src/lib/api.ts` line 47, commented "pre-cookie-migration") and never stores one. This is exactly the recommended fix.

**File Upload — No Path Traversal Guard:**
- Risk: Attachment file paths stored in the database are joined with `UPLOAD_DIR` and served via `res.sendFile()` without verifying the result stays within the upload directory.
- Files: `server/src/routes/attachments.ts` (`join(UPLOAD_DIR, attachment.file_path)` at lines ~257 and ~305; sent at line ~278)
- Current mitigation: Multer generates filenames server-side (`Date.now()-random.ext`), so stored paths are currently safe.
- Recommendations: Add `path.resolve()` + `startsWith(UPLOAD_DIR)` check to prevent any future regression.

## Performance Bottlenecks

**Search Query — multiple LEFT JOINs:**
- Problem: When a search term is provided, the ticket list query JOINs across relation tables (contacts, categories, tags, field_values) to search relation fields.
- Files: `server/src/lib/ticketQuery.ts` (query/filter building extracted from tickets.ts 2026-06-18; FTS condition at line ~205)
- Cause: FTS5 handles ticket content efficiently, but relation field search falls back to LIKE with multiple JOINs.
- Improvement path: Not a problem at current single-user scale. If slow: index relation fields in FTS5, or denormalize searchable fields.

**CSV Export Builds Full String in Memory:**
- Problem: `generateCSV()` builds the entire CSV as a single string before sending the response.
- Files: `server/src/lib/ticketImportExport.ts` (`generateCSV`, extracted from tickets.ts 2026-06-18)
- Cause: No streaming; concatenates all rows into one string.
- Improvement path: Use `res.write()` to stream rows. For 10k tickets (~2-3MB), current approach is fine but won't scale.

**Migrations File Growth:**
- Problem: `server/src/db/migrations.ts` is 1166 lines and growing. Every schema change appends a new migration.
- Files: `server/src/db/migrations.ts`
- Cause: Append-only migration array with no squashing.
- Improvement path: Periodically squash old migrations into the base schema (`server/src/db/schema.sql`) and reset the migrations array.

## Fragile Areas

**~~FTS5 Index Synchronization~~ RESOLVED 2026-06-18:**
- Was: every ticket create/update had to manually sync the `tickets_fts` shadow table inline in route handlers, so any new write path could forget it and produce stale search results.
- Now: FTS sync is handled by SQLite triggers (`tickets_fts_ai`, `tickets_fts_au`, `tickets_fts_ad`) on the `tickets` table, defined in `server/src/db/migrations.ts` (lines ~991-1130) — exactly the recommended fix. No manual inline `INSERT INTO tickets_fts` remains in route handlers (`public.ts` no longer touches FTS at all). `ticketQuery.ts` only reads via `tickets_fts MATCH`.
- Test coverage: `server/src/lib/ticketQuery.test.ts` covers the FTS query path.

**Email Configuration Scattered:**
- Files: `server/src/lib/email.ts` (`getEmailConfig` lines ~19-32, `createTransporter` lines ~35-51), `server/src/lib/emailInbound.ts` (`getEmailConfig` from line ~52)
- Why fragile: Email configuration is read from env vars in two separate places with different validation logic. `getEmailConfig()` in email.ts requires `SMTP_HOST + EMAIL_FROM + EMAIL_TO`, while `createTransporter()` in the same file only checks `SMTP_HOST`. Inbound email has its own `getEmailConfig()` with IMAP checks.
- Safe modification: Centralize all email config into a single validation module that exports both SMTP and IMAP configs.
- Test coverage: Inbound parsing now has `server/src/lib/emailInbound.test.ts`; the SMTP/IMAP config split itself is still untested.

**~~Webhook Dispatcher — No Retry Logic~~ RESOLVED 2026-06-18:**
- Was: failed webhook deliveries were recorded with `response_code = 0`/`attempts = 1` and never retried.
- Now: `server/src/lib/webhookDispatcher.ts` implements exponential backoff (`nextRetryAt`, `RETRY_DELAYS_MINUTES` = 1m/5m/30m/2h, `MAX_WEBHOOK_ATTEMPTS`) and a dedicated retry scheduler exists at `server/src/lib/webhookRetryScheduler.ts`. Deliveries are retried until the attempt cap, then dropped.

**Public Ticket Endpoint — Contact Auto-Creation:**
- Files: `server/src/routes/public.ts` (lines ~141-146)
- Why fragile: The public endpoint auto-creates contacts if an email doesn't exist. Deduplication is on email only; repeated submissions with the same email but a different name keep the original contact name. (Rate limiting is now applied — see resolved security item above.)
- Safe modification: Consider updating the existing contact name if email matches but name differs, or flagging the mismatch.
- Test coverage: No tests for the auto-create branch.

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
- Was: only manual backup via `GET /api/backup`.
- Now: `server/src/index.ts` runs an automatic daily backup at 04:00 (DB + uploads zipped into the same restorable format) with `BACKUP_RETENTION_DAYS` retention, plus an optional off-site upload hook (`server/src/lib/offsiteBackup.ts`, driven by `OFFSITE_BACKUP_CMD`).

**No Input Validation Library (backend):**
- Problem: Backend request-body validation is done manually with inline `if` checks across route files. `zod` is a dependency but is only used on the **frontend** (`src/lib/validations.ts`); no server route imports it.
- Blocks: Consistent backend validation, clear error messages, type inference from schemas.

## Test Coverage Gaps

**~~Near-Zero Backend Test Coverage~~ DOWNGRADED 2026-06-18:**
- Was: the backend had zero test files.
- Now: a Vitest suite exists — supertest HTTP integration tests in `server/src/app.test.ts` plus unit tests: `server/src/lib/emailInbound.test.ts`, `server/src/lib/ticketQuery.test.ts`, `server/src/lib/ticketImportExport.test.ts`, `server/src/lib/automationHelper.test.ts`, `server/src/lib/slaHelper.test.ts`, `server/src/lib/passwordPolicy.test.ts`, `server/src/lib/aiHelper.test.ts`, `server/src/lib/htmlUtils.test.ts`, `server/src/scripts/repair-kb-tables.test.ts`, and `server/src/routes/reports.test.ts`.
- Still untested: many route files, schedulers, the email config split, webhook dispatch end-to-end.
- Priority: Medium (was High).

**Frontend Tests — utility-only:**
- What's not tested: pages, components, hooks, and the API client. Coverage is utility-level only.
- Files (now): `src/lib/contentMigration.test.ts`, `src/lib/duration.test.ts`, `src/lib/html.test.ts`, `src/lib/date.test.ts`, `src/lib/validations.test.ts`, `src/lib/secureFileAccess.test.ts`. Components/pages remain untested.
- Risk: UI regressions, broken form validation, auth flow issues.
- Priority: Medium

**No E2E Tests:**
- What's not tested: Complete user flows (login, create ticket, update, close, export, public form submission).
- Files: No E2E test framework configured.
- Risk: UI/API contract mismatches go undetected.
- Priority: Medium — single-user system with manual QA, but still risky for regressions.

## Resolved This Session (2026-06-18)

- **KB preview DOM-XSS:** the KB list/search preview rendered user content via `dangerouslySetInnerHTML` without escaping. Fixed with `escapeHtml()` in `src/lib/html.ts`, now applied before injecting highlight `<mark>` tags in `src/pages/KnowledgeBase.tsx` and `src/components/KBLinksSection.tsx`. (Covered by `src/lib/html.test.ts`.)
- **Frontend `strictNullChecks` off:** now ENABLED in `tsconfig.app.json` (`"strictNullChecks": true`). Note `"strict": false` and `"noImplicitAny": false` are still off — full strict mode remains a future tightening.

---

*Concerns audit: 2026-04-29; re-verified against HEAD 2026-06-18*
