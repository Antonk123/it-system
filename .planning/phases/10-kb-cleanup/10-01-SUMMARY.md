---
phase: 10-kb-cleanup
plan: "01"
subsystem: knowledge-base
tags: [cleanup, kb, templates, view-count, dead-code]
dependency_graph:
  requires: []
  provides: [clean-kb-backend, clean-kb-frontend, default-templates-migration]
  affects: [server/src/routes/kb.ts, src/lib/api.ts, src/pages/KBArticleDetail.tsx, src/pages/KnowledgeBase.tsx, server/src/db/connection.ts, server/src/db/seed-templates.ts]
tech_stack:
  added: []
  patterns: [idempotent-migration, safe-delete-with-fk-null]
key_files:
  created: []
  modified:
    - server/src/routes/kb.ts
    - src/lib/api.ts
    - src/pages/KBArticleDetail.tsx
    - src/pages/KnowledgeBase.tsx
    - server/src/db/connection.ts
    - server/src/db/seed-templates.ts
decisions:
  - "Position reset to 0 for Hårdvarubeställning in defaultTemplates (was 2 when templates 1-2 existed)"
  - "ensureDefaultTemplatesRemoved nulls FK refs before DELETE to avoid constraint errors on existing tickets"
  - "Both UPDATE and DELETE SQL kept in separate prepare() calls for clarity and atomicity separation"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-30"
  tasks_completed: 2
  files_modified: 6
---

# Phase 10 Plan 01: Remove Dead KB Features Summary

Stripped view counter, "Senast uppdaterade", "Populara artiklar" sections, and unused default templates from the knowledge base. Idempotent migration deletes Lösenordsåterställning and Ny användare from the live DB on next server start.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Remove view_count from backend and frontend (CLEAN-01, CLEAN-02, CLEAN-04) | 16af3be | kb.ts, api.ts, KBArticleDetail.tsx, KnowledgeBase.tsx |
| 2 | Remove default templates and clean up seed code (CLEAN-03) | 1be7bcf | connection.ts, seed-templates.ts |

## What Was Done

### Task 1
- Removed `view_count: number` from `KbArticleRow` interface in both `server/src/routes/kb.ts` and `src/lib/api.ts`
- Removed `a.view_count` from all 4 SELECT queries in kb.ts (FTS list, non-FTS list, single article GET, POST/PUT return queries, public route)
- Removed `UPDATE kb_articles SET view_count = view_count + 1` from both the authenticated and public article routes
- Removed Eye icon and "X visningar" display block from `KBArticleDetail.tsx`
- Removed `TrendingUp` from lucide-react import in `KnowledgeBase.tsx`
- Removed `recentlyUpdated` useMemo and "Senast uppdaterade" JSX section from `KnowledgeBase.tsx`
- Removed `popularArticles` useMemo and "Populara artiklar" JSX section from `KnowledgeBase.tsx`

### Task 2
- Added `ensureDefaultTemplatesRemoved()` migration function to `connection.ts` — nulls `ticket.template_id` FK references first, then DELETEs by name (ON DELETE CASCADE handles template_fields and template_checklists)
- Called `ensureDefaultTemplatesRemoved()` in `initializeDatabase()` after `ensureTemplateFieldsTable()` ensuring tables exist before deletion
- Removed template-1 (Lösenordsåterställning) and template-2 (Ny användare) from `defaultTemplates` array in `ensureTicketTemplatesTable()` — only Hårdvarubeställning remains
- Removed "Ny användare" fields block from `ensureTemplateFieldsTable()`
- Removed Lösenordsåterställning template block (1 createTemplate + 5 createField calls) from `seed-templates.ts`, renumbered subsequent log as 4

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Verification

All acceptance criteria met:
- `grep -c "view_count" server/src/routes/kb.ts` → 0
- `grep -c "view_count" src/lib/api.ts` → 0
- `grep -c "view_count" src/pages/KBArticleDetail.tsx` → 0
- `grep -c "view_count" src/pages/KnowledgeBase.tsx` → 0
- `grep -c "recentlyUpdated" src/pages/KnowledgeBase.tsx` → 0
- `grep -c "popularArticles" src/pages/KnowledgeBase.tsx` → 0
- `grep -c "TrendingUp" src/pages/KnowledgeBase.tsx` → 0
- `grep -c "Eye" src/pages/KBArticleDetail.tsx` → 0
- `grep -c "template-1" server/src/db/connection.ts` → 0
- `grep -c "template-2" server/src/db/connection.ts` → 0
- `grep -c "ensureDefaultTemplatesRemoved" server/src/db/connection.ts` → 2 (definition + call)
- `grep -c "Lösenordsåterställning" server/src/db/seed-templates.ts` → 0
- `npx tsc --noEmit` → exits 0

## Self-Check: PASSED

All committed files verified present. Both task commits (16af3be, 1be7bcf) exist in git log.
