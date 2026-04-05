# Phase 14: Dashboard Overview - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

The dashboard surfaces the information a user needs to understand their current workload — aging open tickets, what happened today, and upcoming reminders. No new pages, no new ticket fields, no workflow changes.

</domain>

<decisions>
## Implementation Decisions

### Panel Layout
- **D-01:** New panels go below the existing KPI cards grid, full-width stacked vertically. Existing KPI grid and secondary stats row remain unchanged.
- **D-02:** Panel order: Aging tickets first, then Reminders. (Today summary is merged into KPI cards per D-06, so no separate panel.)

### Aging Tickets Panel (DASH-01)
- **D-03:** "Aging" = days since last status change or comment on the ticket. A ticket updated yesterday is not aging, even if created months ago.
- **D-04:** Show top 5 aging tickets in compact rows: title, age in days ("12 dagar"), priority badge, requester name. Click navigates to ticket detail.
- **D-05:** If more than 5 aging tickets exist, show a "Visa alla" link that navigates to the ticket list filtered for open tickets sorted by staleness.

### Today Summary (DASH-02)
- **D-06:** Merge today's counts into the existing KPI cards. Add a "idag" sub-label on the relevant KPI cards (created today on Öppna, resolved today on Lösta, closed today on Arkiverade). No separate panel for today's summary.

### Reminders Panel (DASH-03)
- **D-07:** Show upcoming reminders with ticket title and scheduled time, ordered by proximity (soonest first). This requires a new global reminders endpoint — currently only per-ticket `/api/tickets/:id/reminders` exists.

### API Architecture
- **D-08:** All new dashboard aggregations go through a new `/api/tickets/dashboard-overview` endpoint with dedicated SQL queries. Do NOT extend `useTickets({ limit: 1000 })` for aging or reminder counts.
- **D-09:** Place the `/api/tickets/dashboard-overview` route ABOVE `/:id` in `tickets.ts` to avoid Express route parameter match conflict.
- **D-10:** If `GET /api/reminders` (global, not per-ticket) does not exist, add a new route returning upcoming unsent reminders across all tickets.

### Skeleton Loading (Success Criterion 4)
- **D-11:** All panels (aging, reminders) and the "idag" sub-labels on KPI cards display skeleton loading states while their data is fetching.

### Claude's Discretion
- Skeleton placeholder design (pulse animation, shimmer, etc.)
- Exact "Visa alla" link destination and filter parameters
- How many reminders to show (5? 10? all upcoming within X days?)
- Visual design of the aging ticket rows (card style, list style, etc.)
- How the "idag" count is displayed on existing KPI cards (badge, sub-text, etc.)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Dashboard
- `src/pages/Dashboard.tsx` — Current dashboard with KPI cards, trends, sparklines, critical alert. This is where new panels and KPI sub-labels are added.
- `src/components/KPICard.tsx` — Existing KPI card component. Will need modification or wrapper to support "idag" sub-label.

### API routes
- `server/src/routes/tickets.ts` — Ticket routes including per-ticket reminders at `/:id/reminders`. New `dashboard-overview` route goes here ABOVE `/:id`.
- `server/src/routes/reports.ts` — Has an `agingTickets` count query (7+ days) that can inform the aging query pattern.

### Reminders
- `src/hooks/useTicketReminders.ts` — Per-ticket reminder hook. New global reminders hook will follow similar pattern.
- `server/src/lib/reminderScheduler.ts` — Reminder cron logic, useful context for how reminders are stored and triggered.
- `server/src/db/add-ticket-reminders.ts` — Reminder table schema.

### Requirements
- `.planning/REQUIREMENTS.md` — DASH-01, DASH-02, DASH-03 requirements for this phase.

### Prior decisions
- `.planning/STATE.md` — Research flags for Phase 14 (dashboard-overview route placement, no useTickets extension, verify reminders endpoint).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `KPICard` component: Already supports label, value, icon, trend, sparkline, onClick, animationDelay. Can be extended for "idag" sub-label.
- `useTickets` hook: Existing data fetching pattern but NOT to be used for dashboard aggregations per D-08.
- `useTicketReminders` hook: Per-ticket reminder fetching pattern — new global hook will follow same structure.
- Reports route `agingTickets` SQL: `SELECT COUNT(*) FROM tickets WHERE status IN ('open','in-progress','waiting') AND created_at < datetime('now', '-7 days')` — useful starting point for aging query.

### Established Patterns
- Dashboard uses `useMemo` for client-side aggregation from the `useTickets` result. New panels should use dedicated server-side queries instead.
- KPI cards use `animationDelay` props for staggered entrance animation.
- API routes use `authenticate` middleware and typed `AuthRequest`.

### Integration Points
- `Dashboard.tsx` — where new panels are added below existing KPI grid.
- `server/src/routes/tickets.ts` — where `/dashboard-overview` and possibly `/reminders` (global) routes are added.
- `src/lib/api.ts` — where new API client methods are added.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 14-dashboard-overview*
*Context gathered: 2026-03-31*
