---
phase: 05-automation-recurring-tickets-dashboard-queues
plan: 02
subsystem: frontend
tags: [recurring, react-query, crud-ui, sidebar-nav]
dependency_graph:
  requires: [05-01]
  provides: [recurring-templates-ui]
  affects: [src/App.tsx, src/components/Layout.tsx]
tech_stack:
  added: []
  patterns: [react-query-mutations, shadcn-dialog, shadcn-alert-dialog, date-fns-sv]
key_files:
  created:
    - src/hooks/useRecurringTemplates.ts
    - src/pages/Recurring.tsx
  modified:
    - src/components/Layout.tsx
    - src/App.tsx
decisions:
  - "Used api.request() directly instead of api.get/post/put — the ApiClient class does not expose short-form generic methods"
  - "Form state keeps interval_day as string to work with native input/select value binding, converted to number on submit"
metrics:
  duration_minutes: 3
  completed_date: "2026-03-29"
  tasks_completed: 2
  files_changed: 4
---

# Phase 05 Plan 02: Recurring Templates Frontend Summary

**One-liner:** React Query CRUD hook + full management page for recurring ticket templates with create/edit dialog, inline toggle, delete confirmation, and expandable history rows.

## What Was Built

### src/hooks/useRecurringTemplates.ts
Full React Query hook exposing:
- `templates` — `useQuery` for `GET /api/recurring` returning `RecurringTemplate[]`
- `createTemplate` — mutation for `POST /api/recurring`
- `updateTemplate` — mutation for `PUT /api/recurring/:id`
- `deleteTemplate` — mutation for `DELETE /api/recurring/:id`
- `toggleTemplate` — mutation for `PATCH /api/recurring/:id/toggle`

All mutations invalidate `recurringKeys.all` on success and show Swedish-language toast messages.

### src/pages/Recurring.tsx (656 lines)
Full management page with:
- **Template cards** showing name, interval label, active/paused badge, next run (relative), last run (date)
- **Pause/resume toggle** with Play/Pause icon switching based on `is_active`
- **Edit button** opens the same dialog pre-filled with template data
- **Delete** with `AlertDialog` confirmation ("Är du säker? / Detta tar bort schemat och all historik.")
- **Create/Edit dialog** with all fields: name, title, description, priority, category (from `useCategories`), tags (checkboxes from `useTags`), interval type, conditional weekday/month-day picker
- **Expandable history section** — `max-height` CSS transition reveals up to 10 prior tickets as `<Link to="/tickets/:id">` entries
- **Empty state** with icon and "Skapa ditt första schema" CTA
- **Staggered fade-in animation** on list items via `@keyframes fadeSlideIn`

### Layout.tsx + App.tsx
- `RefreshCw` icon added to imports; `{ path: '/recurring', icon: RefreshCw, label: 'Återkommande' }` inserted after "Alla ärenden" in `navItems`
- `/recurring` route registered as `ProtectedRoute` in `AppRoutes`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used api.request() instead of api.get/post/put/delete/patch**
- **Found during:** Task 1
- **Issue:** The plan's interface block specifies `api.get<T>('/recurring')` etc., but `ApiClient` in `src/lib/api.ts` does not expose short-form generic methods. All other hooks use named domain methods (e.g. `api.getCategories()`) or the public `api.request()` method.
- **Fix:** Used `api.request<T>(endpoint, { method })` throughout `useRecurringTemplates.ts`
- **Files modified:** `src/hooks/useRecurringTemplates.ts`
- **Commit:** eda39fa

## Known Stubs

None — all data is wired to live API endpoints via React Query.

## Self-Check

- [x] `src/hooks/useRecurringTemplates.ts` — created and committed (eda39fa)
- [x] `src/pages/Recurring.tsx` — created and committed (347c1e5)
- [x] `src/components/Layout.tsx` — updated (eda39fa)
- [x] `src/App.tsx` — updated (eda39fa)
- [x] TypeScript compiles with zero errors
- [x] All plan acceptance criteria met
