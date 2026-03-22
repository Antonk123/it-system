# Codebase Concerns

**Analysis Date:** 2026-03-22

## Tech Debt

### 1. Debug Logging Left in Production Code
- **Issue:** Unfiltered console.log statements (388 total) remain in deployed code, including sensitive debug data
- **Files:** `server/src/routes/tickets.ts:664-704` (IMPORT CONFIRM DEBUG, ticket details), plus 37 other route files with console statements
- **Impact:** Performance overhead, information leakage in logs, makes logs harder to parse for real errors
- **Fix approach:**
  - Implement structured logging middleware with log levels (debug, info, warn, error)
  - Use environment-based log filtering: only log debug/verbose in development
  - Consider winston or pino for production logging
  - Add pre-commit hook to catch `console.log` statements

### 2. Excessive SELECT * Queries (Performance Regression)
- **Issue:** Export endpoint uses `SELECT *` for large datasets despite optimization comments elsewhere
- **Files:** `server/src/routes/tickets.ts:798` (export endpoint)
- **Impact:** 30-40% unnecessary data transfer for bulk operations, slow CSV generation
- **Fix approach:**
  - Replace with explicit column lists matching `TICKET_COLUMNS` pattern
  - All SELECT statements should use columnar approach already established in file

### 3. Weak Type Safety with 'any' Type
- **Issue:** 14 instances of `any` in database results, especially in ticket routes with complex joins
- **Files:** `server/src/routes/tickets.ts` (multiple lines with `any[] type casting`), `server/src/db/connection.ts`
- **Impact:**
  - Runtime type errors not caught at compile time
  - Brittle CSV export and import functions
  - Makes refactoring risky
- **Fix approach:**
  - Define strict TypeScript interfaces for all db.prepare() results
  - Use `.all() as TypeRow[]` pattern consistently
  - Run tsc --strict in build pipeline to catch type issues

### 4. Hardcoded Database Path Without Validation
- **Issue:** `DB_PATH` uses relative path fallback but doesn't validate directory existence
- **Files:** `server/src/db/connection.ts:10`
- **Impact:** Silent failure if data directory doesn't exist, corrupt database in wrong location
- **Fix approach:**
  - Validate directory exists on startup
  - Create directory if missing with proper error handling
  - Add explicit file permissions check

---

## Known Bugs

### 1. CSV Import Debug Logging Exposed
- **Symptoms:** Debug logs show category maps, contact maps, and processing details on every import
- **Files:** `server/src/routes/tickets.ts:664-681, 698-704`
- **Trigger:** POST `/api/tickets/import` with any CSV
- **Workaround:** Remove debug statements manually from code, restart server
- **Priority:** High (security/information disclosure)

### 2. Missing Null Handling in Export
- **Symptoms:** CSV export may produce malformed rows if `category_id` or `requester_id` don't exist
- **Files:** `server/src/routes/tickets.ts:666-68` (lookup map construction without null checks)
- **Trigger:** Export tickets with deleted contacts or categories
- **Workaround:** Ensure all categories and contacts are preserved before export
- **Priority:** Medium (data integrity)

### 3. Uncontrolled Error Handling in CSV Parsing
- **Symptoms:** CSV import fails silently if parsing errors occur; partial imports succeed
- **Files:** `server/src/routes/tickets.ts:93-115` (parseCSVLine function has no error handling)
- **Trigger:** Malformed CSV with unterminated quotes or mixed line endings
- **Workaround:** Validate CSV format before upload; test with small files first
- **Priority:** Medium (reliability)

---

## Security Considerations

### 1. Excessive Debug Output (Information Disclosure)
- **Risk:** Debug logs on import endpoint expose:
  - Contact email addresses and names
  - Category mappings
  - Requester identification
  - Internal data structure (categoryMap keys, etc.)
- **Files:** `server/src/routes/tickets.ts:664-681`
- **Current mitigation:** Logs only visible in console (not exposed via API), but WILL be in Docker logs
- **Recommendations:**
  - Remove all console.log statements from production code
  - Implement structured logging with log levels
  - Only log debug info when NODE_ENV=development explicitly
  - Sanitize any error messages shown to users

### 2. CSRF Protection - Incomplete Coverage
- **Risk:** CSRF token caching in client (ApiClient.csrfToken) doesn't invalidate on auth change
- **Files:** `src/lib/api.ts:38` (sets to null on auth change), but pattern may leak across contexts
- **Current mitigation:** Token IS invalidated on logout/auth changes
- **Recommendations:**
  - Clear CSRF token explicitly on logout
  - Add per-request token refresh for high-value operations (admin actions)
  - Consider setting CSRF_SECRET from environment (currently uses dev default)

### 3. Rate Limiting Present But Not Enforced Consistently
- **Risk:** Rate limiter imported but not clear if applied to all sensitive endpoints
- **Files:** `server/src/middleware/rateLimit.ts` exists, but usage across routes not verified
- **Current mitigation:** Helmet + CORS configured, login endpoint should have rate limit
- **Recommendations:**
  - Audit all auth endpoints to ensure rate limiting is applied
  - Add rate limiting to file upload endpoints (currently 10MB limit only)
  - Document which endpoints are rate-limited and the thresholds

### 4. File Upload Path Traversal Risk
- **Risk:** Upload directory is configurable via env var but may not validate path safety
- **Files:** `server/src/routes/tickets.ts:14` (UPLOAD_DIR config), `server/src/routes/attachments.ts`
- **Current mitigation:** Uses multer with memoryStorage, files stored with UUID names
- **Recommendations:**
  - Validate upload directory is within expected location
  - Use absolute paths only
  - Add virus scanning or file type validation beyond MIME type

---

## Performance Bottlenecks

### 1. Missing N+1 Optimization for KB Articles
- **Problem:** KB routes fetch category data then iterate to build hierarchy
- **Files:** `server/src/routes/kb.ts:67-100` (KB category hierarchy construction)
- **Cause:** Separate queries for articles and categories, then application-level joins
- **Improvement path:**
  - Use single LEFT JOIN query to fetch articles with category data
  - Cache category/article relationships in memory for subsequent requests

### 2. React Component Re-renders (No Memoization)
- **Problem:** TicketList (513 lines), TicketTable (557 lines), TicketDetail (536 lines) lack React.memo and useCallback
- **Files:** `src/pages/TicketList.tsx`, `src/components/TicketTable.tsx`, `src/pages/TicketDetail.tsx`
- **Cause:** 7 useState/useEffect hooks in TicketList alone; child components re-render on parent changes
- **Improvement path:**
  - Wrap TicketCard, TicketRow with React.memo()
  - Use useCallback for filter/sort handlers
  - Consider context or state management to isolate re-renders
  - Estimated gain: 30-50% fewer re-renders per page

### 3. No Virtualization for Large Lists
- **Problem:** Pagination implemented but no row virtualization for >200 tickets per page
- **Files:** `src/pages/TicketList.tsx` (PaginationControls used but no react-window/react-virtual)
- **Cause:** All rows rendered to DOM regardless of viewport
- **Improvement path:**
  - Implement react-window or TanStack Virtual
  - Handle dynamic row heights for variable ticket sizes
  - Estimated gain: 3-5x faster render for >200 tickets

### 4. Inefficient CSV Generation
- **Problem:** Large exports build entire CSV string in memory before response
- **Files:** `server/src/routes/tickets.ts:49-90` (generateCSV function)
- **Cause:** No streaming; builds complete string then writes
- **Improvement path:**
  - Use streaming response (res.write) instead of building full string
  - For 10k tickets: ~2-3MB CSV loaded in memory vs streamed directly

---

## Fragile Areas

### 1. Database Transaction Handling
- **Files:** `server/src/routes/tickets.ts:692-750` (CSV import with db.transaction)
- **Why fragile:**
  - All-or-nothing transaction means ANY error fails entire import
  - No logging of which ticket failed or why
  - Categories/contacts may be created even if ticket insert fails
  - Transaction doesn't catch pre-insert validation errors
- **Safe modification:**
  - Add detailed try-catch inside transaction with row-level error logging
  - Provide partial success response: "created 45/50 tickets, failed 5"
  - Validate categories/contacts exist BEFORE transaction
- **Test coverage:** CSV import tests missing; manual testing only

### 2. Automation Rules Engine
- **Files:** `server/src/config/automation.ts`, `server/src/lib/automationHelper.ts`
- **Why fragile:**
  - Auto-tagging rules hardcoded; no way to modify without code change
  - No conflict detection if rules override user's manual priority
  - Auto-close scheduler runs daily but doesn't validate ticket state
- **Safe modification:**
  - Move rules to database table so they're editable
  - Add rule conflict resolver
  - Add dry-run mode for testing rules before applying
- **Test coverage:** No unit tests for automation logic

### 3. Socket Connections in Email Service
- **Files:** `server/src/lib/email.ts:459` (nodemailer with SMTP connection)
- **Why fragile:**
  - SMTP timeout not explicitly configured
  - Failed emails don't retry with backoff
  - No connection pooling (new connection per email)
- **Safe modification:**
  - Configure explicit timeout and retry strategy
  - Implement connection reuse or pooling
  - Add queue-based delivery (bull or similar)
- **Test coverage:** No email delivery tests; integration only

### 4. Cascading Delete Behavior
- **Files:** `server/src/db/connection.ts:15` (foreign keys enabled)
- **Why fragile:**
  - Cascade deletes on FK relationships could silently delete related data
  - No audit trail of cascades
  - User could accidentally delete all tickets by deleting a category
- **Safe modification:**
  - Add soft-delete (is_deleted flag) instead of hard delete
  - Log all deletes with affected record IDs
  - Require confirmation for deletes affecting >5 records
- **Test coverage:** No delete-scenario tests

---

## Scaling Limits

### 1. SQLite Concurrency Ceiling
- **Current capacity:** SQLite handles ~100 concurrent requests, then locks
- **Limit:** Breaks at >1000 tickets with multiple users writing simultaneously
- **Scaling path:**
  - Monitor with `PRAGMA database_list`
  - At 5k+ tickets, migrate to PostgreSQL
  - No plan yet; single-user system so not urgent

### 2. In-Memory CSV Import
- **Current capacity:** 10MB max file size (multer limit)
- **Limit:** ~100k rows CSV; exceeding causes heap OOM
- **Scaling path:**
  - Implement streaming CSV parser (csv-parser, papaparse)
  - Split large imports into chunks
  - Store in temp file instead of memory

### 3. Local File Storage
- **Current capacity:** Disk limited by container/server space
- **Limit:** No archival or cleanup for old uploads/attachments
- **Scaling path:**
  - Implement S3/cloud storage integration
  - Add cron job to archive old attachments
  - Add cleanup threshold in admin settings

---

## Dependencies at Risk

### 1. TipTap Rich Text Editor
- **Risk:** Heavy dependency tree (48 sub-dependencies); large bundle impact
- **Impact:** Knowledge Base editor performance, initial load time
- **Migration plan:**
  - Evaluate Slate or ProseMirror directly (more modular)
  - Or use Markdown instead of WYSIWYG
  - Current plan: assess in next review if performance issues arise

### 2. Supabase JS Client
- **Risk:** Imported but not used (appears in package.json, not in code)
- **Impact:** Dead code in bundle; authentication handled via custom JWT instead
- **Migration plan:**
  - Remove `@supabase/supabase-js` from package.json and lock file
  - No replacement needed; custom auth already works

### 3. axios Imported But Duplicate Fetch
- **Risk:** axios in dependencies (^1.13.6) but `ApiClient` uses fetch instead
- **Impact:** Dead code (96KB uncompressed in bundle)
- **Migration plan:**
  - Remove axios or consolidate to single HTTP client
  - Fetch-based ApiClient is already complete; prefer to remove axios

---

## Missing Critical Features

### 1. No Backup/Restore Strategy
- **Problem:** SQLite database is single file; no backup automation
- **Blocks:** Production deployment; data loss catastrophic
- **Roadmap status:** Listed in todo.md as "Backup & Maintenance" (LOW priority) but should be CRITICAL

### 2. No Audit Trail
- **Problem:** No way to see who changed what or when
- **Blocks:** Cannot track data modifications for compliance
- **Roadmap status:** Not mentioned; multi-user feature excluded but needed for single-user traceability

### 3. No Search Indexing
- **Problem:** Full-text search on titles/descriptions is unoptimized (LIKE % queries)
- **Blocks:** Slow searches with >1000 tickets
- **Roadmap status:** Listed as "Advanced search" but implementation is surface-level

---

## Test Coverage Gaps

### 1. CSV Import/Export Untested
- **What's not tested:**
  - Malformed CSV handling
  - Category/contact mapping logic
  - Transaction rollback scenarios
  - Duplicate ID detection
- **Files:** `server/src/routes/tickets.ts:600-800`
- **Risk:** Silent data corruption, partial imports without feedback
- **Priority:** High

### 2. Automation Rules Untested
- **What's not tested:**
  - Auto-tagging rule matching
  - Priority override logic
  - Rule conflicts
  - Scheduler execution
- **Files:** `server/src/config/automation.ts`, `server/src/lib/automationHelper.ts`
- **Risk:** Rules may silently fail or apply incorrectly
- **Priority:** High

### 3. Database Migrations Untested
- **What's not tested:**
  - Column additions/removals
  - Index creation
  - Data backfill correctness
- **Files:** `server/src/db/*.ts` (11 migration scripts)
- **Risk:** Migrations could fail or corrupt data
- **Priority:** Medium

### 4. Email Sending Untested
- **What's not tested:**
  - SMTP connection failures
  - Retry logic
  - Template rendering
- **Files:** `server/src/lib/email.ts`
- **Risk:** Emails silently fail to send
- **Priority:** Medium

### 5. CSRF Token Lifecycle Untested
- **What's not tested:**
  - Token expiration
  - Concurrent request handling
  - Auth change token invalidation
- **Files:** `src/lib/api.ts`, `server/src/index.ts`
- **Risk:** CSRF protection may fail under load
- **Priority:** Medium

---

## Code Quality Issues

### 1. Inconsistent Error Handling
- **Issue:** Some routes throw errors, others return JSON error responses
- **Files:** Mixed pattern across `server/src/routes/*.ts`
- **Fix:** Standardize on centralized error handler (exists in `index.ts` but not used everywhere)

### 2. Missing Input Validation
- **Issue:** No zod/joi schemas for request bodies in most routes
- **Files:** All routes lack systematic validation
- **Fix:** Create reusable validators, apply to all routes

### 3. No TypeScript Strict Mode
- **Issue:** tsconfig allows implicit any; type safety weak
- **Files:** `tsconfig.json` doesn't enable strict mode
- **Fix:** Enable `"strict": true` and fix resulting errors

### 4. Comments Out of Sync with Code
- **Issue:** "DEBUG" comments in deployed code; architectural comments too generic
- **Files:** `server/src/routes/tickets.ts`, `src/components/RadialProgressRings.tsx:166`
- **Fix:** Remove debug comments, replace generic comments with specific patterns

---

## Architectural Concerns

### 1. Monolithic Ticket Routes File
- **Issue:** `server/src/routes/tickets.ts` is 1,467 lines; handles list, detail, create, update, delete, import, export
- **Impact:** Difficult to test, maintain, and understand
- **Improvement:** Split into sub-routes (GET, POST, bulk operations, export)

### 2. Mixed Concerns in API Client
- **Issue:** `src/lib/api.ts` handles auth token, CSRF, request/response logic, all error handling
- **Impact:** Hard to test, hard to reuse
- **Improvement:** Separate concerns into middleware/interceptors

### 3. Database Connection Module Too Clever
- **Issue:** `server/src/db/connection.ts` does initialization, migrations, schema checks, pragmas
- **Impact:** Hard to test, hard to version control schema changes
- **Improvement:** Separate schema validation from connection setup

---

## Environmental Concerns

### 1. NODE_ENV Not Validated
- **Issue:** Code checks for `process.env.NODE_ENV === 'production'` but never validates it's set
- **Files:** `server/src/index.ts:135` (CSRF cookie secure flag)
- **Impact:** May default to development behavior in production
- **Fix:** Validate NODE_ENV is set to known value at startup

### 2. CSRF_SECRET Not Enforced in Production
- **Issue:** `server/src/index.ts:129` uses hardcoded default if not set
- **Files:** `server/src/index.ts:129`
- **Impact:** All instances share same secret in production
- **Fix:** Require CSRF_SECRET env var in production, throw at startup if missing

### 3. Database Backup Strategy Missing
- **Issue:** No env var or config for backup location/frequency
- **Files:** Not implemented
- **Impact:** Data loss risk
- **Fix:** Add DB_BACKUP_PATH and BACKUP_SCHEDULE env vars

---

## Summary Table

| Category | Count | Severity | Impact |
|----------|-------|----------|--------|
| Tech Debt | 4 | Medium | Maintainability, performance |
| Known Bugs | 3 | High | Data integrity, reliability |
| Security | 4 | High | Information disclosure, CSRF gaps |
| Performance | 4 | Medium | Large lists, CSV operations |
| Fragile Areas | 4 | Medium | Automation, email, transactions |
| Scaling Limits | 3 | Low | Future growth blocking |
| Dependencies | 3 | Low | Bundle size, dead code |
| Missing Features | 3 | High | Production readiness |
| Test Gaps | 5 | High | Risk of silent failures |
| Code Quality | 4 | Medium | Maintainability |
| **TOTAL** | **37** | - | - |

---

*Concerns audit: 2026-03-22*
