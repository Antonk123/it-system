---
phase: 07-kb-foundations-tags-status-view-count-quick-wins
plan: 01
subsystem: database, api
tags: [sqlite, better-sqlite3, express, kb, fts5, migration]

requires:
  - phase: 02-knowledge-base-rework
    provides: "kb_articles table, FTS5 virtual table, article_type column, kb routes in kb.ts"

provides:
  - "ensureKbV2Columns migration: status TEXT DEFAULT 'published', view_count INTEGER DEFAULT 0 on kb_articles"
  - "ensureKbArticleTagsTable migration: kb_article_tags join table with UNIQUE(article_id, tag) and indexes"
  - "GET /api/kb/articles: filters to published-only, supports ?tag= param, returns tags[] per article"
  - "GET /api/kb/articles/:id: returns status, view_count, tags[]; increments view_count on read"
  - "POST /api/kb/articles: accepts tags[], status; inserts tags in transaction"
  - "PUT /api/kb/articles/:id: accepts tags[], status; replaces tags atomically in transaction"
  - "GET /api/kb/public/:token: returns status, view_count+1, tags[]; increments view_count on public read"
  - "KbArticleRow interface updated with status, view_count, tags fields"
  - "API client methods updated: getKbArticles(?tag), createKbArticle(tags, status), updateKbArticle(tags, status)"

affects:
  - "07-02-PLAN (frontend KB pages that depend on these backend contracts)"
  - "Phase 8 (KB search improvements using kb_article_tags index)"
  - "Phase 9 (popular articles using view_count)"

tech-stack:
  added: []
  patterns:
    - "ensureKbV2Columns/ensureKbArticleTagsTable follow established ensure* idempotent migration pattern in connection.ts"
    - "Tags stored in kb_article_tags join table with freeform text — separate from ticket tags"
    - "GROUP_CONCAT subquery for tag aggregation in list endpoint; separate SELECT for detail endpoint"
    - "Tags replaced atomically inside existing db.transaction() in PUT route"
    - "view_count increment after SELECT to confirm article exists before counting"

key-files:
  created: []
  modified:
    - "server/src/db/connection.ts — ensureKbV2Columns(), ensureKbArticleTagsTable(), both called in initializeDatabase()"
    - "server/src/routes/kb.ts — all KB routes updated for tags, status, view_count, tag filter"
    - "src/lib/api.ts — KbArticleRow interface + getKbArticles/createKbArticle/updateKbArticle signatures"

key-decisions:
  - "KB article tags are freeform text in a join table (no master tags table) — separate from ticket tags"
  - "GET /api/kb/articles/:id returns any article regardless of status (direct link for author); list/FTS filter to published-only"
  - "view_count incremented on both authenticated detail view and public share token view"
  - "Tag filter is single-select (?tag=value) matching existing category/type filter pattern"

patterns-established:
  - "Tags join table pattern: UNIQUE(article_id, tag) + INSERT OR IGNORE prevents duplicates; DELETE+INSERT replaces atomically"
  - "GROUP_CONCAT tags_csv mapped to tags[] array in route handler after query"

requirements-completed: [ORG-01, ORG-02, ORG-03, QUAL-01]

duration: 8min
completed: 2026-03-29
---

# Phase 07 Plan 01: KB Foundations — Tags, Status, View Count Summary

**Backend data model for KB article tags (freeform join table), draft/published status, view count increment, and tag-based filtering — all routes updated, TypeScript interfaces aligned.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-29T07:29:29Z
- **Completed:** 2026-03-29T07:37:43Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Schema migration adds `status` + `view_count` columns idempotently to `kb_articles`, creates `kb_article_tags` join table
- All 5 affected KB routes updated: list (both FTS and standard branches), detail, create, update, public share
- TypeScript interface `KbArticleRow` and API client methods fully aligned with new backend contract

## Task Commits

1. **Task 1: Schema migration — add status, view_count columns and kb_article_tags table** - `57ecf7e` (feat)
2. **Task 2: Update KB routes and API client for tags, status, view_count, tag filter** - `55acb2b` (feat)

## Files Created/Modified
- `server/src/db/connection.ts` — `ensureKbV2Columns()` and `ensureKbArticleTagsTable()` added, both wired into `initializeDatabase()`
- `server/src/routes/kb.ts` — All KB routes updated for tags, status filtering, view_count increment, tag-based filtering
- `src/lib/api.ts` — `KbArticleRow` interface updated with `status`, `view_count`, `tags`; API method signatures extended

## Decisions Made
- GET /api/kb/articles/:id returns the article regardless of status (drafts accessible via direct link to author); only the list/search endpoint filters to published
- view_count is incremented on public share reads too — every view is a real read
- Tag filter is single-select for Phase 7 (consistent with category/type filter UX); multi-select deferred
- Tags stored as freeform lowercase text in join table — no master kb_tags table needed

## Deviations from Plan

None — plan executed exactly as written. One minor addition: updated the local `KbArticleRow` interface inside `server/src/routes/kb.ts` to match the new columns (not specified in the plan but required for type consistency).

## Issues Encountered
None. Pre-existing TypeScript errors from missing `node_modules` in worktree were confirmed as pre-existing (not caused by changes).

## User Setup Required
None — no external service configuration required. Docker image must be rebuilt to apply migrations on next container start.

## Next Phase Readiness
- Backend contract complete: tags[], status, view_count all return correctly from API
- `07-02-PLAN.md` (frontend) can now wire KBArticleForm tag input, status toggle, and view count display
- All six Phase 7 requirements' backend dependencies are satisfied

---
*Phase: 07-kb-foundations-tags-status-view-count-quick-wins*
*Completed: 2026-03-29*
