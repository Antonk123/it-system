---
phase: 08-content-quality-toc-templates-staleness
plan: "01"
subsystem: knowledge-base
tags: [kb, staleness, migration, review, sqlite]
dependency_graph:
  requires: []
  provides: [kb-staleness-feature]
  affects: [KnowledgeBase.tsx, KBArticleDetail.tsx, kb.ts, connection.ts]
tech_stack:
  added: []
  patterns: [additive-migration, named-params-sqlite, julianday-staleness]
key_files:
  created: []
  modified:
    - server/src/db/connection.ts
    - server/src/routes/kb.ts
    - src/lib/api.ts
    - src/pages/KnowledgeBase.tsx
    - src/pages/KBArticleDetail.tsx
decisions:
  - "COALESCE(last_reviewed_at, created_at) used for staleness baseline so never-reviewed articles fall back to created_at"
  - "Review button placed in metadata flex row (not action bar) to avoid crowding 4 existing action buttons"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-29"
  tasks_completed: 2
  files_modified: 5
---

# Phase 8 Plan 1: KB Staleness Detection Summary

**One-liner:** SQLite migration adds `last_reviewed_at` to kb_articles; PATCH review endpoint + stale filter SQL + amber badge + review button complete end-to-end staleness tracking.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Backend — migration, PATCH endpoint, stale filter SQL | 15595b3 | server/src/db/connection.ts, server/src/routes/kb.ts |
| 2 | Frontend — API client, stale filter toggle, stale badge, review button | 3c3ab5b | src/lib/api.ts, src/pages/KnowledgeBase.tsx, src/pages/KBArticleDetail.tsx |

## What Was Built

### Backend (Task 1)

- **Migration (`ensureKbReviewColumn`)**: Idempotent `ALTER TABLE kb_articles ADD COLUMN last_reviewed_at TEXT` called in `initializeDatabase()` after `ensureKbArticleTagsTable()`.
- **PATCH `/api/kb/articles/:id/review`**: Checks article exists (404 if not), sets `last_reviewed_at = new Date().toISOString()`, returns `{ last_reviewed_at }`.
- **Stale filter in GET `/api/kb/articles`**: Both FTS and standard branches receive `stale` query param. When truthy, adds `AND (@stale IS NULL OR (julianday('now') - julianday(COALESCE(a.last_reviewed_at, a.created_at))) > 90)`.
- **Single article GET**: `a.last_reviewed_at` added to SELECT column list.

### Frontend (Task 2)

- **`KbArticleRow.last_reviewed_at?: string | null`**: Added to type definition.
- **`getKbArticles({ stale?: boolean })`**: Extended with stale param that sets `?stale=1` in query string.
- **`reviewKbArticle(id)`**: New PATCH method on ApiClient.
- **KnowledgeBase stale toggle**: `Switch` + `Label` "Visa inaktuella" in filter bar; state `staleFilter` in `fetchArticles` deps, `hasActiveFilters`, and param build.
- **isStale helper**: `(Date.now() - new Date(ref).getTime()) / (86400 * 1000) > 90` — uses `last_reviewed_at || created_at` as reference.
- **Amber "Inaktuell" badge**: `border-amber-500/50 text-amber-600` with AlertTriangle icon in article card badge cluster.
- **Review button in article detail**: Ghost button in metadata flex row. Shows "Markera som granskad" or "Granskad {date}" when already reviewed. Updates article state optimistically on success.

## Decisions Made

1. **COALESCE(last_reviewed_at, created_at) for staleness**: Never-reviewed articles fall back to `created_at` as their staleness baseline — satisfies D-14 requirement without special-casing nulls in frontend.

2. **Review button in metadata row, not action bar**: Action bar already has 4 buttons (Print, Share, Edit, Delete). Placing review button in the metadata flex row keeps it near the date context and avoids crowding.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The staleness feature is fully wired: DB column exists, API returns it, frontend renders it, and the review action updates it end-to-end.

## Self-Check: PASSED

- `server/src/db/connection.ts` contains `const ensureKbReviewColumn` at line 465
- `server/src/db/connection.ts` contains `ensureKbReviewColumn()` call at line 526
- `server/src/routes/kb.ts` contains `router.patch('/articles/:id/review'` at line 356
- `server/src/routes/kb.ts` contains `julianday.*COALESCE.*last_reviewed_at` in 2 places (lines 176, 192)
- `src/lib/api.ts` KbArticleRow contains `last_reviewed_at` at line 1141
- `src/lib/api.ts` contains `async reviewKbArticle(id: string)` at line 796
- `src/pages/KnowledgeBase.tsx` contains `staleFilter` state, deps, hasActiveFilters
- `src/pages/KnowledgeBase.tsx` contains "Inaktuell" badge text at line 425
- `src/pages/KBArticleDetail.tsx` contains `handleMarkReviewed` at line 101
- `src/pages/KBArticleDetail.tsx` contains "Markera som granskad" at line 263
- TypeScript build: clean (no errors)
- Commits verified: 15595b3, 3c3ab5b
