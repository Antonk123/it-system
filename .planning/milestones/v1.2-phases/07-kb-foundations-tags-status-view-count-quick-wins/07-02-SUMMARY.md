---
phase: 07-kb-foundations-tags-status-view-count-quick-wins
plan: 02
subsystem: ui
tags: [react, typescript, kb, tags, tiptap, shadcn]

requires:
  - phase: 07-01
    provides: "Backend API with tags[], status, view_count fields; getKbArticles(?tag), createKbArticle(tags, status), updateKbArticle(tags, status)"

provides:
  - "KBArticleForm: tag input (Enter/comma to add, X to remove, Backspace removes last) + status dropdown (Publicerad/Utkast)"
  - "KBArticleForm: tags and status included in createKbArticle/updateKbArticle API payloads"
  - "KnowledgeBase list: tag filter dropdown populated from article tags (no extra API call)"
  - "KnowledgeBase list: Senast uppdaterade section — top 5 recently updated articles when no filters active"
  - "KBArticleDetail: view count with Eye icon and Swedish plural (visning/visningar)"
  - "KBArticleDetail: print button (Skriv ut) using window.print() with data-print-hide"
  - "KBArticleDetail: article tags displayed as secondary badges"
  - "KBArticleDetail: amber draft indicator badge when article.status === 'draft'"

affects:
  - "Phase 8 (KB search improvements — tag display already wired)"
  - "Phase 9 (popular articles — view_count display already wired)"

tech-stack:
  added: []
  patterns:
    - "Tag input as inline chip editor inside a bordered div — no external dependency, Enter/comma to confirm, X to remove, Backspace removes last chip"
    - "availableTags derived via useMemo from loaded articles — no extra API call, derives from existing response data"
    - "recentlyUpdated derived via useMemo sort on updated_at — conditional render behind hasActiveFilters guard"
    - "Print button pattern: onClick={window.print()} + className='print:hidden' + data-print-hide"

key-files:
  created: []
  modified:
    - "src/pages/KBArticleForm.tsx — tag input, status select, tags/status in API payload, edit-mode initialization"
    - "src/pages/KnowledgeBase.tsx — tagFilter state, availableTags memo, recentlyUpdated memo, hasActiveFilters, tag select UI, Senast uppdaterade section"
    - "src/pages/KBArticleDetail.tsx — Printer/Eye imports, print button, view count, tags badges, draft indicator"

key-decisions:
  - "Tag input implemented inline (chip-style div) rather than a third-party component — keeps dependencies minimal"
  - "availableTags derived from already-loaded articles (no extra API call) — consistent with tagFilter as single-select pattern from Plan 01"
  - "recentlyUpdated shown only when hasActiveFilters is false — avoids confusing users who filtered and see unrelated articles in the section"
  - "Draft indicator added to detail page so authors know when viewing an unpublished article via direct link"

patterns-established:
  - "Tag chip editor: state tags[] + tagInput string, handleTagKeyDown for Enter/comma/Backspace, removeTag for X buttons"
  - "Derived filter options via useMemo from loaded data: avoids extra API calls for small auxiliary data"

requirements-completed: [ORG-01, ORG-02, ORG-03, QUAL-01, DISC-01, WF-01]

duration: 12min
completed: 2026-03-29
---

# Phase 07 Plan 02: KB Frontend — Tags, Status, View Count, Print Summary

**Tag input in article form, tag/status filter on KB list, recently-updated section, and view count + print button + draft indicator on article detail — all six Phase 7 requirements delivered.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-29T07:40:00Z
- **Completed:** 2026-03-29T07:52:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- KBArticleForm gets full tag input (chip-style Enter/comma/Backspace/X UX) and a status dropdown alongside the existing type selector
- KB list page gains a tag filter dropdown (derived from loaded article data, no extra API call) and a "Senast uppdaterade" section showing top 5 recently updated articles when no filters are active
- KB article detail page shows view count with Eye icon, print button (window.print, hidden in print output), article tags as badges, and amber draft badge when status is draft

## Task Commits

1. **Task 1: Add tag input and status toggle to KBArticleForm** — `023bbcc` (feat)
2. **Task 2: Add tag filter and recently updated section to KB list** — `1f5cd54` (feat)
3. **Task 3: Add view count, print button, tags display to KBArticleDetail** — `31d5121` (feat)

## Files Created/Modified
- `src/pages/KBArticleForm.tsx` — Tag chip input, status select dropdown, tags+status in both create/update API calls, edit-mode initialization from article data
- `src/pages/KnowledgeBase.tsx` — tagFilter state + API param, availableTags useMemo from articles, recentlyUpdated useMemo, hasActiveFilters conditional, Senast uppdaterade Link list
- `src/pages/KBArticleDetail.tsx` — Printer/Eye icons, print button with data-print-hide, view count display, tags badges, draft indicator badge

## Decisions Made
- Tag input uses an inline chip-style `div` (no third-party component) — minimal dependencies, consistent with project simplicity principle
- `availableTags` derived from already-loaded articles via `useMemo` — no extra API call since list endpoint returns `tags[]` per article from Plan 01
- "Senast uppdaterade" section hidden when `hasActiveFilters` is truthy — prevents confusion when user applies filters and sees unrelated recent articles above results
- Draft indicator added to detail page so the author knows they're viewing an unpublished article when navigating via direct `/kb/:id` link

## Deviations from Plan

None — plan executed exactly as written. Type/status selectors were placed in a flex row (side by side) for more compact layout, which is a minor presentation choice within the spec's intent.

## Issues Encountered
None. TypeScript check (`npx tsc --noEmit`) passes clean with no errors.

## User Setup Required
None — no external service configuration required. Docker image must be rebuilt to apply Plan 01's backend migrations and serve the updated frontend.

## Next Phase Readiness
- All six Phase 7 requirements are now complete (ORG-01, ORG-02, ORG-03, QUAL-01, DISC-01, WF-01)
- Phase 8 (KB search improvements) can build on tags infrastructure now fully wired in UI
- Phase 9 (popular articles) can use view_count which is already displayed on the detail page

---
*Phase: 07-kb-foundations-tags-status-view-count-quick-wins*
*Completed: 2026-03-29*
