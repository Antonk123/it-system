---
phase: 02-knowledge-base-rework
plan: 01
subsystem: database
tags: [sqlite, fts5, full-text-search, migration, better-sqlite3]

# Dependency graph
requires: []
provides:
  - FTS5 virtual table kb_articles_fts with title and content_plain columns
  - Delete trigger kb_articles_fts_delete for automatic FTS sync on article deletion
  - article_type column on kb_articles (how-to / solution CHECK constraint)
  - FTS5-backed search in GET /api/kb/articles?search= with <mark> snippets
  - article_type field flowing through all KB article CRUD endpoints
  - stripHtml helper in kb.ts for HTML-stripped FTS indexing
affects: [02-02, 02-03, frontend KB search UI, public article endpoint]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FTS5 content='' (contentless) mode with Node.js-side HTML stripping before insert"
    - "rowid join pattern: a.rowid = fts.rowid (UUID id vs integer rowid distinction)"
    - "Double-quoting FTS5 input: '\"' + term.replace(/\"/g, '\"\"') + '\"' for safe phrase matching"
    - "db.transaction() wrapping article INSERT/UPDATE to keep kb_articles and kb_articles_fts in sync"

key-files:
  created:
    - server/src/db/add-kb-fts5-and-type.ts
  modified:
    - server/src/routes/kb.ts

key-decisions:
  - "FTS5 contentless mode (content='') chosen: avoids data duplication, requires explicit FTS insert/update/delete but delete is handled by trigger"
  - "HTML stripping in Node.js (stripHtml function), not SQLite trigger — triggers cannot call external JS code"
  - "FTS5 input sanitized via double-quoting entire term as phrase, not token-by-token — prevents false matches on special chars"
  - "article_type CHECK constraint: only 'how-to' and 'solution' values accepted at DB level"

patterns-established:
  - "Standalone migration script pattern: import db from connection.js, guard with sqlite_master check, PRAGMA table_info for column guard, process.exit(0/1)"
  - "FTS sync pattern: POST/PUT use db.transaction() to write both kb_articles and kb_articles_fts atomically; DELETE uses trigger"

requirements-completed: [KB-01, KB-02, KB-05]

# Metrics
duration: 4min
completed: 2026-03-22
---

# Phase 02 Plan 01: FTS5 Full-Text Search + article_type Foundation Summary

**SQLite FTS5 virtual table replacing LIKE search: ranked results with `<mark>` snippets, HTML-stripped indexing, article_type column with CHECK constraint wired through all KB CRUD**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T09:53:51Z
- **Completed:** 2026-03-22T09:57:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `kb_articles_fts` FTS5 virtual table in contentless mode with unicode61 tokenizer
- Added `kb_articles_fts_delete` trigger for automatic FTS cleanup when articles are deleted
- Added `article_type` column with `CHECK(article_type IN ('how-to', 'solution'))` to `kb_articles`
- Migration script is fully idempotent — safe to re-run in production
- Replaced LIKE-based search with FTS5 MATCH query returning ranked results and `snippet()` highlights
- Both POST and PUT article routes now sync the FTS table atomically via `db.transaction()`
- `article_type` flows through GET list, GET single, POST, PUT, and public article endpoints

## Task Commits

Each task was committed atomically:

1. **Task 1: Create FTS5 + article_type migration script** - `8f5cedb` (feat)
2. **Task 2: Update kb.ts routes for FTS5 search and article_type CRUD** - `9d3f458` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `server/src/db/add-kb-fts5-and-type.ts` - Standalone migration: creates kb_articles_fts virtual table, delete trigger, article_type column, backfills FTS from existing articles
- `server/src/routes/kb.ts` - Updated KB routes: FTS5 search with snippet(), article_type in all CRUD, FTS sync in POST/PUT transactions

## Decisions Made

- FTS5 contentless mode (`content=''`) chosen over content-table mode: avoids data duplication, requires explicit FTS maintenance but delete is handled by a trigger — the only "surprise" is that UPDATE needs explicit delete+re-insert (no UPDATE command in FTS5)
- HTML stripping done in Node.js (`stripHtml` function) not in a SQLite trigger — SQLite triggers cannot call external code
- FTS5 input sanitized by wrapping the entire search term as a quoted phrase (`"term"`) rather than token-by-token — prevents FTS5 syntax errors on special characters while keeping phrase-matching semantics
- `article_type` CHECK constraint enforced at DB level, not just application level — consistent with existing `field_type` pattern in `template_fields` table

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed extra TS2345 error introduced by strongly-typed transaction callback**
- **Found during:** Task 2 (Update kb.ts routes)
- **Issue:** Passing `req.params.id` (typed as `string | string[]` in Express types) to a `db.transaction()` callback that explicitly types its first arg as `string` caused a new TS2345 error not present in the original
- **Fix:** Added `as string` cast: `const articleId = req.params.id as string` — consistent with how the codebase handles the same Express typing limitation elsewhere
- **Files modified:** server/src/routes/kb.ts
- **Verification:** Error count in kb.ts returned to 17 (matching original)
- **Committed in:** 9d3f458 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary fix for type correctness parity with the original file. No scope creep.

## Issues Encountered

- Server `node_modules` not installed locally (project runs in Docker). Had to run `npm install` in the server directory and create a local `data/` directory to execute the migration script for verification. The test DB was empty so base KB tables needed creating first — this is the expected production order (add-kb-tables.ts runs at server startup via `initializeDatabase()`).

## User Setup Required

None - no external service configuration required.

The migration script `server/src/db/add-kb-fts5-and-type.ts` must be run once against the production database after the Docker image is rebuilt. It is idempotent and safe to run multiple times.

## Next Phase Readiness

- FTS5 backend is complete and ready for frontend KB search UI (plan 02-02 or later)
- `article_type` schema is in place for frontend article type filtering
- All KB CRUD endpoints are backward-compatible: clients not sending `article_type` will receive `null` in that field

---
*Phase: 02-knowledge-base-rework*
*Completed: 2026-03-22*

## Self-Check: PASSED

- FOUND: server/src/db/add-kb-fts5-and-type.ts
- FOUND: server/src/routes/kb.ts
- FOUND: .planning/phases/02-knowledge-base-rework/02-01-SUMMARY.md
- FOUND commit: 8f5cedb (feat: FTS5 migration)
- FOUND commit: 9d3f458 (feat: kb.ts routes update)
