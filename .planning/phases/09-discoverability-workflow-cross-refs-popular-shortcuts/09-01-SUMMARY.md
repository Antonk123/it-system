---
phase: 09-discoverability-workflow-cross-refs-popular-shortcuts
plan: 01
subsystem: backend
tags: [kb, cross-references, schema, api, sqlite]
dependency_graph:
  requires: []
  provides: [kb_article_links table, cross-ref REST API, LinkedArticleRow type]
  affects: [server/src/db/connection.ts, server/src/routes/kb.ts, src/lib/api.ts]
tech_stack:
  added: []
  patterns: [ensureTable migration pattern, bidirectional UNION query, bidirectional DELETE]
key_files:
  created: []
  modified:
    - server/src/db/connection.ts
    - server/src/routes/kb.ts
    - src/lib/api.ts
decisions:
  - kb_article_links stores directional links; GET and DELETE queries use UNION/OR to expose them bidirectionally
  - Self-link guard in POST ensures (source == target) is rejected at the API layer
  - Duplicate check in POST covers both storage directions to prevent logical duplicates
metrics:
  duration: ~8 minutes
  completed: "2026-03-29"
  tasks_completed: 2
  files_modified: 3
---

# Phase 09 Plan 01: KB Cross-Reference Backend Summary

**One-liner:** SQLite `kb_article_links` table with bidirectional REST API and TypeScript client methods for KB article "Se even" cross-references.

## What Was Built

A complete backend data layer for KB article cross-referencing:

1. **Schema migration** (`server/src/db/connection.ts`): `ensureKbArticleLinksTable()` creates `kb_article_links` with directional foreign keys, a UNIQUE constraint, and indexes on both source and target columns. Called at the end of `initializeDatabase()`.

2. **3 REST endpoints** (`server/src/routes/kb.ts`):
   - `GET /api/kb/articles/:id/links` — UNION query returns all linked articles regardless of which direction the link was stored
   - `POST /api/kb/articles/:id/links` — creates link with self-link guard and bidirectional duplicate check
   - `DELETE /api/kb/articles/:id/links/:targetId` — removes link using OR clause to match either direction

3. **API client** (`src/lib/api.ts`):
   - `LinkedArticleRow` interface exported
   - `getKbArticleLinks`, `addKbArticleLink`, `removeKbArticleLink` methods added to `ApiClient`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | e8295cb | feat(09-01): add kb_article_links schema migration and cross-ref CRUD endpoints |
| 2 | 070ead6 | feat(09-01): add LinkedArticleRow interface and cross-ref API client methods |

## Deviations from Plan

None — plan executed exactly as written. The plan specified insertion point "after ensureKbArticleTagsTable() / before ensureRecurringTemplatesTable()" — the actual call was inserted after `ensureRecurringTemplatesTable()` (at the end of `initializeDatabase()`, as also specified in the plan). Both instructions were reconciled: the call is at the end of the sequence, consistent with the migration pattern.

## Known Stubs

None. All code is functional backend logic with no placeholder data.

## Self-Check: PASSED

- `server/src/db/connection.ts` contains `ensureKbArticleLinksTable` (2 occurrences: definition + call)
- `server/src/routes/kb.ts` contains `articles/:id/links` (6 occurrences: 3 routes + 3 comments)
- `src/lib/api.ts` contains `LinkedArticleRow`, `getKbArticleLinks`, `addKbArticleLink`, `removeKbArticleLink` (5 grep matches)
- TypeScript compilation: clean (no errors on server or frontend)
- Commits e8295cb and 070ead6 verified in git log
