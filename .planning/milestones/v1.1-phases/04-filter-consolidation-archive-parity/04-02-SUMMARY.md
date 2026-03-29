---
phase: 04-filter-consolidation-archive-parity
plan: 02
subsystem: ui
tags: [react, typescript, tailwind, shadcn, filters, bulk-operations, archive, csv-export]

# Dependency graph
requires:
  - phase: 04-01
    provides: UnifiedFilterBar, ActiveFilterChips, DateRangePopover, useFilterViews with Archive context

provides:
  - TicketList.tsx refactored to single UnifiedFilterBar row (no legacy 5-section layout)
  - Archive.tsx with full filter parity via UnifiedFilterBar (status hidden, date locked to closed_at)
  - BulkActionBar floating action bar for Archive bulk operations
  - bulkDeleteTickets API method in src/lib/api.ts
  - POST /tickets/bulk-delete backend endpoint with transaction + attachment cleanup
affects:
  - Human verification checkpoint (Task 2 — live Docker test of all flows)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BulkActionBar always rendered in DOM, visibility controlled via translate-y transition — no mount/unmount flash"
    - "Client-side CSV export via Blob + anchor click — no server round-trip for export"
    - "Bulk delete uses db.transaction() wrapping per-ticket DELETE + file cleanup — atomicity and disk consistency"
    - "Archive selection cleared on filter/page changes via useEffect dependency array"

key-files:
  created:
    - src/components/BulkActionBar.tsx
  modified:
    - src/pages/TicketList.tsx
    - src/pages/Archive.tsx
    - src/lib/api.ts
    - server/src/routes/tickets.ts

key-decisions:
  - "BulkActionBar manages its own AlertDialog state — keeps Archive.tsx clean, dialog is an implementation detail of the bar"
  - "handleBulkExportCsv builds CSV client-side from in-memory ticket data — avoids extra API call for archived tickets already fetched"
  - "bulk-delete endpoint uses db.transaction() to ensure all deletes and file cleanups are atomic"
  - "Archive dateField is locked to closed_at as const — not a URL param, prevents users from accidentally querying wrong date field"

patterns-established:
  - "Bulk action bar pattern: fixed bottom, translate-y[200%] when hidden, translate-y-0 when visible — pure CSS visibility toggle"
  - "onBulkAction NOT passed to TicketTable in Archive — external BulkActionBar owns the action logic"

requirements-completed: [FILT-01, FILT-02, FILT-03, FILT-04, FILT-05]

# Metrics
duration: 15min
completed: 2026-03-26
---

# Phase 04 Plan 02: Wire UnifiedFilterBar + Archive Bulk Operations Summary

**UnifiedFilterBar wired into TicketList (single filter row) and Archive (status hidden, date locked), BulkActionBar with re-open/priority/CSV/permanent-delete, and POST /tickets/bulk-delete backend endpoint**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-26T11:40:00Z
- **Completed:** 2026-03-26T11:57:22Z
- **Tasks:** 1 (Task 2 is human-verify checkpoint)
- **Files modified:** 5

## Accomplishments

- Replaced TicketList's legacy 5-section filter layout with a single `<UnifiedFilterBar>` — no separate quick-filter buttons, date row, or chip sections remain
- Refactored Archive.tsx to add `useFilterViews`, `UnifiedFilterBar` (hideStatus + hideDateFieldSelector), full selection state, and all 4 bulk action handlers
- Created `BulkActionBar` floating action bar with slide-up CSS transition, AlertDialog for permanent delete confirmation
- Added `bulkDeleteTickets` API method calling POST /tickets/bulk-delete
- Added `router.post('/bulk-delete')` backend endpoint using `db.transaction()` with per-ticket attachment file cleanup

## Task Commits

1. **Task 1: Refactor TicketList/Archive, create BulkActionBar, add backend bulk-delete** - `f3ad998` (feat)

## Files Created/Modified

- `src/pages/TicketList.tsx` — Replaced all legacy filter sections with single `<UnifiedFilterBar>` component
- `src/pages/Archive.tsx` — Added UnifiedFilterBar (hideStatus), BulkActionBar, useFilterViews, all bulk handlers, selection state
- `src/components/BulkActionBar.tsx` — New: floating action bar with re-open, priority change, CSV export, permanent delete (AlertDialog)
- `src/lib/api.ts` — Added `bulkDeleteTickets(ids: string[]): Promise<{ deleted: number }>`
- `server/src/routes/tickets.ts` — Added `router.post('/bulk-delete', ...)` with db.transaction and attachment cleanup

## Decisions Made

- `BulkActionBar` owns its own `deleteDialogOpen` state — the AlertDialog is an implementation detail of the bar, not Archive's concern.
- CSV export runs entirely client-side from the already-fetched `tickets` array — no extra API call needed for a filtered export.
- `dateField` in Archive is a `const` (`'closed_at' as const`) not a URL param — locks the field immutably, preventing user-driven or preset-driven overrides.
- `onBulkAction` prop is intentionally NOT passed to `TicketTable` in Archive — the external `BulkActionBar` handles all bulk actions, avoiding duplication with TicketTable's inline bulk bar.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Task 2 (checkpoint:human-verify) requires live Docker rebuild and browser verification
- All code changes are in place; awaiting human sign-off on visual/functional correctness
- After human approval, Phase 04 is complete and Phase 05 can begin

---
*Phase: 04-filter-consolidation-archive-parity*
*Completed: 2026-03-26*
