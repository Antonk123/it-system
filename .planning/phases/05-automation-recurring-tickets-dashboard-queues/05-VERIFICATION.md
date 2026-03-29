---
phase: 05-automation-recurring-tickets-dashboard-queues
verified: 2026-03-29T04:00:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
gaps: []
resolved_gaps:
  - truth: "Each queue card shows the filter view name and a live ticket count"
    status: resolved
    fix: "Replaced api.get() with api.request() in QueueCard queryFn (commit 6cfc716)"
human_verification:
  - test: "Navigate to Dashboard and add a queue from a saved filter view"
    expected: "Queue card appears with a non-zero count matching the filter, updates on 30s stale timeout"
    why_human: "api.get runtime failure only surfaces in the browser — TypeScript compiles clean due to permissive tsconfig"
  - test: "Create a recurring template (daily), wait for the scheduler to fire (up to 1 minute), then check the template's history"
    expected: "A new ticket appears in the history list with a clickable link and the template's last_run updates"
    why_human: "Scheduler behavior requires live Docker environment with real clock advancement"
  - test: "Navigate to /recurring, create a template, pause it, then resume it"
    expected: "Status badge toggles between Aktiv/Pausad, next_run updates on resume"
    why_human: "Toggle mutation behavior requires live API"
---

# Phase 05: Automation — Recurring Tickets & Dashboard Queues Verification Report

**Phase Goal:** Users can automate ticket creation on a schedule and see smart queues on the Dashboard without manual searching
**Verified:** 2026-03-29T04:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|---------|
| 1  | recurring_templates and recurring_ticket_history tables exist in SQLite after server start | VERIFIED | `ensureRecurringTemplatesTable()` defined in `connection.ts` (line 405) and called in `initializeDatabase()` (line 488); both CREATE TABLE statements present |
| 2  | POST /api/recurring creates a template and returns it with a computed next_run | VERIFIED | `router.post('/', authenticate, ...)` in `recurring.ts` — validates name/title/interval_type, calls `computeNextRun`, inserts row, returns 201 with full object |
| 3  | GET /api/recurring returns all templates with their last 10 history entries | VERIFIED | `router.get('/', authenticate, ...)` — SELECT all templates, per-template JOIN query with LIMIT 10, tags JSON.parsed to array |
| 4  | PUT /api/recurring/:id updates a template including pause/resume toggle | VERIFIED | `router.put('/:id', authenticate, ...)` — 404 guard, dynamic field merge, recomputes next_run on interval change or resume, returns updated row with history |
| 5  | DELETE /api/recurring/:id removes a template and its history | VERIFIED | `router.delete('/:id', authenticate, ...)` — 404 guard, DELETE cascades via FK ON DELETE CASCADE |
| 6  | The recurring scheduler runs every minute, finds due active templates, creates tickets, and records history | VERIFIED | `startRecurringScheduler()` registers `cron.schedule('* * * * *', ...)`, `processRecurringTemplates()` queries `WHERE is_active = 1 AND next_run <= ?`, `createTicketFromTemplate()` runs a db.transaction inserting tickets/tags/history/recurring_history and updating next_run |
| 7  | Dashboard queue cards each show a live ticket count via countOnly API | FAILED | `QueueCard` in `Dashboard.tsx` (line 58) calls `api.get<{ count: number }>()` but `ApiClient` has no `.get()` method — only `.request()` and named domain methods. TypeScript misses this because `noImplicitAny: false`. At runtime `api.get is not a function` |

**Score:** 6/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/db/connection.ts` | ensureRecurringTemplatesTable migration | VERIFIED | Function at line 405, called at line 488, creates both tables and two indexes |
| `server/src/lib/recurringScheduler.ts` | Background scheduler creating tickets from templates | VERIFIED | 180 lines, exports `startRecurringScheduler` and `computeNextRun`, cron every minute, full transaction logic |
| `server/src/routes/recurring.ts` | CRUD + history API for recurring templates | VERIFIED | 249 lines, all 5 routes with authenticate middleware, computeNextRun imported from scheduler |
| `server/src/index.ts` | Scheduler and route registration | VERIFIED | `startRecurringScheduler()` called at line 66, `app.use('/api/recurring', recurringRoutes)` at line 186 |
| `src/pages/Recurring.tsx` | Full recurring templates management page | VERIFIED | 656 lines, all required UI elements present (Dialog, AlertDialog, TemplateCard, history section) |
| `src/hooks/useRecurringTemplates.ts` | React Query CRUD hook | VERIFIED | 102 lines, exports `useRecurringTemplates` with all 5 mutations, uses `api.request()` correctly |
| `src/components/Layout.tsx` | Updated sidebar with Aterkommande nav item | VERIFIED | RefreshCw imported, `{ path: '/recurring', icon: RefreshCw, label: 'Återkommande' }` in navItems |
| `src/App.tsx` | Route for /recurring | VERIFIED | `import Recurring from './pages/Recurring'`, `<Route path="/recurring" element={<ProtectedRoute><Recurring /></ProtectedRoute>} />` |
| `src/hooks/useDashboardQueues.ts` | localStorage-backed hook for queue definitions | VERIFIED | 54 lines, STORAGE_KEY = 'dashboard-queues', exports `useDashboardQueues` with addQueue/removeQueue/reorderQueues/moveQueue |
| `src/pages/Dashboard.tsx` | Reworked dashboard with queue cards | PARTIAL | agingGroups/agingTickets removed, QueueCard present, KPI cards preserved — but api.get() call is broken |
| `server/src/routes/tickets.ts` | countOnly query parameter support | VERIFIED | Line 520: `const countOnly = req.query.countOnly === 'true'`, short-circuit at line 547 returns `{ count: total }` after the COUNT query |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `server/src/index.ts` | `server/src/lib/recurringScheduler.ts` | import and call startRecurringScheduler() | WIRED | Lines 10 and 66 |
| `server/src/index.ts` | `server/src/routes/recurring.ts` | app.use('/api/recurring', recurringRoutes) | WIRED | Lines 31 and 186 |
| `server/src/lib/recurringScheduler.ts` | `server/src/db/connection.ts` | db import | WIRED | Line 3: `import { db } from '../db/connection.js'` |
| `src/hooks/useRecurringTemplates.ts` | `/api/recurring` | api.request() calls | WIRED | Lines 49, 54, 64, 74, 85 all call `api.request()` with correct paths |
| `src/pages/Recurring.tsx` | `src/hooks/useRecurringTemplates.ts` | hook import | WIRED | Line 4 import, used in TemplateFormDialog and TemplateCard |
| `src/App.tsx` | `src/pages/Recurring.tsx` | Route element | WIRED | Line 26 import, line 100 Route |
| `src/pages/Dashboard.tsx` | `src/hooks/useDashboardQueues.ts` | hook import | WIRED | Line 8 import, line 127 usage |
| `src/pages/Dashboard.tsx` | `/api/tickets?countOnly=true` | React Query fetch per QueueCard | BROKEN | `api.get()` called (line 58) but method does not exist on ApiClient — should be `api.request()` |
| `src/hooks/useDashboardQueues.ts` | localStorage | getItem/setItem with key 'dashboard-queues' | WIRED | Lines 13 and 21 |
| `src/pages/Dashboard.tsx` | `src/hooks/useFilterViews.ts` | hook import for views array | WIRED | Line 9 import, line 128: `const { views: allViews } = useFilterViews()` (correct accessor, no .state) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `server/src/lib/recurringScheduler.ts` | dueTemplates | `SELECT * FROM recurring_templates WHERE is_active = 1 AND next_run <= ?` | Yes — live SQLite query | FLOWING |
| `server/src/routes/recurring.ts` | templates | `SELECT * FROM recurring_templates ORDER BY created_at DESC` | Yes — live SQLite query | FLOWING |
| `src/pages/Recurring.tsx` | templates.data | `useRecurringTemplates` -> `api.request('/recurring')` -> GET /api/recurring | Yes — real API data | FLOWING |
| `src/pages/Dashboard.tsx` (QueueCard) | data?.count | `api.get('/tickets?countOnly=true&...')` | No — api.get does not exist, fetch fails at runtime | DISCONNECTED |
| `src/hooks/useDashboardQueues.ts` | queues | localStorage.getItem('dashboard-queues') | Yes — persists across reloads | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Server TypeScript compiles | `npx tsc --noEmit --project server/tsconfig.json` | 0 errors | PASS |
| Client TypeScript compiles | `npx tsc --noEmit` | 0 errors | PASS |
| computeNextRun exported | `grep "export function computeNextRun" server/src/lib/recurringScheduler.ts` | Line 28 | PASS |
| startRecurringScheduler registered | `grep "startRecurringScheduler" server/src/index.ts` | Lines 10, 66 | PASS |
| api.get method exists in ApiClient | `grep "^\s*async get\b" src/lib/api.ts` | No output | FAIL |
| api.request used in QueueCard | `grep "api.get" src/pages/Dashboard.tsx` | Line 58 — uses api.get, not api.request | FAIL |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| RECUR-01 | 05-01, 05-02 | User can create recurring template with schedule (daily/weekly/monthly; custom cron deferred per D-01) | SATISFIED | POST /api/recurring with interval_type validation; create dialog with all fields in Recurring.tsx |
| RECUR-02 | 05-01 | System auto-creates tickets via background scheduler | SATISFIED | recurringScheduler.ts: cron every minute, processRecurringTemplates(), createTicketFromTemplate() with db.transaction |
| RECUR-03 | 05-01, 05-02 | User can pause, edit, and delete recurring schedules | SATISFIED | PATCH /api/recurring/:id/toggle, PUT /api/recurring/:id, DELETE /api/recurring/:id; UI: Pause/Play button, Edit dialog, AlertDialog delete |
| RECUR-04 | 05-01, 05-02 | User can see history of tickets created per schedule | SATISFIED | GET /api/recurring returns history array (last 10) per template; Recurring.tsx: expandable history section with clickable Links to /tickets/:id |
| DASH-01 | 05-03 | Dashboard shows saved queues with live ticket count | BLOCKED | QueueCard exists and is wired to useDashboardQueues + useFilterViews, but api.get() crashes at runtime — count is never displayed |
| DASH-02 | 05-03 | User can create, edit, and delete dashboard queues | PARTIAL | Add (via filter view picker dialog) and remove (X button per card) are implemented; edit is documented as remove+re-add which is acceptable, but the queue card UI never renders correctly due to api.get() failure |
| DASH-03 | 05-03 | Each queue shows count and is clickable to filtered list | BLOCKED | Navigation on click is implemented (navigate('/tickets?...') at line 350); count is broken (api.get()) |

Note: RECUR-01 explicitly defers "custom cron" per locked decision D-01 documented in both the plan and SUMMARY. This is intentional scope reduction, not a gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/pages/Dashboard.tsx` | 58 | `api.get<{ count: number }>()` — method does not exist on ApiClient | Blocker | Queue card count fetch throws at runtime; all queue counts remain 0 or component crashes |

No other stub patterns found. No TODO/FIXME/placeholder comments in phase artifacts. No hardcoded empty arrays returned as final data.

### Human Verification Required

#### 1. Queue Card Count Display

**Test:** In a running Docker instance, navigate to Dashboard, add a saved filter view as a queue
**Expected:** Queue card shows the correct count matching the filter criteria; count refreshes every 30-60 seconds
**Why human:** The api.get() gap must be fixed first; after fix, live API behavior requires browser verification

#### 2. Recurring Scheduler End-to-End

**Test:** Create a recurring template with daily interval; inspect Docker logs after one minute; verify a new ticket appears in the template history on the Recurring page
**Expected:** Log shows "Recurring: created ticket ... from template ..."; history entry appears with a clickable link
**Why human:** Scheduler requires live Docker environment; clock advancement cannot be simulated statically

#### 3. Recurring Pause/Resume Cycle

**Test:** Create a template, pause it (Pause button), verify badge changes to "Pausad"; resume it (Play button), verify next_run updates
**Expected:** Badge toggles; on resume the next_run displayed reflects a future date
**Why human:** Toggle mutation requires live API and React Query cache invalidation to verify correctly

### Gaps Summary

One blocker prevents DASH-01 and DASH-03 goal achievement:

**api.get() does not exist on ApiClient.**

The `QueueCard` component in `Dashboard.tsx` (line 58) calls `api.get<{ count: number }>('/tickets?${filterParams}')`. The `ApiClient` class in `src/lib/api.ts` exposes `.request()` and domain-specific named methods (e.g. `getTickets()`, `getCategories()`), but no generic `.get()` shorthand. The SUMMARY for Plan 03 (05-03-SUMMARY.md) doesn't mention this issue, and the STATE.md explicitly notes "ApiClient has no short-form generic get/post/put/delete methods" in the context of Plan 02's fix — yet Plan 03's implementation used `api.get()` anyway.

TypeScript does not catch the error because `noImplicitAny: false` in `tsconfig.json` causes `api.get` to resolve as `any` (no property on `ApiClient` → `any`), so the call type-checks but fails at runtime.

**Fix required:** In `src/pages/Dashboard.tsx`, line 58, change:
```
queryFn: () => api.get<{ count: number }>(`/tickets?${filterParams}`),
```
to:
```
queryFn: () => api.request<{ count: number }>(`/tickets?${filterParams}`),
```

All other phase artifacts are fully implemented, wired, and producing real data. The recurring ticket backend (Plans 01 and 02) is complete and correct. The countOnly API extension is correct. The useDashboardQueues hook is correct. The single api.get() call is the only gap blocking goal achievement for the dashboard queues sub-feature.

---

_Verified: 2026-03-29T04:00:00Z_
_Verifier: Claude (gsd-verifier)_
