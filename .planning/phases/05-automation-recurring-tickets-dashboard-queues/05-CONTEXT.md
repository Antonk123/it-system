# Phase 5: Automation — Recurring Tickets & Dashboard Queues - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver two automation capabilities: (1) recurring ticket templates that auto-create tickets on a schedule, with a management UI and creation history; (2) dashboard queues — saved filter-based cards on the Dashboard that replace the hardcoded aging groups with user-defined smart views.

</domain>

<decisions>
## Implementation Decisions

### Schedule Definition
- **D-01:** Simple intervals only — daily, weekly (pick weekday), monthly (pick day of month). No cron syntax, no calendar-based scheduling. Covers the vast majority of use cases with minimal UX complexity.
- **D-02:** Backend uses `node-cron` (already installed) to run a single recurring-ticket scheduler job that checks for due schedules and creates tickets. Same pattern as `autoCloseScheduler.ts` and `reminderScheduler.ts`.

### Recurring Ticket Template
- **D-03:** A template contains the same fields as a regular ticket: title, description, priority, category, tags. Each auto-created ticket is a full ticket with these values pre-filled.
- **D-04:** Templates are stored in a new `recurring_templates` SQLite table with columns for schedule config, template fields, active/paused flag, last_run timestamp, and next_run timestamp.
- **D-05:** Users can pause, edit, and delete recurring schedules. Paused schedules skip execution but remain visible in the management list.

### Recurring Tickets Management UX
- **D-06:** New "Återkommande" page accessible from the sidebar navigation. Lists all recurring schedules with name, interval, status (active/paused), next run, and last run.
- **D-07:** History view via expandable row — click a schedule to expand and show the last 5-10 created tickets as clickable links. No separate detail page.
- **D-08:** Create/edit form is a dialog or slide-over on the same page. Reuses existing form components (priority select, category select, tag multi-select).

### Dashboard Queues
- **D-09:** A dashboard queue = a reference to a saved filter view (from the existing `useFilterViews` hook). Each queue card shows the filter view name, the count of matching tickets, and is clickable to navigate to the ticket list with that filter active.
- **D-10:** Queue definitions stored in localStorage (same pattern as filter views). No database migration needed. A new `useDashboardQueues` hook manages the queue list.
- **D-11:** Queues section replaces the current hardcoded aging groups (critical/warning/attention cards) on the Dashboard. KPI cards and critical alert bar remain above.
- **D-12:** Users can add, reorder, and remove queues from the Dashboard. "Add queue" opens a picker of existing saved filter views.

### Claude's Discretion
- Exact responsive layout for queue cards on mobile
- Animation/transition for expandable history rows
- Scheduler polling interval (every minute vs hourly — balance responsiveness vs overhead)
- Empty state design for the "Återkommande" page and queue section
- How to handle queue count fetching (batch API call vs individual queries)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — RECUR-01 through RECUR-04 and DASH-01 through DASH-03 define acceptance criteria

### Existing Scheduler Pattern
- `server/src/lib/autoCloseScheduler.ts` — Reference implementation for cron-based background job with `node-cron`
- `server/src/lib/reminderScheduler.ts` — Second scheduler example with async email sending and error recovery
- `server/src/config/automation.ts` — Automation config pattern (env vars, rule definitions)
- `server/src/index.ts` — Where schedulers are registered at startup (lines 42-61)

### Dashboard
- `src/pages/Dashboard.tsx` — Current dashboard with KPI cards, aging groups, recent tickets
- `src/components/KPICard.tsx` — Reusable KPI card component with sparklines and trends

### Filter Views (Queue foundation)
- `src/hooks/useFilterViews.ts` — localStorage-based filter preset management hook
- `src/types/filterView.ts` — FilterView type definition

### Database
- `server/src/db/schema.sql` — Current schema (for reference when designing recurring_templates table)
- `server/src/db/connection.ts` — Database connection and `initializeDatabase()` where migrations run

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **node-cron**: Already installed and used by two schedulers — proven pattern for background jobs
- **autoCloseScheduler.ts**: Template for a cron job that queries SQLite and mutates tickets in a transaction
- **reminderScheduler.ts**: Template for async scheduler with per-item error handling
- **useFilterViews hook**: localStorage management for saved filter views — queues will reference these
- **KPICard component**: Dashboard card with icon, value, trend, sparkline — queue cards can use similar styling
- **Card/CardHeader/CardContent**: shadcn card components used throughout Dashboard
- **Priority/Category/Tag select components**: Reusable in the recurring template form
- **Layout component**: Sidebar navigation — new "Återkommande" menu item added here

### Established Patterns
- **Scheduler registration**: Each scheduler exports a `start*Scheduler()` function called in `server/src/index.ts`
- **DB migrations**: New tables added via migration files in `server/src/db/`, wired into `initializeDatabase()`
- **React Query hooks**: All data fetching via custom hooks wrapping `useQuery`/`useMutation`
- **Dialog forms**: Create/edit via shadcn Dialog components (used in FilterViewManager, CommentItem)
- **Sidebar nav**: `src/components/Layout.tsx` renders navigation links

### Integration Points
- `server/src/index.ts` — Register new recurring ticket scheduler alongside existing ones
- `src/components/Layout.tsx` — Add "Återkommande" sidebar nav item
- `src/pages/Dashboard.tsx` — Replace aging groups section with queue cards
- `server/src/db/connection.ts` — Register migration for `recurring_templates` table
- New API routes: `server/src/routes/recurring.ts` for CRUD + history

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The key principle is reusing existing patterns (scheduler, filter views, Card components) rather than introducing new paradigms.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-automation-recurring-tickets-dashboard-queues*
*Context gathered: 2026-03-28*
