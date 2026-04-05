# Phase 18: Time Tracking - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can log time spent on tickets and view time analytics in Reports. This includes: a new `time_entries` DB table, backend API routes, a sidebar section on ticket detail for logging/viewing time, and a "Tid" tab in Reports with category breakdown and top tickets.

**Out of scope (deferred):** Live start/stop timer (TIME-F01), quick-select chip buttons (TIME-F02).

</domain>

<decisions>
## Implementation Decisions

### Time Entry Input
- **D-01:** Free-text parsing for duration input — single input that parses formats like '1h 30m', '90min', '1.5h', '45m'. Parse to integer minutes for storage.
- **D-02:** Time entry form lives in a dedicated sidebar section ("Tid") in ticket detail, similar to KBLinksSection. Compact, always visible alongside other sidebar sections.

### Time Display
- **D-03:** Claude's Discretion — total time summary and individual entry list styling. Should feel consistent with existing sidebar sections (KB Links pattern).

### Reports Tid Tab
- **D-04:** Two visualizations: bar chart of time per category + table of top 10 tickets by time spent. Matches success criteria directly, no extra charts.
- **D-05:** Shared date range filter — uses the existing date range picker at top of Reports page. No separate filter within the Tid tab.

### Data Model
- **D-06:** Store duration as integer minutes in DB. Display as formatted "Xh Ym" in UI.
- **D-07:** No user_id column on time_entries — single-user system, skip future-proofing.

### Claude's Discretion
- Time display styling (total summary + entry list layout) — keep consistent with existing sidebar section patterns
- Entry list should show duration, date, and optional note per entry
- Delete button on hover (established pattern from KB links)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Tidsloggning — TIME-01 through TIME-06 acceptance criteria
- `.planning/REQUIREMENTS.md` §Tidsloggning (deferred) — TIME-F01, TIME-F02 explicitly out of scope

### Codebase Conventions
- `.planning/codebase/CONVENTIONS.md` — naming patterns, code style, import organization
- `.planning/codebase/STRUCTURE.md` — project file structure

### Existing Patterns
- `src/pages/Reports.tsx` — existing Tabs structure (Översikt, Trend, Personer, Taggar), Recharts usage, COLORS array, date range filter
- `src/components/KBLinksSection.tsx` — sidebar section pattern (React Query, mutations, cache invalidation, hover-reveal delete)
- `src/pages/TicketDetail.tsx` — sidebar integration point (line ~610+)
- `src/lib/api.ts` — API client pattern for new routes
- `server/src/routes/reports.ts` — existing reports SQL pattern for new time analytics endpoint

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `KBLinksSection.tsx`: Sidebar section pattern with React Query — template for TimeSection
- `Reports.tsx`: Tabs component with Recharts bar charts — extend with "Tid" tab
- `KPICard` component: Could display time summary KPIs
- shadcn `Input`, `Button`, `Badge`, `Card` components
- Recharts `BarChart`, `ResponsiveContainer`, `Tooltip` already imported in Reports

### Established Patterns
- React Query for data fetching + mutations with cache invalidation (useQuery/useMutation)
- Sonner toast for success/error feedback
- Hover-reveal delete buttons (`opacity-0 group-hover:opacity-100`)
- API client class with typed methods in `src/lib/api.ts`
- Express routes in `server/src/routes/` with SQLite queries
- Swedish UI labels throughout

### Integration Points
- TicketDetail.tsx sidebar: Add TimeSection below KBLinksSection
- Reports.tsx Tabs: Add "Tid" TabsTrigger + TabsContent
- server/src/routes/: New `time-entries.ts` route file
- Database: New `time_entries` table (migration or inline CREATE)
- api.ts: New typed methods for time entry CRUD + reports

</code_context>

<specifics>
## Specific Ideas

- Free-text duration parsing should handle Swedish-friendly formats too (e.g., "1t 30m" for timme/minut)
- The "Tid" tab in Reports should use the same Recharts color scheme (COLORS array) as existing charts

</specifics>

<deferred>
## Deferred Ideas

- TIME-F01: Live start/stop timer on ticket detail (explicitly deferred in REQUIREMENTS.md)
- TIME-F02: Quick-select chip buttons for common durations 15m, 30m, 1h (explicitly deferred)

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-time-tracking*
*Context gathered: 2026-04-05*
