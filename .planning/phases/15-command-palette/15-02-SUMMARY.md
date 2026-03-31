---
phase: 15-command-palette
plan: "02"
subsystem: frontend
tags: [command-palette, layout, recently-viewed, search]
dependency_graph:
  requires: ["15-01"]
  provides: ["CommandPalette wired into app", "GlobalSearch removed", "recently-viewed tracking live"]
  affects: ["src/components/Layout.tsx", "src/pages/TicketDetail.tsx", "src/pages/KBArticleDetail.tsx"]
tech_stack:
  added: []
  patterns: ["Cmd+K keyboard listener in Layout useEffect", "recentlyViewed.ts module called from detail pages"]
key_files:
  created: []
  modified:
    - src/components/Layout.tsx
    - src/pages/TicketDetail.tsx
    - src/pages/KBArticleDetail.tsx
  deleted:
    - src/components/GlobalSearch.tsx
decisions:
  - "addRecentlyViewedTicket called on ticket?.id + ticket?.title — waits for ticket data, not just id"
  - "addRecentlyViewedKB called inline in the data-fetch useEffect after setArticle(data)"
metrics:
  duration: "~10 minutes"
  completed: "2026-03-31"
  tasks: 2
  files: 4
---

# Phase 15 Plan 02: Wire CommandPalette into App Summary

**One-liner:** CommandPalette wired to Cmd+K in Layout, header trigger button replaces GlobalSearch, recently-viewed tracking added to TicketDetail and KBArticleDetail.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire CommandPalette into Layout and add recently-viewed tracking | 567fd24 | Layout.tsx, TicketDetail.tsx, KBArticleDetail.tsx |
| 2 | Delete GlobalSearch.tsx and clean up unused imports | ad1526a | GlobalSearch.tsx (deleted) |

## What Was Built

### Layout.tsx changes
- Removed `GlobalSearch`, `useTickets`, `useUsers`, `useCategories`, `useTags` imports and hook calls
- Added `CommandPalette` import, `useEffect` for Cmd+K/Ctrl+K listener, `paletteOpen` state
- Both mobile and desktop headers now render a trigger button (search icon + shortcut hint) that opens the palette
- `CommandPalette` rendered at the bottom of Layout's return, controlled by `paletteOpen`

### TicketDetail.tsx changes
- Added `addRecentlyViewedTicket` import from `@/lib/recentlyViewed`
- Replaced the old manual `localStorage.getItem('recently_viewed_tickets')` block with a single `addRecentlyViewedTicket(ticket.id, ticket.title)` call
- useEffect depends on `ticket?.id` and `ticket?.title` to ensure data is available before writing

### KBArticleDetail.tsx changes
- Added `addRecentlyViewedKB` import from `@/lib/recentlyViewed`
- Called `addRecentlyViewedKB(String(data.id), data.title)` inline in the article-fetch useEffect, right after `setArticle(data)`

### GlobalSearch.tsx
- Deleted — no remaining imports in `src/` reference it

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All features are fully wired.

## Verification

- `npx tsc --noEmit` passes with zero errors
- `GlobalSearch` grep in `src/` returns only the now-deleted file (no remaining imports)
- Layout.tsx contains `CommandPalette`, `paletteOpen`, `metaKey || e.ctrlKey`, `Ctrl+K`
- TicketDetail.tsx contains `addRecentlyViewedTicket` and does not contain `recently_viewed_tickets` string literal
- KBArticleDetail.tsx contains `addRecentlyViewedKB`

## Self-Check: PASSED

- [x] `src/components/Layout.tsx` exists and contains `CommandPalette`
- [x] `src/pages/TicketDetail.tsx` exists and contains `addRecentlyViewedTicket`
- [x] `src/pages/KBArticleDetail.tsx` exists and contains `addRecentlyViewedKB`
- [x] `src/components/GlobalSearch.tsx` does NOT exist (deleted)
- [x] Commits 567fd24 and ad1526a confirmed in git log
- [x] TypeScript compiles cleanly

## Checkpoint Pending

Task 3 is a `checkpoint:human-verify` — human browser verification of the complete Command Palette end-to-end.
