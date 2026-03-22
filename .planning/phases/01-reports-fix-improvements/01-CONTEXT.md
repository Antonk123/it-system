# Phase 1: Reports Fix & Improvements - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the analytics architecture so all computations run on the full ticket dataset (not a paginated subset), then add a category breakdown chart, an open/closed trend overlay, and print-optimized CSS for browser PDF output. No new npm packages are introduced.

</domain>

<decisions>
## Implementation Decisions

### Backend endpoint
- **D-01:** Create `GET /api/reports/summary` in a new `server/src/routes/reports.ts` file, mounted at `/api/reports`
- **D-02:** Endpoint accepts `year` and `month` as optional query params (both strings, e.g. `year=2026&month=3`) — null means "all time"
- **D-03:** Response shape:
  ```json
  {
    "totals": { "open": N, "inProgress": N, "waiting": N, "resolved": N, "closed": N, "total": N },
    "byCategory": [{ "category": "string", "count": N }],
    "trend": [{ "month": "YYYY-MM", "created": N, "closed": N }],
    "avgResolutionDays": N,
    "agingTickets": N
  }
  ```
- **D-04:** `trend` covers the last 12 months (or filtered year range) using `strftime('%Y-%m', created_at)` for grouping
- **D-05:** All SQL uses `better-sqlite3` synchronous `db.prepare().get()/.all()` pattern — no async

### Year/month filtering
- **D-06:** The existing year/month `<Select>` dropdowns in Reports.tsx become query params passed to the new `/api/reports/summary` endpoint — client-side `useMemo` filtering on `tickets` array is removed
- **D-07:** A new `useReportsSummary(year?, month?)` React Query hook fetches from the backend; staleTime = 5 minutes (matches existing hook pattern)

### Category chart placement
- **D-08:** Category breakdown chart (bar chart, horizontal) goes into the existing **Översikt** tab, after the status pie chart section — no new tab needed
- **D-09:** Uses the existing `COLORS` array from Reports.tsx for consistency
- **D-10:** Empty state: show "Inga kategorier" text if no category data returned

### Trend overlay
- **D-11:** Replace the existing "created per month" bar chart in the **Trend** tab with a combined chart showing both `created` (bars) and `closed` (line overlay) in the same recharts `ComposedChart`
- **D-12:** Colors: bars use `hsl(var(--primary))`, line uses `hsl(var(--chart-4))` — matches existing `STATUS_COLORS` for 'resolved'

### Print output
- **D-13:** Print only the current active tab's content — inactive `TabsContent` sections get `display: none` in `@media print`
- **D-14:** Navigation, header, filter controls, and tab list are hidden in print
- **D-15:** Charts must remain visible in print — `ResponsiveContainer` with explicit pixel height (not % height) in print media, or override via CSS `height: 300px !important`
- **D-16:** A "Skriv ut" (Print) button added to the Reports page header, calls `window.print()`

### Claude's Discretion
- Exact SQL queries for `byCategory` and `trend` aggregations
- Whether `avgResolutionDays` is computed in SQL or JS
- Skeleton/loading state design for the new hook
- Exact `@media print` CSS rules (inline style vs. dedicated print.css vs. Tailwind print: variant)

</decisions>

<specifics>
## Specific Ideas

- The page is already in Swedish (Översikt, Trend, Taggar, etc.) — all new UI labels must also be in Swedish ("Kategorier", "Skapad", "Stängd", "Skriv ut")
- The existing `COLORS` and `STATUS_COLORS` constants in Reports.tsx should be reused — do not introduce new color arrays
- The existing `useTickets()` call at line 151 of Reports.tsx is the root cause of the bug — after this phase, `useTickets()` is replaced by `useReportsSummary()` for all aggregation; `useTickets()` can be removed from Reports.tsx if it serves no other purpose there

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Reports implementation
- `src/pages/Reports.tsx` — full current implementation; understand tab structure, existing color constants, filter logic, and recharts usage before adding anything
- `src/components/ReportsCustomization.tsx` — module visibility system; new charts should be registerable here

### Backend patterns
- `server/src/routes/tickets.ts` — existing Express route pattern with SQLite queries to follow
- `server/src/db/connection.ts` — `db` export and `initializeDatabase()` pattern
- `server/src/index.ts` — where new `reports.ts` router must be mounted

### Hook patterns
- `src/hooks/useTickets.ts` — React Query hook pattern to replicate for `useReportsSummary()`

### Project constraints
- `CLAUDE.md` — project working rules and deployment notes
- `.planning/REQUIREMENTS.md` — RPT-01, RPT-02, RPT-03, RPT-04 definitions
- `.planning/research/SUMMARY.md` — pitfalls to avoid (paginated data bug, recharts tab rendering, print CSS chart visibility)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `COLORS` array (Reports.tsx:26) — 5 HSL CSS variable colors; use for category chart bars
- `STATUS_COLORS` record (Reports.tsx:35) — per-status colors; use for trend chart line color
- `useTickets()` hook — currently misused for aggregation; its `{ tickets }` array is what's causing the bug
- `useReportsPreferences()` / `ReportsCustomization.tsx` — module visibility system; new charts should respect this
- `KPICard` component — already used for summary cards; no changes needed
- `recharts` `BarChart`, `ComposedChart`, `Line`, `Bar` — all available in the codebase already

### Established Patterns
- All Express routes follow: `import { Router } from 'express'; const router = Router(); export default router;` pattern
- React Query hooks: `useQuery({ queryKey: [...], queryFn: () => api.get(...), staleTime: 5 * 60 * 1000 })`
- API client: `api.get('/reports/summary?year=2026')` via `src/lib/api.ts`

### Integration Points
- New `reports.ts` router must be imported and mounted in `server/src/index.ts` (`app.use('/api/reports', reportsRouter)`)
- Year/month `<Select>` state (`selectedYear`, `selectedMonth`) already exists in Reports.tsx — wire these to the new hook params instead of the `useMemo` filter
- `@media print` CSS: can be added inline in `src/index.css` under the existing Tailwind layers, or as Tailwind `print:` variant classes on the relevant elements

</code_context>

<deferred>
## Deferred Ideas

- Arbitrary date range picker (from/to date inputs) — year/month dropdowns are sufficient for now; Phase 3 or backlog
- Export individual chart as image — out of scope for this phase
- Scheduled email digest — v2 requirement, not this milestone

</deferred>

---

*Phase: 01-reports-fix-improvements*
*Context gathered: 2026-03-22*
