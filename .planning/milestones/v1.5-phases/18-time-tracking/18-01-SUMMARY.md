---
phase: 18-time-tracking
plan: 01
subsystem: time-tracking
tags: [backend, frontend, data-layer, sqlite, react-query]
dependency_graph:
  requires: []
  provides: [time-entries-api, time-entries-hook, duration-utils, time-report-endpoint]
  affects: [server/src/db/connection.ts, server/src/routes/time-entries.ts, server/src/routes/reports.ts, server/src/index.ts, src/types/ticket.ts, src/lib/api.ts, src/lib/duration.ts, src/hooks/useTimeEntries.ts]
tech_stack:
  added: []
  patterns: [react-query-mutations, idempotent-migrations, express-router, better-sqlite3-prepare]
key_files:
  created:
    - server/src/routes/time-entries.ts
    - src/lib/duration.ts
    - src/hooks/useTimeEntries.ts
  modified:
    - server/src/db/connection.ts
    - server/src/routes/reports.ts
    - server/src/index.ts
    - src/types/ticket.ts
    - src/lib/api.ts
decisions:
  - "time_entries migration added to initializeDatabase() chain — idempotent via tableExists guard"
  - "parseDuration supports Swedish 't' (timme) alongside 'h' for hour notation"
  - "GET /reports/time-summary placed before any future parameterized routes to avoid route conflicts"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-05"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 5
---

# Phase 18 Plan 01: Time Tracking Data Layer Summary

**One-liner:** SQLite time_entries table with CRUD REST API, React Query hook, and Swedish-aware duration parser (parseDuration/formatDuration) enabling Plans 02 and 03 to build UI against stable contracts.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | DB migration, CRUD route, reports endpoint, index mount | fed2bbe |
| 2 | Frontend types, API client, duration parser, React Query hook | 23a941d |

## What Was Built

### Backend (Task 1)

**`server/src/db/connection.ts`**
- Added `'time_entries'` to `VALID_TABLE_NAMES` Set
- Added `ensureTimeEntriesTable()` migration function: creates `time_entries` table with `id`, `ticket_id` (FK with CASCADE), `duration_minutes` (CHECK > 0), `note` (length <= 500), `created_at`; creates indexes on `ticket_id` and `created_at DESC`
- Called `ensureTimeEntriesTable()` in `initializeDatabase()` after `ensureKbArticleLinksTable()`

**`server/src/routes/time-entries.ts`** (new)
- `GET /:ticketId` — returns `{ entries: TimeEntryRow[], total_minutes: number }` ordered by `created_at DESC`
- `POST /:ticketId` — validates `duration_minutes` is positive integer, creates entry via `randomUUID()`, returns 201
- `DELETE /:ticketId/:id` — deletes by both `id` AND `ticket_id`, returns 204 or 404
- All endpoints protected with `authenticate` middleware

**`server/src/routes/reports.ts`**
- Added `GET /time-summary` endpoint before any parameterized routes
- Accepts `year` and `month` query params; follows same 0-based month encoding as existing `/summary`
- Returns `{ byCategory: [...], topTickets: [...] }` using LEFT JOIN on categories (handles uncategorized tickets)

**`server/src/index.ts`**
- Added `import timeEntryRoutes` and `app.use('/api/time-entries', timeEntryRoutes)` after recurring route mount

### Frontend (Task 2)

**`src/types/ticket.ts`**
- Added `TimeEntryRow` interface: `{ id, duration_minutes, note: string | null, created_at }`

**`src/lib/duration.ts`** (new)
- `parseDuration(input)`: handles decimal hours (`1.5h`, `2t`), combined (`1h 30m`, `1t30m`), minutes-only (`90m`), and plain integers (`90`). Returns null for unparseable/zero input.
- `formatDuration(minutes)`: `0m`, `45m`, `1h`, `1h 30m` — consistent display format

**`src/lib/api.ts`**
- Added `import type { TimeEntryRow }` from types
- Added `getTimeEntries(ticketId)`, `createTimeEntry(ticketId, payload)`, `deleteTimeEntry(ticketId, entryId)`, `getTimeReportsSummary(year, month)` to ApiClient class

**`src/hooks/useTimeEntries.ts`** (new)
- Exports `timeEntryKeys` for React Query cache key management
- Exports `useTimeEntries(ticketId)` hook with `addEntry` and `deleteEntry` mutations
- Cache invalidation on mutation success; Swedish toast messages (`'Tid loggad'`, `'Tidpost borttagen'`)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan is pure data layer with no UI components.

## Self-Check: PASSED

- `server/src/routes/time-entries.ts` exists
- `src/lib/duration.ts` exists
- `src/hooks/useTimeEntries.ts` exists
- Commits `fed2bbe` and `23a941d` exist in git history
- Frontend TypeScript compiled with zero errors
- All acceptance criteria verified via grep checks
