---
phase: "05-automation-recurring-tickets-dashboard-queues"
plan: "01"
subsystem: "backend"
tags: ["recurring-tickets", "scheduler", "sqlite", "cron", "rest-api"]
dependency_graph:
  requires: []
  provides: ["recurring_templates table", "recurring_ticket_history table", "GET /api/recurring", "POST /api/recurring", "PUT /api/recurring/:id", "DELETE /api/recurring/:id", "PATCH /api/recurring/:id/toggle", "startRecurringScheduler"]
  affects: ["server/src/index.ts", "server/src/db/connection.ts"]
tech_stack:
  added: []
  patterns: ["node-cron scheduler", "better-sqlite3 transaction", "ensureXxx migration pattern"]
key_files:
  created:
    - "server/src/lib/recurringScheduler.ts"
    - "server/src/routes/recurring.ts"
  modified:
    - "server/src/db/connection.ts"
    - "server/src/index.ts"
decisions:
  - "computeNextRun exported from scheduler so routes can import it directly — single source of truth for interval logic"
  - "RECUR-01 cron expression variant excluded per D-01 — daily/weekly/monthly intervals cover the requirement scope"
  - "createTicketFromTemplate filters stale tag IDs before insert to avoid FK violations"
metrics:
  duration: "2 minutes"
  completed_date: "2026-03-29"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 05 Plan 01: Recurring Ticket Backend Summary

**One-liner:** SQLite-backed recurring ticket scheduler with daily/weekly/monthly intervals, full CRUD API at /api/recurring, and a per-minute cron job that auto-creates tickets from due templates.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Database migration + Recurring scheduler | 903c71a | server/src/db/connection.ts, server/src/lib/recurringScheduler.ts |
| 2 | Recurring templates CRUD + history API routes | 6b63fef | server/src/routes/recurring.ts, server/src/index.ts |

## What Was Built

### Database (Task 1)
- `ensureRecurringTemplatesTable()` added to `connection.ts` following the existing `ensureXxx` migration pattern
- Creates two tables on startup: `recurring_templates` (with CHECK constraints for priority and interval_type) and `recurring_ticket_history` (FK-cascades on template delete)
- Composite index `idx_recurring_templates_next_run ON recurring_templates(is_active, next_run)` for fast scheduler queries
- Called in `initializeDatabase()` after `ensureKbFts5AndType()`

### Scheduler (Task 1)
- `recurringScheduler.ts` exports `startRecurringScheduler()` — registers cron job `'* * * * *'`
- `processRecurringTemplates()` queries `WHERE is_active = 1 AND next_run <= now`, iterates due templates
- `createTicketFromTemplate()` runs a `db.transaction` that: inserts ticket, inserts ticket_tags for valid tags, inserts ticket_history (user_id=NULL, system action), inserts recurring_ticket_history, updates last_run/next_run on template
- Stale tag IDs are filtered via `SELECT id FROM tags WHERE id IN (...)` before insert
- `computeNextRun()` exported for shared use:
  - daily: +1 day at midnight
  - weekly: next occurrence of intervalDay (0=Sun..6=Sat), minimum 1 day ahead via `% 7 || 7`
  - monthly: next month, day clamped with `Math.min(targetDay, daysInMonth)` handling day-31 edge case

### API Routes (Task 2)
- `GET /api/recurring` — all templates with parsed tags (JSON array) and last 10 history entries per template
- `POST /api/recurring` — validates name, title, interval_type; computes next_run; returns created template
- `PUT /api/recurring/:id` — partial update with dynamic field merging; recomputes next_run if interval changed or template resumed
- `DELETE /api/recurring/:id` — 404 guard, CASCADE deletes history, returns 204
- `PATCH /api/recurring/:id/toggle` — quick pause/resume; recomputes next_run on resume only
- All routes use `authenticate` middleware
- `server/src/index.ts` — added `import recurringRoutes`, `app.use('/api/recurring', recurringRoutes)`, `import { startRecurringScheduler }`, and `startRecurringScheduler()` call

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All DB operations are fully wired. API returns live data from SQLite.

## Self-Check: PASSED

Files exist:
- server/src/lib/recurringScheduler.ts — FOUND
- server/src/routes/recurring.ts — FOUND

Commits exist:
- 903c71a — FOUND (feat(05-01): add recurring templates DB migration and scheduler)
- 6b63fef — FOUND (feat(05-01): add recurring templates CRUD API and register scheduler)

TypeScript: zero compile errors confirmed.
