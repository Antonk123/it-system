---
phase: 02-knowledge-base-rework
plan: 03
subsystem: ui
tags: [react, typescript, fts5, sqlite, shadcn]

# Dependency graph
requires:
  - phase: 02-knowledge-base-rework
    plan: 01
    provides: FTS5 search backend, article_type column, updated KB routes
  - phase: 02-knowledge-base-rework
    plan: 02
    provides: Linked Tickets backend route and KBArticleDetail panel

provides:
  - FTS5 search snippets with <mark> highlights rendered in KB list
  - Article type badge in KB list card (Instruktion / Losning)
  - Article type filter dropdown (Alla typer / Instruktion / Losning)
  - Article type selector in KBArticleForm (create and edit)
  - api.ts updated with article_type in getKbArticles, createKbArticle, updateKbArticle

affects: [any phase touching KnowledgeBase.tsx, KBArticleForm.tsx, src/lib/api.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - dangerouslySetInnerHTML for trusted FTS5 <mark> snippet HTML
    - Conditional snippet vs getPreview() based on article.snippet presence
    - TYPE_LABELS Record<string,string> constant for type display names
    - article_type 'none' sentinel in form state, converted to null on submit

key-files:
  created: []
  modified:
    - src/lib/api.ts
    - src/pages/KnowledgeBase.tsx
    - src/pages/KBArticleForm.tsx
    - src/server/connection.ts

key-decisions:
  - "dangerouslySetInnerHTML used for FTS5 snippet output — content is server-generated, not user input, safe to render"
  - "TYPE_LABELS constant maps how-to/solution to Swedish display names Instruktion/Losning at the component level"
  - "KB FTS5 migration wired into initializeDatabase() in connection.ts post-checkpoint (bugfix e238b08)"

patterns-established:
  - "Snippet vs excerpt pattern: article.snippet truthy → render with dangerouslySetInnerHTML; falsy → getPreview(article.content)"
  - "Type sentinel pattern: form uses 'none' as empty-state sentinel; payload maps 'none' → null before API call"

requirements-completed: [KB-01, KB-05]

# Metrics
duration: ~35min
completed: 2026-03-22
---

# Phase 02 Plan 03: KB Frontend — Snippets, Type Badges, and Type Filter Summary

**FTS5 search snippets with `<mark>` highlights, article type badge/filter in KB list, and optional type selector in article form wired end-to-end**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-03-22T09:03:23Z
- **Completed:** 2026-03-22 (post-checkpoint approval)
- **Tasks:** 4 (including human-verify checkpoint)
- **Files modified:** 4

## Accomplishments

- Updated `api.ts` to pass `article_type` in all three KB API methods (getKbArticles, createKbArticle, updateKbArticle)
- Rewired KB list article cards to show FTS5 highlighted snippets during search and plain excerpts when idle, plus conditional type badge next to category badge
- Added type filter dropdown (Alla typer / Instruktion / Losning) to KB list filter bar
- Added optional type selector (Ingen typ / Instruktion / Losning) to KBArticleForm, loaded on edit and submitted with payload
- Bugfix: wired FTS5 migration and article_type column migration into `initializeDatabase()` so schema initializes correctly on container start

## Task Commits

Each task was committed atomically:

1. **Task 1: Update api.ts methods for article_type param** — `b34d3de` (feat)
2. **Task 2: Add snippet display, type badge, and type filter to KnowledgeBase.tsx** — `c226631` (feat)
3. **Task 3: Add article_type selector to KBArticleForm** — `d038e90` (feat)
4. **Task 4: Verify complete KB rework** — checkpoint approved by human
5. **Bugfix: Wire KB FTS5 migration into initializeDatabase** — `e238b08` (fix, post-checkpoint)

## Files Created/Modified

- `src/lib/api.ts` — Added `article_type` to getKbArticles params, createKbArticle and updateKbArticle data types
- `src/pages/KnowledgeBase.tsx` — Snippet display, TYPE_LABELS constant, type badge, type filter dropdown
- `src/pages/KBArticleForm.tsx` — articleType state, type Select field, setArticleType on edit load, article_type in submit payload
- `src/server/connection.ts` — FTS5 virtual table migration and article_type column migration wired into initializeDatabase()

## Decisions Made

- Used `dangerouslySetInnerHTML` for FTS5 snippet output — the snippet HTML is server-generated (not user input) so rendering `<mark>` tags is safe
- TYPE_LABELS maps the internal how-to/solution values to the Swedish display labels at the component level, keeping the DB values stable
- Form uses `'none'` as sentinel for "no type selected" and maps it to `null` in the submit payload, matching the existing category_id pattern

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] KB FTS5 migration not wired into initializeDatabase()**
- **Found during:** Post-checkpoint verification (commit e238b08 — after human approval)
- **Issue:** The FTS5 virtual table creation and article_type column addition were defined but never called in the database initialization path, so the schema would not be present on a fresh container start
- **Fix:** Added calls to the FTS5 migration and article_type migration inside `initializeDatabase()` in `src/server/connection.ts`
- **Files modified:** `src/server/connection.ts`
- **Verification:** Docker rebuild confirms schema initializes correctly
- **Committed in:** `e238b08`

---

**Total deviations:** 1 auto-fixed (blocking — missing wiring)
**Impact on plan:** Essential correctness fix. Without it, the FTS5 table and article_type column would be absent after a fresh deploy. No scope creep.

## Issues Encountered

None during the three planned tasks. The post-checkpoint bugfix (e238b08) was a deployment correctness issue discovered separately and resolved before the plan was marked complete.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 02 Knowledge Base rework is complete: FTS5 search with highlighted snippets (KB-01), Linked Tickets reverse lookup panel (KB-02/KB-03/KB-04), and article type classification (KB-05) are all live
- No blockers for Phase 03

---
*Phase: 02-knowledge-base-rework*
*Completed: 2026-03-22*
