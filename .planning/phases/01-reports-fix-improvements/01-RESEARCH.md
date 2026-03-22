# Phase 1: Reports Fix & Improvements - Research

**Researched:** 2026-03-22
**Domain:** SQLite aggregation, recharts ComposedChart, print CSS media queries
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Backend endpoint**
- D-01: Create `GET /api/reports/summary` in a new `server/src/routes/reports.ts` file, mounted at `/api/reports`
- D-02: Accepts `year` and `month` as optional query params (strings, e.g. `year=2026&month=3`) — null means "all time"
- D-03: Response shape: `{ totals, byCategory, trend, avgResolutionDays, agingTickets }`
- D-04: `trend` covers last 12 months (or filtered year range) using `strftime('%Y-%m', created_at)` for grouping
- D-05: All SQL uses `better-sqlite3` synchronous `db.prepare().get()/.all()` — no async

**Year/month filtering**
- D-06: Existing year/month `<Select>` dropdowns become query params to `/api/reports/summary`; client-side `useMemo` filtering on raw `tickets` array is removed
- D-07: New `useReportsSummary(year?, month?)` React Query hook; staleTime = 5 minutes

**Category chart placement**
- D-08: Category breakdown (horizontal bar chart) in existing **Översikt** tab, after status pie chart section
- D-09: Uses existing `COLORS` array from Reports.tsx
- D-10: Empty state: show "Inga kategorier" if no data

**Trend overlay**
- D-11: Replace existing "created per month" bar chart in **Trend** tab with a recharts `ComposedChart` showing `created` (bars) and `closed` (line overlay)
- D-12: Colors: bars = `hsl(var(--primary))`, line = `hsl(var(--chart-4))`

**Print output**
- D-13: Print only active tab content — inactive `TabsContent` get `display: none` in `@media print`
- D-14: Navigation, header, filter controls, and tab list hidden in print
- D-15: Charts stay visible in print — `ResponsiveContainer` with explicit pixel height or `height: 300px !important` override
- D-16: "Skriv ut" button in Reports page header calls `window.print()`

### Claude's Discretion

- Exact SQL queries for `byCategory` and `trend` aggregations
- Whether `avgResolutionDays` is computed in SQL or JS
- Skeleton/loading state design for the new hook
- Exact `@media print` CSS rules (inline style vs. dedicated print.css vs. Tailwind `print:` variant)

### Deferred Ideas (OUT OF SCOPE)

- Arbitrary date range picker (from/to date inputs) — year/month dropdowns sufficient; Phase 3 or backlog
- Export individual chart as image — out of scope
- Scheduled email digest — v2 requirement
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RPT-01 | Reports analytics compute on the full ticket dataset via a dedicated backend endpoint | D-01 through D-07 define the endpoint and hook; SQL `GROUP BY` on full table replaces `useMemo` on paginated array |
| RPT-02 | Category breakdown chart showing ticket counts per category | D-08/D-09 define placement and colors; SQL `GROUP BY category_id JOIN categories` produces the data |
| RPT-03 | Open vs. closed trend overlay on the existing timeline chart | D-11/D-12 define the chart type; recharts `ComposedChart` with `Bar` + `Line` handles dual series |
| RPT-04 | Print-optimized CSS so browser print-to-PDF produces clean output | D-13 through D-16 define the CSS strategy; `@media print` + `window.print()` is zero-dependency |
</phase_requirements>

---

## Summary

Phase 1 is a targeted fix-and-extend operation on the existing Reports page. The root bug is `useTickets()` being called without a row limit, meaning all chart aggregations in `useMemo` run on one paginated page of data (typically 10–20 tickets). The fix moves all aggregation to a new `/api/reports/summary` SQL endpoint. Two new charts and a print button are layered on top of the corrected data foundation.

The entire implementation uses the existing stack: `better-sqlite3` v11.7 (synchronous), Express Router pattern, React Query v5 hooks, and recharts v2.15. No new packages are introduced. The SQL queries required (`GROUP BY`, `strftime`, `SUM(CASE WHEN ...)`) are standard SQLite and are well-understood.

The recharts `ComposedChart` component is already in the recharts package (imported as `BarChart`, `Bar`, etc. in Reports.tsx today) — the `ComposedChart` import just needs to be added alongside the existing ones. Print CSS via `@media print` is the only area requiring careful attention to ensure SVG/canvas chart output is not clipped.

**Primary recommendation:** Fix the data architecture first (create endpoint, create hook, wire Reports.tsx) before touching any chart UI. This ensures the new category chart and trend overlay are built on correct data from the start.

---

## Standard Stack

### Core (no changes — use what is already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 11.7.0 | Synchronous SQLite queries for the new summary endpoint | Already installed; synchronous API avoids async complexity; all existing routes use it |
| recharts | 2.15.4 | `ComposedChart` for trend overlay, `BarChart` for category chart | Already installed and used in Reports.tsx |
| @tanstack/react-query | 5.83.0 | `useReportsSummary()` hook following existing pattern | Already installed; `staleTime`/`gcTime` pattern is established |
| express | 4.21.2 | New `reports.ts` Router file | Already installed; all routes use Express Router |

### No New Packages

Zero new packages are required for this phase. The only item that might appear to be missing is `ComposedChart` — it is part of the existing `recharts` package and simply needs to be imported.

**Installation:** None required.

---

## Architecture Patterns

### Recommended Project Structure (new files only)

```
server/src/routes/
└── reports.ts          ← NEW: GET /api/reports/summary

src/hooks/
└── useReportsSummary.ts ← NEW: React Query hook

src/pages/
└── Reports.tsx          ← MODIFIED: remove useTickets(), add category chart, replace trend chart, add print button
```

### Pattern 1: Express Router File (matches all existing routes)

**What:** New file `server/src/routes/reports.ts` with a single GET endpoint.
**When to use:** This is the only pattern for new Express routes in this codebase.

```typescript
// server/src/routes/reports.ts
import { Router } from 'express';
import { db } from '../db/connection.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/summary', authenticate, (req, res) => {
  const { year, month } = req.query as { year?: string; month?: string };

  // Build WHERE clause for optional year/month filter
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (year) {
    conditions.push("strftime('%Y', created_at) = ?");
    params.push(year);
  }
  if (year && month) {
    conditions.push("strftime('%m', created_at) = ?");
    // SQLite month is zero-padded: month=3 → '03'
    params.push(String(parseInt(month)).padStart(2, '0'));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Status totals
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as inProgress,
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
      COUNT(*) as total
    FROM tickets ${whereClause}
  `).get(...params) as Record<string, number>;

  // Category breakdown
  const byCategory = db.prepare(`
    SELECT c.label as category, COUNT(t.id) as count
    FROM tickets t
    JOIN categories c ON t.category_id = c.id
    ${whereClause}
    GROUP BY t.category_id
    ORDER BY count DESC
  `).all(...params) as { category: string; count: number }[];

  // Monthly trend — last 12 months (or scoped year)
  const trendWhere = year
    ? `WHERE strftime('%Y', created_at) = '${year}'`
    : `WHERE created_at >= date('now', '-12 months')`;

  const trend = db.prepare(`
    SELECT
      strftime('%Y-%m', created_at) as month,
      COUNT(*) as created,
      SUM(CASE WHEN closed_at IS NOT NULL
               AND strftime('%Y-%m', closed_at) = strftime('%Y-%m', created_at)
               THEN 1 ELSE 0 END) as closed
    FROM tickets
    ${trendWhere}
    GROUP BY strftime('%Y-%m', created_at)
    ORDER BY month ASC
  `).all() as { month: string; created: number; closed: number }[];

  // Avg resolution days (SQL: average of (closed_at - created_at) in days)
  const resolutionRow = db.prepare(`
    SELECT AVG(
      CAST((julianday(closed_at) - julianday(created_at)) AS REAL)
    ) as avgDays
    FROM tickets
    WHERE closed_at IS NOT NULL ${conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : ''}
  `).get(...params) as { avgDays: number | null };

  // Aging tickets: open tickets older than 7 days
  const agingRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM tickets
    WHERE status = 'open'
    AND julianday('now') - julianday(created_at) > 7
  `).get() as { count: number };

  res.json({
    totals,
    byCategory,
    trend,
    avgResolutionDays: resolutionRow.avgDays ?? 0,
    agingTickets: agingRow.count,
  });
});

export default router;
```

**Mount in `server/src/index.ts`:**
```typescript
import reportsRoutes from './routes/reports.js';
// ...after existing route mounts:
app.use('/api/reports', reportsRoutes);
```

### Pattern 2: React Query Hook (matches useTickets pattern)

**What:** `useReportsSummary(year?, month?)` following the exact `useQuery` pattern in `useTickets.ts`.

```typescript
// src/hooks/useReportsSummary.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ReportsSummary {
  totals: {
    open: number; inProgress: number; waiting: number;
    resolved: number; closed: number; total: number;
  };
  byCategory: { category: string; count: number }[];
  trend: { month: string; created: number; closed: number }[];
  avgResolutionDays: number;
  agingTickets: number;
}

export const reportsSummaryKeys = {
  all: ['reports', 'summary'] as const,
  filtered: (year?: string, month?: string) =>
    [...reportsSummaryKeys.all, { year, month }] as const,
};

export const useReportsSummary = (year?: string, month?: string) => {
  const params = new URLSearchParams();
  if (year && year !== 'all') params.append('year', year);
  if (month && month !== 'all') params.append('month', month);
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery<ReportsSummary>({
    queryKey: reportsSummaryKeys.filtered(year, month),
    queryFn: () => api.get(`/reports/summary${qs}`),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};
```

**Note:** `api.get()` needs to be available on the ApiClient. Inspect `src/lib/api.ts` — the client has a generic `request<T>()` method. If no `get()` shorthand exists, call `api.request('/reports/summary' + qs)` directly or add a thin wrapper.

### Pattern 3: recharts ComposedChart (new chart in Trend tab)

**What:** Replace the existing `BarChart` in the Trend tab with a `ComposedChart` that renders bars for `created` and a `Line` for `closed`.

```typescript
// Add to existing recharts import in Reports.tsx:
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  ComposedChart, Line  // ← ADD THESE
} from 'recharts';

// In the Trend tab JSX:
<ResponsiveContainer width="100%" height={300}>
  <ComposedChart data={summary.trend} margin={chartMargins}>
    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
    <Tooltip
      contentStyle={{
        backgroundColor: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: '8px',
      }}
    />
    <Legend />
    <Bar dataKey="created" name="Skapad" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
    <Line
      type="monotone"
      dataKey="closed"
      name="Stängd"
      stroke="hsl(var(--chart-4))"
      strokeWidth={2}
      dot={{ r: 3 }}
    />
  </ComposedChart>
</ResponsiveContainer>
```

### Pattern 4: Category horizontal bar chart (new in Oversikt tab)

**What:** Horizontal `BarChart` using `layout="vertical"` after the status section.

```typescript
// Category breakdown (horizontal bar)
{summary?.byCategory && summary.byCategory.length > 0 ? (
  <ResponsiveContainer width="100%" height={Math.max(200, summary.byCategory.length * 40)}>
    <BarChart layout="vertical" data={summary.byCategory} margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
      <YAxis type="category" dataKey="category" tick={{ fontSize: 12 }} width={80} />
      <Tooltip
        contentStyle={{
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '8px',
        }}
      />
      <Bar dataKey="count" name="Ärenden" radius={[0,4,4,0]}>
        {summary.byCategory.map((_, index) => (
          <Cell key={`cat-${index}`} fill={COLORS[index % COLORS.length]} />
        ))}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
) : (
  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
    Inga kategorier
  </div>
)}
```

### Pattern 5: Print CSS strategy

**What:** `@media print` rules added to `src/index.css` under the existing Tailwind layers.

```css
/* In src/index.css — append after @layer utilities block */
@media print {
  /* Hide all navigation chrome */
  nav, header, aside,
  [data-sidebar], [data-print-hide] {
    display: none !important;
  }

  /* Hide inactive tabs — Radix TabsContent sets data-state="inactive" */
  [data-radix-tabs-content][data-state="inactive"] {
    display: none !important;
  }

  /* Hide tab list and filter controls */
  [role="tablist"],
  .reports-filter-bar {
    display: none !important;
  }

  /* Ensure charts render at a fixed height for print */
  .recharts-responsive-container {
    height: 300px !important;
  }

  /* Force page background white for PDF readability */
  body {
    background: white !important;
    color: black !important;
  }

  /* Cards render with visible borders in print */
  .card, [data-card] {
    border: 1px solid #ccc !important;
    break-inside: avoid;
  }
}
```

**Key insight on Radix tabs:** Radix UI's `TabsContent` sets `data-state="inactive"` on non-active tabs and `display: none` via its own CSS. In `@media print`, the goal is to preserve this — the active tab's content should print, inactive should not. Radix default behavior already achieves this; just ensure no print reset accidentally enables all tabs.

**Skriv ut button:** Add alongside existing CSV Export and Customize buttons in the header `flex` container:

```tsx
<Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2 print:hidden">
  <Printer className="h-4 w-4" />
  <span className="hidden sm:inline">Skriv ut</span>
</Button>
```

Use `print:hidden` Tailwind variant on the button itself so it doesn't appear in the printout.

### Anti-Patterns to Avoid

- **Aggregating on `yearMonthFilteredTickets`:** After this phase, no `useMemo` should run aggregations on the raw tickets array. The `useTickets()` import in Reports.tsx should be removed entirely once all data flows through `useReportsSummary()`.
- **Using `new Date().getMonth()` for grouping:** SQLite `strftime` handles timezone-consistent grouping server-side; JS date math in `useMemo` is inconsistent and was the root bug.
- **Percent-height `ResponsiveContainer` in print:** `height="100%"` collapses to 0 in print. Always use a pixel value for the height prop when print compatibility is needed.
- **Forgetting the `padStart` for month param:** SQLite `strftime('%m', ...)` returns `'03'` not `'3'`. The query param from the frontend Select sends `'3'`. The backend must zero-pad: `String(parseInt(month)).padStart(2, '0')`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Status count aggregation | JS reduce over tickets array | `SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END)` in SQL | SQL runs on the full table, not a paginated page |
| Monthly date grouping | `new Date(t.createdAt).getMonth()` | `strftime('%Y-%m', created_at)` | SQLite stores dates as TEXT ISO strings; `strftime` is reliable; JS date parsing of TEXT has timezone edge cases |
| Dual-series chart | Two separate `BarChart` components | recharts `ComposedChart` with `Bar` + `Line` | `ComposedChart` shares axes, legend, and tooltip automatically |
| Print hiding | JavaScript `window.onbeforeprint` to hide elements | `@media print` CSS | CSS approach is instant, no flash, no JS dependency |

**Key insight:** Every aggregation problem in this phase is already solved by standard SQL and the existing recharts API. The historical bug was architectural (fetching paginated data for analytics), not algorithmic.

---

## Common Pitfalls

### Pitfall 1: SQLite month param zero-padding

**What goes wrong:** Frontend sends `month=3` (from 0-indexed JS or 1-indexed dropdown). SQLite `strftime('%m', created_at)` always produces `'03'`. Query returns 0 rows.
**Why it happens:** JavaScript months are 0-indexed; the existing `MONTH_NAMES` array indexes from 0. The current Select sends `index.toString()` which may produce `'2'` for March. SQLite expects `'03'`.
**How to avoid:** In the backend, normalize: `const m = String(parseInt(month)).padStart(2, '0');`
**Warning signs:** All filtered requests return empty results; unfiltered (year only) works fine.

### Pitfall 2: `useTickets()` still imported after migration

**What goes wrong:** Reports.tsx calls `useReportsSummary()` for charts but `useTickets()` is left in for `availableYears` or `agingTicketsData` — these still run on paginated data, so year dropdowns may show incomplete years.
**Why it happens:** Incremental refactoring — it's tempting to keep `useTickets()` for the year-dropdown population.
**How to avoid:** `availableYears` must also come from the backend (the `trend` array already contains all months, extract years from it client-side, or add an `availableYears` field to the summary response).
**Warning signs:** Year dropdown only shows years present in the current page of tickets.

### Pitfall 3: recharts ResponsiveContainer height collapsing in print

**What goes wrong:** Charts disappear in PDF output. The SVG is present in the DOM but renders at 0×0.
**Why it happens:** `ResponsiveContainer height="100%"` measures its parent's height. In print layout, parents collapse to auto height. 0px parent → 0px chart.
**How to avoid:** In the `@media print` CSS block, set `.recharts-responsive-container { height: 300px !important; }`. Or pass an explicit pixel height to `ResponsiveContainer` and rely on the `!important` override only in print.
**Warning signs:** Charts are in the DOM inspector but have zero bounding box in print preview.

### Pitfall 4: Trend SQL — closed count logic

**What goes wrong:** The `closed` count in the trend query counts tickets closed in a given month incorrectly if grouped by `created_at` instead of `closed_at`.
**Why it happens:** The natural tendency is to group everything by `created_at` since that's the primary time dimension. But `closed` tickets should be counted in the month they were closed, not created.
**How to avoid:** Use two separate grouping expressions:
  - `created` grouped by `strftime('%Y-%m', created_at)` — count of new tickets
  - `closed` grouped by `strftime('%Y-%m', closed_at)` — count of closed tickets in that month

  This requires either a UNION or a LEFT JOIN approach, or computing them in two separate queries and merging in JS. The simplest correct approach is two queries merged on the month key:

```sql
-- Query 1: created per month
SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as created
FROM tickets WHERE ...
GROUP BY month

-- Query 2: closed per month
SELECT strftime('%Y-%m', closed_at) as month, COUNT(*) as closed
FROM tickets WHERE closed_at IS NOT NULL AND ...
GROUP BY month
```

Then merge in the route handler using a Map keyed on `month`.
**Warning signs:** Closed count is always 0 or equals created count.

### Pitfall 5: `api.get()` not existing on ApiClient

**What goes wrong:** `useReportsSummary` calls `api.get('/reports/summary')` but the `ApiClient` class in `src/lib/api.ts` only exposes named methods (e.g., `getTickets`, `createTicket`). No generic `get()` method.
**Why it happens:** The ApiClient is not a generic REST client — it has domain-specific methods.
**How to avoid:** Either (a) add a `get<T>(endpoint: string): Promise<T>` shorthand to ApiClient that delegates to `this.request<T>(endpoint)`, or (b) call `api.request('/reports/summary' + qs)` if that is public. Verify at implementation time by reading `src/lib/api.ts` fully.
**Warning signs:** TypeScript compile error `Property 'get' does not exist on type 'ApiClient'`.

### Pitfall 6: Radix Tabs content in print — all tabs showing

**What goes wrong:** In some browser/OS combinations, print CSS resets the Radix tab visibility so all four tab contents print on the same page.
**Why it happens:** Some print stylesheets (e.g. from Tailwind's preflight or browser defaults) may reset `display` on all elements. Radix uses `data-state` attribute + CSS to hide inactive tabs, which could be overridden.
**How to avoid:** Explicitly add `[data-radix-tabs-content][data-state="inactive"] { display: none !important; }` to the `@media print` block. The `!important` prevents browser print reset from overriding it.
**Warning signs:** Print preview shows content from all four tabs stacked vertically.

---

## Code Examples

### SQL: avgResolutionDays using julianday

```sql
-- julianday arithmetic gives fractional days; CAST to REAL for precision
SELECT AVG(
  CAST((julianday(closed_at) - julianday(created_at)) AS REAL)
) as avgDays
FROM tickets
WHERE closed_at IS NOT NULL
```

Source: SQLite official documentation — https://www.sqlite.org/lang_datefunc.html

### SQL: category breakdown with join

```sql
SELECT c.label as category, COUNT(t.id) as count
FROM tickets t
JOIN categories c ON t.category_id = c.id
GROUP BY t.category_id
ORDER BY count DESC
```

Note: Tickets with `category_id = NULL` are excluded by the inner JOIN. This is correct behavior — uncategorized tickets should not appear in the category chart.

### SQL: trend with separate created/closed queries merged in JS

```typescript
const createdRows = db.prepare(`
  SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as created
  FROM tickets
  WHERE created_at >= date('now', '-12 months')
  GROUP BY month ORDER BY month
`).all() as { month: string; created: number }[];

const closedRows = db.prepare(`
  SELECT strftime('%Y-%m', closed_at) as month, COUNT(*) as closed
  FROM tickets
  WHERE closed_at IS NOT NULL
  AND closed_at >= date('now', '-12 months')
  GROUP BY month ORDER BY month
`).all() as { month: string; closed: number }[];

// Merge on month key
const trendMap = new Map<string, { month: string; created: number; closed: number }>();
for (const r of createdRows) trendMap.set(r.month, { month: r.month, created: r.created, closed: 0 });
for (const r of closedRows) {
  const existing = trendMap.get(r.month);
  if (existing) existing.closed = r.closed;
  else trendMap.set(r.month, { month: r.month, created: 0, closed: r.closed });
}
const trend = Array.from(trendMap.values()).sort((a, b) => a.month.localeCompare(b.month));
```

### ReportModuleId: adding new category chart module

```typescript
// In src/hooks/useReportsPreferences.ts, add to ReportModuleId union:
export type ReportModuleId =
  | 'requesterAnalytics'
  | 'statusDistribution'
  | 'priorityChart'
  | 'monthlyChart'
  | 'activityHeatmap'
  | 'statusFlow'
  | 'tagAnalytics'
  | 'categoryChart'; // ← ADD

// Add to DEFAULT_MODULES array:
{
  id: 'categoryChart',
  label: 'Kategorier',
  description: 'Ärenden per kategori',
  visible: true,
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `useMemo` on `useTickets()` for chart aggregation | SQL `GROUP BY` in `/api/reports/summary` | This phase | Charts reflect full dataset, not paginated page |
| "created per month" single-series bar chart | `ComposedChart` with `Bar` (created) + `Line` (closed) overlay | This phase | Both open and closed trends visible in one chart |
| No category breakdown chart | Horizontal bar chart from `byCategory` endpoint data | This phase | Ticket distribution by category becomes visible |
| No print support | `@media print` CSS + "Skriv ut" button | This phase | Clean PDF output from browser print dialog |

**Not changing this phase:**
- KPI cards (totalTickets, avgResolutionTime, resolutionRate, agingTickets) — they continue to read from `useReportsSummary` totals after migration
- `useReportsPreferences` module visibility system — category chart hooks into it; no structural change needed
- Tab structure (Översikt, Trend, Personer, Taggar) — no new tabs

---

## Open Questions

1. **Does `api.request()` need a `get()` wrapper?**
   - What we know: ApiClient has `request<T>(endpoint, options)` internally; domain methods call it. There is no public `get()` shorthand confirmed.
   - What's unclear: Whether `request()` is accessible publicly or only via internal domain methods.
   - Recommendation: At implementation time, check `src/lib/api.ts` fully and either add `get<T>(endpoint: string) { return this.request<T>(endpoint); }` to ApiClient, or call the endpoint via a named method like `api.getReportsSummary(year, month)`.

2. **Available years in year dropdown after removing `useTickets()`**
   - What we know: The current year dropdown is populated from `availableYears` which is a `useMemo` over the `tickets` array from `useTickets()`.
   - What's unclear: Whether to add `availableYears` to the summary endpoint or derive them from `trend` data.
   - Recommendation: Derive from `trend` data client-side — extract unique year prefixes from `trend[n].month` (e.g. `'2026-03'` → `'2026'`). No backend change needed. If no trend data exists yet (empty DB), show current year as default.

3. **Trend window for year-filtered requests**
   - What we know: D-04 says trend covers last 12 months OR filtered year range.
   - What's unclear: When `year=2025` is selected, should `trend` return all 12 months of 2025, or only months with data?
   - Recommendation: Return all 12 months of the selected year, filling months with no tickets as `{ month: 'YYYY-MM', created: 0, closed: 0 }`. This gives a complete timeline. Generate the 12-month scaffold in the route handler and left-join data into it.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/pages/Reports.tsx`, `src/hooks/useTickets.ts`, `src/hooks/useReportsPreferences.ts`, `server/src/routes/tickets.ts`, `server/src/db/connection.ts`, `server/src/db/schema.sql`, `server/src/index.ts`, `src/lib/api.ts`, `package.json`, `server/package.json`
- `.planning/research/SUMMARY.md` — project-level research; pitfalls validated against this
- `.planning/phases/01-reports-fix-improvements/01-CONTEXT.md` — all locked decisions sourced from here
- SQLite official documentation: https://www.sqlite.org/lang_datefunc.html (`strftime`, `julianday`)
- recharts documentation: `ComposedChart` with `Bar` + `Line` is the standard dual-series pattern in recharts v2

### Secondary (MEDIUM confidence)
- recharts ResponsiveContainer print behavior — established community pattern; based on known SVG height-collapse behavior in print layout
- Radix UI Tabs `data-state` attribute — observed in recharts/Radix ecosystem; verified against DOM attribute pattern in `@radix-ui/react-tabs` v1.1.12 behavior

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages confirmed by direct `package.json` inspection; versions exact
- Architecture: HIGH — all patterns confirmed by direct source file inspection of routes, hooks, and component
- SQL queries: HIGH — standard SQLite `GROUP BY`, `strftime`, `julianday` patterns from official docs
- Print CSS: MEDIUM — `@media print` + recharts height collapse is a known pattern but browser/OS print rendering varies; the `!important` override strategy is defensive but correct
- Pitfalls: HIGH (SQL/routing) / MEDIUM (print browser variation) — SQL pitfalls verified against actual source; print pitfalls from established patterns

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable stack; recharts and SQLite APIs change slowly)
