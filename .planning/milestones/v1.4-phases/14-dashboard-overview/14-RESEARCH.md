# Phase 14: Dashboard Overview - Research

**Researched:** 2026-03-31
**Domain:** Dashboard UI panels, SQLite aggregation queries, React Query hooks
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** New panels go below the existing KPI cards grid, full-width stacked vertically. Existing KPI grid and secondary stats row remain unchanged.
- **D-02:** Panel order: Aging tickets first, then Reminders. (Today summary is merged into KPI cards per D-06, so no separate panel.)
- **D-03:** "Aging" = days since last status change or comment on the ticket. A ticket updated yesterday is not aging, even if created months ago.
- **D-04:** Show top 5 aging tickets in compact rows: title, age in days ("12 dagar"), priority badge, requester name. Click navigates to ticket detail.
- **D-05:** If more than 5 aging tickets exist, show a "Visa alla" link that navigates to the ticket list filtered for open tickets sorted by staleness.
- **D-06:** Merge today's counts into the existing KPI cards. Add a "idag" sub-label on the relevant KPI cards (created today on Öppna, resolved today on Lösta, closed today on Arkiverade). No separate panel for today's summary.
- **D-07:** Show upcoming reminders with ticket title and scheduled time, ordered by proximity (soonest first). This requires a new global reminders endpoint — currently only per-ticket `/api/tickets/:id/reminders` exists.
- **D-08:** All new dashboard aggregations go through a new `/api/tickets/dashboard-overview` endpoint with dedicated SQL queries. Do NOT extend `useTickets({ limit: 1000 })` for aging or reminder counts.
- **D-09:** Place the `/api/tickets/dashboard-overview` route ABOVE `/:id` in `tickets.ts` to avoid Express route parameter match conflict.
- **D-10:** If `GET /api/reminders` (global, not per-ticket) does not exist, add a new route returning upcoming unsent reminders across all tickets.
- **D-11:** All panels (aging, reminders) and the "idag" sub-labels on KPI cards display skeleton loading states while their data is fetching.

### Claude's Discretion

- Skeleton placeholder design (pulse animation, shimmer, etc.)
- Exact "Visa alla" link destination and filter parameters
- How many reminders to show (5? 10? all upcoming within X days?)
- Visual design of the aging ticket rows (card style, list style, etc.)
- How the "idag" count is displayed on existing KPI cards (badge, sub-text, etc.)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-01 | Dashboard visar en widget med åldrande öppna tickets sorterade på ålder | Aging query pattern found in reports.ts, staleness definition from D-03, compact row layout per D-04 |
| DASH-02 | Dashboard visar dagens sammanfattning (skapade/lösta/stängda idag) | Today's counts folded into existing KPI cards via new `todaySubLabel` prop per D-06; SQL uses `date('now')` boundary |
| DASH-03 | Dashboard visar kommande påminnelser som snart triggar | `ticket_reminders` table confirmed; no global reminders endpoint exists (only per-ticket); new route needed per D-10 |

</phase_requirements>

---

## Summary

Phase 14 adds three dashboard data surfaces to the existing `Dashboard.tsx`: an aging tickets panel (DASH-01), a "today" sub-label on KPI cards (DASH-02), and an upcoming reminders panel (DASH-03). All server aggregations are consolidated into one new endpoint, `/api/tickets/dashboard-overview`, plus a new global reminders endpoint.

The codebase is well-prepared. The schema has everything needed: `tickets.updated_at` (auto-updated via trigger on any ticket change), `ticket_comments.created_at`, and `ticket_reminders` with `reminder_time`/`sent` columns. The existing `useReportsSummary` hook (React Query, `useQuery`) is the exact pattern to follow for the new `useDashboardOverview` hook. The `KPICard` component accepts straightforward extension for a sub-label prop — no structural change needed.

The one confirmed gap is that no global reminders route exists. Only per-ticket `GET /api/tickets/:id/reminders` is registered. A minimal new route is needed before the reminder panel can work.

**Primary recommendation:** Build one `useDashboardOverview` hook backed by a single `/api/tickets/dashboard-overview` endpoint, extend `KPICard` with an optional `subLabel` prop for "idag" counts, and add a minimal global upcoming-reminders endpoint parallel to the dashboard-overview route.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React Query (`@tanstack/react-query`) | already in project | Server state, loading/error states, skeleton triggers | All data hooks in project already use it |
| better-sqlite3 | already in project | Synchronous SQLite queries in Express handlers | All server routes use `db.prepare(...).get/all()` |
| shadcn/ui (`Card`, `Skeleton`) | already in project | Panel containers and skeleton loading states | Project's UI component library |
| date-fns | already in project | Date arithmetic in frontend if needed | Already imported in Dashboard.tsx |
| lucide-react | already in project | Icons for panel headers | Already used throughout Dashboard |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `cn` (clsx/tailwind-merge) | already in project | Conditional classNames in new components | All existing UI components use it |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single `/dashboard-overview` endpoint | Multiple granular endpoints | Single round-trip is simpler; all data loads atomically |
| `shadcn/ui Skeleton` | CSS-only shimmer div | Skeleton component already in project, consistent look |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Recommended File Layout

```
server/src/routes/tickets.ts
  — New route: GET /dashboard-overview  (insert before line 845, above /:id)

src/
├── hooks/
│   └── useDashboardOverview.ts   — new React Query hook
├── components/
│   ├── KPICard.tsx               — extend with optional subLabel prop
│   ├── AgingTicketsPanel.tsx     — new panel component
│   └── RemindersPanel.tsx        — new panel component
└── pages/
    └── Dashboard.tsx             — wire in new hook and panels
```

### Pattern 1: Server-Side Aggregation Endpoint

**What:** One Express route returns all dashboard data in a single JSON object — aging tickets array, today's counts, upcoming reminders count.

**When to use:** Per D-08, never extend `useTickets({ limit: 1000 })` for aggregations. Dedicated SQL is faster and avoids over-fetching.

**Example (modeled on reports.ts pattern):**

```typescript
// In server/src/routes/tickets.ts — ABOVE router.get('/:id', ...)
// Source: existing reports.ts route + schema.sql

router.get('/dashboard-overview', authenticate, (req: AuthRequest, res: Response) => {
  const now = new Date().toISOString();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString();

  // Aging: open/in-progress/waiting tickets, ranked by days since last activity.
  // "Last activity" = MAX of ticket.updated_at and latest comment.created_at (D-03).
  const agingRows = db.prepare(`
    SELECT
      t.id,
      t.title,
      t.priority,
      t.status,
      c.name as requester_name,
      CAST(julianday('now') - julianday(
        MAX(t.updated_at, COALESCE(
          (SELECT MAX(tc.created_at) FROM ticket_comments tc WHERE tc.ticket_id = t.id AND tc.deleted_at IS NULL),
          t.updated_at
        ))
      ) AS INTEGER) as age_days
    FROM tickets t
    LEFT JOIN contacts c ON t.requester_id = c.id
    WHERE t.status IN ('open', 'in-progress', 'waiting')
    ORDER BY age_days DESC
    LIMIT 6
  `).all() as AgingTicketRow[];

  // Today's counts (created / resolved / closed since midnight local time — use date('now') for simplicity)
  const todayCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) as created_today,
      SUM(CASE WHEN date(resolved_at) = date('now') THEN 1 ELSE 0 END) as resolved_today,
      SUM(CASE WHEN date(closed_at)   = date('now') THEN 1 ELSE 0 END) as closed_today
    FROM tickets
  `).get() as TodayCountsRow;

  res.json({
    agingTickets: agingRows,
    todayCounts,
  });
});
```

**Note:** Fetch up to 6 rows so the handler can tell the frontend whether a "Visa alla" link is needed (count > 5), while only ever rendering 5.

### Pattern 2: Global Upcoming Reminders Endpoint

**What:** A new route (per D-10) returning upcoming unsent reminders across all tickets, joined with ticket title.

**Route placement:** Add alongside `/dashboard-overview`, both above `/:id`.

```typescript
// GET /api/tickets/upcoming-reminders  — ABOVE /:id
router.get('/upcoming-reminders', authenticate, (req: AuthRequest, res: Response) => {
  const now = new Date().toISOString();

  const reminders = db.prepare(`
    SELECT
      tr.id,
      tr.ticket_id,
      tr.reminder_time,
      tr.message,
      t.title as ticket_title,
      t.status as ticket_status,
      t.priority as ticket_priority
    FROM ticket_reminders tr
    JOIN tickets t ON tr.ticket_id = t.id
    WHERE tr.sent = 0
      AND tr.reminder_time > ?
    ORDER BY tr.reminder_time ASC
    LIMIT 10
  `).all(now) as UpcomingReminderRow[];

  res.json(reminders);
});
```

### Pattern 3: React Query Hook (follows useReportsSummary)

**What:** `useDashboardOverview` uses `useQuery` with appropriate stale/gcTime settings.

```typescript
// src/hooks/useDashboardOverview.ts
// Source: mirrors useReportsSummary.ts pattern exactly

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const dashboardOverviewKeys = {
  all: ['dashboard', 'overview'] as const,
};

export const useDashboardOverview = () => {
  return useQuery({
    queryKey: dashboardOverviewKeys.all,
    queryFn: () => api.request<DashboardOverview>('/tickets/dashboard-overview'),
    staleTime: 60 * 1000,      // 1 minute — dashboard data can be slightly stale
    gcTime: 5 * 60 * 1000,
  });
};
```

A separate `useUpcomingReminders` hook follows the same pattern, calling `/tickets/upcoming-reminders`.

### Pattern 4: KPICard Sub-Label Extension

**What:** Add an optional `subLabel` prop to `KPICard`. When provided, render a small secondary line below the main value. The existing `KPICard` renders value in the `space-y-1` block — the sub-label slots in there.

```typescript
// KPICard.tsx — minimal addition
interface KPICardProps {
  // ...existing props...
  subLabel?: string;   // e.g. "+3 idag"
}

// In render:
{subLabel && (
  <p className="text-xs text-muted-foreground">{subLabel}</p>
)}
```

The `subLabel` value is computed in `Dashboard.tsx` from `dashboardOverview.data?.todayCounts`, and while loading shows a small `<Skeleton className="h-3 w-16" />` in its place.

### Pattern 5: Skeleton Loading States

**What:** Per D-11, both panels and KPI "idag" sub-labels show skeletons while `isLoading` is true. Use `shadcn/ui Skeleton`.

```tsx
// Panel skeleton (used in AgingTicketsPanel and RemindersPanel)
{isLoading ? (
  <div className="space-y-3">
    {Array.from({ length: 5 }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full rounded-md" />
    ))}
  </div>
) : (
  // actual content
)}
```

### Anti-Patterns to Avoid

- **Extending useTickets for aggregations:** D-08 explicitly forbids this. `useTickets({ limit: 1000 })` loads all ticket data client-side — wasteful and slow for aggregations.
- **Placing `/dashboard-overview` after `/:id`:** Express would match `dashboard-overview` as an ID param. Route MUST be above line 845 in `tickets.ts`.
- **Using `created_at` as the staleness signal for aging:** D-03 defines staleness as time since last *activity* (status change or comment), not creation date. Use `MAX(updated_at, latest_comment.created_at)`.
- **Showing already-sent reminders:** Upcoming reminders query must filter `WHERE tr.sent = 0 AND tr.reminder_time > NOW()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Loading skeleton UI | Custom CSS shimmer | `shadcn/ui Skeleton` | Already in project, consistent with other loading states |
| Server state / loading flags | useState + useEffect + fetch | React Query `useQuery` | Established pattern in all existing hooks |
| Date formatting ("12 dagar") | Custom duration formatter | `Math.round(julianday diff)` from SQL + Swedish suffix in component | Simple integer from SQL, no library needed |
| SQLite aggregation | Client-side array processing | Dedicated SQL in the route handler | Server does the heavy lifting, no over-fetching |

---

## Common Pitfalls

### Pitfall 1: Express Route Order — `/:id` Matching Static Segments

**What goes wrong:** If `/dashboard-overview` is placed after `router.get('/:id', ...)` at line 845, Express matches the string `"dashboard-overview"` as the ticket ID param and returns a 404 or invalid ticket error.

**Why it happens:** Express matches routes in registration order. `/:id` is a wildcard that absorbs any path segment.

**How to avoid:** Insert the new route ABOVE line 845 (the `/:id` GET handler). Confirmed pattern: existing routes `/export`, `/import/preview`, `/import/confirm` are already placed above `/:id` for this reason.

**Warning signs:** API returns `{ error: "Ticket not found" }` for `/api/tickets/dashboard-overview`.

### Pitfall 2: SQLite MAX() Across NULL Values

**What goes wrong:** If a ticket has no comments, `(SELECT MAX(tc.created_at) FROM ticket_comments ...)` returns NULL. `MAX(t.updated_at, NULL)` in SQLite returns NULL, making age_days NULL for all tickets without comments.

**Why it happens:** SQLite's `MAX()` aggregate ignores NULLs, but the two-argument `MAX(a, b)` scalar returns NULL if either argument is NULL.

**How to avoid:** Use `COALESCE` to fall back to `updated_at` when no comments exist:

```sql
MAX(t.updated_at, COALESCE(
  (SELECT MAX(tc.created_at) FROM ticket_comments tc WHERE tc.ticket_id = t.id AND tc.deleted_at IS NULL),
  t.updated_at
))
```

**Warning signs:** Some aging tickets show `null` or `0` days in the panel.

### Pitfall 3: Midnight Boundary for "Today" Counts

**What goes wrong:** Using `datetime('now')` (UTC) as a boundary for "today" counts produces wrong results when the server timezone differs from the user's timezone.

**Why it happens:** SQLite `date('now')` and `datetime('now')` operate in UTC. If the server is UTC and the user is in Stockholm (UTC+1/+2), tickets created at 23:30 local time fall on the next UTC day.

**How to avoid:** For a single-user system running locally on known infrastructure, `date('now')` is a pragmatic choice. Document the UTC assumption. Alternatively, pass today's local date from the client as a query param — but this adds complexity. For this project, SQLite `date('now')` is acceptable.

**Warning signs:** "Today" counts are off by 1 around midnight.

### Pitfall 4: Stale `today` Counts on Long-Open Tabs

**What goes wrong:** React Query caches the dashboard overview. If the user leaves the tab open overnight, counts still show yesterday's data.

**Why it happens:** `staleTime` keeps the query result fresh in cache beyond midnight.

**How to avoid:** Set a short `staleTime` (60 seconds) for the dashboard overview query so data refreshes on next focus. React Query's `refetchOnWindowFocus: true` (default) handles this naturally.

### Pitfall 5: `ticket_comments.deleted_at` Filter

**What goes wrong:** Soft-deleted comments (where `deleted_at IS NOT NULL`) should not count as "recent activity" when computing aging. If included, a deleted comment resets the staleness clock incorrectly.

**Why it happens:** The `ticket_comments` table has a `deleted_at TEXT DEFAULT NULL` column — comments are soft-deleted, not hard-deleted.

**How to avoid:** Always add `AND tc.deleted_at IS NULL` when querying comments in the aging subquery.

---

## Code Examples

Verified patterns from the existing codebase:

### Existing agingTickets Count (reports.ts, line 161)

```sql
-- Source: server/src/routes/reports.ts lines 161-167
SELECT COUNT(*) as count
FROM tickets
WHERE status = 'open'
  AND julianday('now') - julianday(created_at) > 7
```

This uses `created_at`, which violates D-03. The new `/dashboard-overview` endpoint must use `MAX(updated_at, latest_comment)` instead. This existing query is only a pattern reference for the SQL syntax, not the logic.

### React Query Hook Pattern (useReportsSummary.ts)

```typescript
// Source: src/hooks/useReportsSummary.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

return useQuery<ReportsSummary>({
  queryKey: reportsSummaryKeys.filtered(year, month),
  queryFn: () => api.request<ReportsSummary>(`/reports/summary${qs}`),
  staleTime: 5 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
});
```

### api.request Pattern

```typescript
// Source: src/lib/api.ts
// All API calls go through api.request<T>(endpoint, options)
// No new method needed for GET — just call:
api.request<DashboardOverview>('/tickets/dashboard-overview')
```

### Skeleton Usage (shadcn/ui pattern used across project)

```tsx
import { Skeleton } from '@/components/ui/skeleton';

// Panel row skeleton
<Skeleton className="h-10 w-full rounded-md" />

// KPI sub-label skeleton
<Skeleton className="h-3 w-16 mt-1" />
```

### KPICard animationDelay (Dashboard.tsx, lines 98-133)

```tsx
// Source: src/pages/Dashboard.tsx
<KPICard
  label="Öppna ärenden"
  value={stats.open}
  icon={<Ticket className="w-5 h-5" />}
  trend={trends.open}
  sparklineData={sparklineData.open}
  onClick={() => navigate('/tickets?status=open')}
  animationDelay={0}
/>
```

New `subLabel` prop slots in here. While `useDashboardOverview` is loading, pass a skeleton element. Once loaded, pass `"+3 idag"` or similar.

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Client-side aggregation via `useTickets({ limit: 1000 })` | Server-side dedicated SQL per D-08 | Existing dashboard uses client-side; new panels must NOT |
| Per-ticket reminders only | Global upcoming reminders endpoint needed | No global route exists — must add |

---

## Open Questions

1. **How many upcoming reminders to display?**
   - What we know: D-07 says "upcoming reminders ordered by proximity"
   - What's unclear: Count is left to Claude's discretion
   - Recommendation: Show up to 5 unsent upcoming reminders (same as aging ticket cap). Add "Visa alla" if more exist, linking to a future reminders page or filtered ticket list.

2. **"Visa alla" link destination for aging tickets (D-05)**
   - What we know: Should navigate to ticket list filtered for open tickets sorted by staleness
   - What's unclear: The ticket list URL params for "sorted by staleness" — the existing sort options in `useTickets` are `createdAt`, `status`, `priority`, `category`, `tags`. None is staleness.
   - Recommendation: Link to `/tickets?status=open` (no staleness sort available). If a staleness sort is needed, add `sortBy=staleness` handling to the ticket list route — but this may be out of phase scope. Simplest approach: link to `/tickets?status=open` and document the limitation.

3. **Today counts timezone**
   - What we know: SQLite `date('now')` is UTC; server is on Proxmox (likely UTC or Europe/Stockholm)
   - What's unclear: Actual container timezone
   - Recommendation: Use `date('now')` for simplicity in a single-user system. If needed, pass `date` from the client as a query param for correctness.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code/config changes within the existing project. No new external tools, services, or runtimes are required beyond what the project already uses (Node.js, SQLite, React).

---

## Validation Architecture

`nyquist_validation` is explicitly `false` in `.planning/config.json` — this section is skipped.

---

## Project Constraints (from CLAUDE.md)

All directives extracted from `CLAUDE.md` that apply to this phase:

| Directive | Impact on Phase 14 |
|-----------|---------------------|
| **Simplicity First** — make every change as simple as possible, minimal impact | Single endpoint, minimal KPICard prop addition, two small panel components |
| **No Laziness** — find root causes, no temporary fixes | Aging logic must correctly use `MAX(updated_at, latest_comment)` not just `created_at` |
| **Minimal Impact** — only touch what's necessary | Do not refactor existing KPI card grid or stats row; add panels below |
| **Plan First** — write `tasks/todo.md` with checkable items before implementing | Planner generates tasks/todo.md for the implementer |
| **Verification Before Done** — never mark complete without proving it works | Each panel must render actual data; skeletons must visually appear |
| **Frontend Aesthetics** — distinctive design, no generic AI aesthetic | Panel rows should feel designed; avoid cookie-cutter card lists |
| **Task tracking** — mark items complete in `tasks/todo.md` as you go | Implementer follows checklist discipline |

---

## Sources

### Primary (HIGH confidence)

- `server/src/db/schema.sql` — confirmed `tickets`, `ticket_comments`, `ticket_reminders` schema including column names, indices, triggers
- `server/src/routes/tickets.ts` — confirmed all existing routes, ordering, line numbers; confirmed no `/dashboard-overview` or global reminders route exists
- `server/src/routes/reports.ts` — confirmed `agingTickets` SQL pattern; confirmed existing `db.prepare().get()` pattern
- `src/hooks/useReportsSummary.ts` — confirmed React Query `useQuery` pattern with staleTime/gcTime
- `src/components/KPICard.tsx` — confirmed current props interface; identified where `subLabel` fits
- `src/pages/Dashboard.tsx` — confirmed current structure; identified insertion point for new panels
- `src/hooks/useTicketReminders.ts` — confirmed per-ticket hook pattern; confirmed no global hook exists
- `server/src/lib/reminderScheduler.ts` — confirmed `sent = 0 AND reminder_time <= ?` query pattern

### Secondary (MEDIUM confidence)

- SQLite `MAX(a, b)` NULL behavior — standard SQLite behavior, verified against known SQLite semantics

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed present in project
- Architecture: HIGH — patterns sourced directly from existing codebase files
- Pitfalls: HIGH — SQLite NULL behavior and Express route ordering are well-known; sourced from schema inspection
- API gaps: HIGH — verified by direct file inspection (no global reminders route, no dashboard-overview route)

**Research date:** 2026-03-31
**Valid until:** 2026-05-01 (stable domain — no external APIs, only internal patterns)
