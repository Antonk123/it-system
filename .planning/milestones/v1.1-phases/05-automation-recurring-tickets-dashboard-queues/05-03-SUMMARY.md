---
phase: 05-automation-recurring-tickets-dashboard-queues
plan: 03
subsystem: ui, api
tags: [react, typescript, react-query, localstorage, express, sqlite]

requires:
  - phase: 05-automation-recurring-tickets-dashboard-queues
    provides: Filter views system (useFilterViews hook, FilterView type, localStorage persistence)

provides:
  - GET /api/tickets?countOnly=true endpoint returning { count: N } with full filter support
  - useDashboardQueues hook — localStorage-backed ordered list of FilterView references
  - Dashboard queue cards — user-defined filter view tiles with live counts, add/remove/reorder

affects:
  - Dashboard.tsx consumers
  - Any feature that queries ticket counts

tech-stack:
  added: []
  patterns:
    - countOnly short-circuit pattern — bypass expensive ticket fetch when only count needed
    - Queue-as-reference pattern — queues store filterViewId only; view resolution happens at render time
    - React Query per-card polling — staleTime 30s + refetchInterval 60s for live counts

key-files:
  created:
    - src/hooks/useDashboardQueues.ts
  modified:
    - server/src/routes/tickets.ts
    - src/pages/Dashboard.tsx

key-decisions:
  - "countOnly bypasses ticket fetch but runs full WHERE clause including JOINs for accurate filter counts"
  - "Queue editing is remove + re-add (queues are lightweight filterViewId references, no edit-in-place needed)"
  - "page=1&limit=1 added alongside countOnly to ensure buildWhereClause/pagination code path runs"

patterns-established:
  - "countOnly pattern: add to any list endpoint to get cheap counts from filters"
  - "Dashboard queue card: useQuery per card with staleTime/refetchInterval for live data"

requirements-completed: [DASH-01, DASH-02, DASH-03]

duration: 15min
completed: 2026-03-29
---

# Phase 05 Plan 03: Dashboard Queues Summary

**User-defined dashboard queue cards with live counts replace hardcoded aging groups — users pin any saved filter view and see a live ticket count with 30-second refresh.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-29T00:00:00Z
- **Completed:** 2026-03-29T00:15:00Z
- **Tasks:** 2 completed
- **Files modified:** 3 (tickets.ts, Dashboard.tsx, new useDashboardQueues.ts)

## Accomplishments

### Task 1: countOnly API + useDashboardQueues hook
- Added `countOnly=true` query param to `GET /api/tickets` — short-circuits after COUNT query, returns `{ count: N }`
- All existing filter parameters (status, priority, category, tags, tagMode, search, checklist, dateFrom, dateTo, dateField) apply to the count
- Created `src/hooks/useDashboardQueues.ts` — localStorage-backed hook storing `DashboardQueue[]` under key `dashboard-queues`
- Exposes `addQueue`, `removeQueue`, `reorderQueues`, `moveQueue` (up/down swap)
- Duplicate prevention: adding an already-present filterViewId is a no-op

### Task 2: Dashboard rework
- Removed hardcoded aging groups (>30d, 14-30d, 7-14d) and recentTickets section
- Added "Koer" section with a dialog-based picker to add queues from saved filter views
- Each `QueueCard` calls `GET /api/tickets?countOnly=true&{filterParams}` via React Query (staleTime: 30s, refetchInterval: 60s)
- Per-card hover controls: ChevronUp/ChevronDown for reorder, X for remove
- Clicking a card navigates to `/tickets?{params}` with the filter view's params
- Empty state shown when no queues are defined
- KPI cards, secondary stats, and critical alert bar remain unchanged

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing functionality] Added page/limit params alongside countOnly**
- **Found during:** Task 2 implementation
- **Issue:** The GET handler's `!usePagination` early-exit ran before buildWhereClause was reached when only countOnly was provided (no page/limit params)
- **Fix:** Modified the early-exit condition to `!usePagination && !countOnly` so countOnly requests also build the WHERE clause. QueueCard also passes `page=1&limit=1` in the query string as a belt-and-suspenders safety measure.
- **Files modified:** server/src/routes/tickets.ts, src/pages/Dashboard.tsx
- **Commit:** 32b4381

## Known Stubs

None. All queue data is wired to live API responses via React Query.

## Self-Check: PASSED

- FOUND: src/hooks/useDashboardQueues.ts
- FOUND: src/pages/Dashboard.tsx
- FOUND: server/src/routes/tickets.ts
- FOUND commit: 32b4381 (task 1)
- FOUND commit: b20f15e (task 2)
