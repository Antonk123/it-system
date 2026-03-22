# Phase 3: Archive Enhancement - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a closed-date range filter to the Archive page so tickets can be filtered by when they were closed. Backed by a composite database index on `(status, closed_at)` for fast queries. No new pages, no new features beyond this filter.

</domain>

<decisions>
## Implementation Decisions

### Date filter placement
- New row below the existing search/category/tag filter row
- Labeled "Stängd period:" with two date inputs side by side: "Från" and "Till"
- Consistent with the existing filter layout style

### Partial range behavior
- Both inputs are independently optional
- "From" only → filters from that date to now
- "To" only → filters from the beginning up to that date
- Both set → filters between the two dates
- Neither set → no date filtering (default, shows all archived tickets)

### Clear behavior
- Single "Rensa datum" button that clears both inputs at once
- Button only visible when at least one date is set

### URL persistence
- Date filters persist in URL params (`dateFrom`, `dateTo`) — consistent with how category, priority, and tags are handled in `Archive.tsx`

### Backend approach
- Reuse existing `dateFrom`/`dateTo`/`dateField` query params in the tickets route
- Add `closed_at` to `allowedDateFields` in `tickets.ts` (currently only `created_at`/`updated_at`)
- Archive page passes `dateField=closed_at` alongside `dateFrom`/`dateTo`
- No new endpoint needed

### Database index
- Composite index: `idx_tickets_closed_at ON tickets(status, closed_at DESC)`
- Added in `connection.ts` as an idempotent `CREATE INDEX IF NOT EXISTS` — same pattern as other indexes

### Claude's Discretion
- Exact input component (native `<input type="date">` or shadcn equivalent)
- Spacing and visual alignment within the filter row
- Swedish label wording

</decisions>

<specifics>
## Specific Ideas

No specific UI references — standard date range filter behavior is fine.

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in decisions above.

### Requirements
- `ARCH-01`: Archive page supports filtering by closed date range (from/to date pickers)
- `ARCH-02`: Database index on `(status, closed_at)` for fast archive queries

### Key files to read before planning
- `server/src/routes/tickets.ts` §dateFrom/dateTo (lines ~390-401) — existing date filter logic; add `closed_at` to `allowedDateFields`
- `server/src/db/connection.ts` §initializeDatabase — where to add the `CREATE INDEX IF NOT EXISTS`
- `src/pages/Archive.tsx` §filter bar (lines ~251-305) — where to add the date row and URL param handling

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `dateFrom`/`dateTo`/`dateField` query params already exist in `tickets.ts` — just add `closed_at` to `allowedDateFields`
- `updateFilters()` in `Archive.tsx` — handles URL param updates; use same pattern for `dateFrom`/`dateTo`
- `searchParams.get()` pattern in `Archive.tsx` — read the new params from URL the same way as `category`, `priority`, `tags`

### Established Patterns
- All filters in `Archive.tsx` use URL search params for persistence — date filter follows same pattern
- `connection.ts` adds indexes inline in `initializeDatabase()` with `CREATE INDEX IF NOT EXISTS` — follow same pattern

### Integration Points
- Archive fetch URL (line ~186 in `Archive.tsx`) already builds query string from filter state — extend it to append `dateFrom`, `dateTo`, `dateField=closed_at` when set

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-archive-enhancement*
*Context gathered: 2026-03-22*
