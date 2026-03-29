# Phase 4: Filter Consolidation & Archive Parity - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a single coherent filter experience across all ticket views (TicketList and Archive). Merge the current 5 separate filter sections into one unified filter row. Bring Archive to full parity with the ticket list's filter, preset, and bulk-action capabilities.

</domain>

<decisions>
## Implementation Decisions

### Filter Row Consolidation
- **D-01:** Merge all 5 current filter sections (filter view bar, main filter bar, date range row, quick filter buttons, active chips area) into a single dense row with all controls: search, status, priority, category, tags, checklist, date range popover, and views selector.
- **D-02:** Remove quick filter buttons (Hog/Kritisk) entirely. Users who want quick access should save a filter preset instead.
- **D-03:** Active filters display as a unified chip row below the filter controls. All chip types (status, priority, category, tags, date range, checklist) use the same visual style. A "Rensa alla" button at the end clears everything.
- **D-04:** Date range filter becomes a popover dropdown ("Datum" button) containing from/to date pickers and the date field selector (created_at / updated_at / closed_at). Active date range shows as a chip.

### Archive Filter Parity
- **D-05:** Archive uses the exact same shared UnifiedFilterBar component as TicketList. Status filter is hidden on Archive (all tickets are closed). All other filters are available: priority, category, tags with AND/OR toggle, checklist, date range, search.
- **D-06:** Archive date filter is locked to closed_at only — the date field selector is hidden on the Archive page.

### Bulk Operations on Archive
- **D-07:** Archive supports four bulk actions: change status (re-open), change priority, delete permanently (with confirmation dialog), and export selection to CSV.
- **D-08:** Multi-select via checkbox column in the Archive table (same pattern as TicketList). Select-all header checkbox. Selected count shown in a floating action bar at the bottom with bulk action buttons.

### Filter Presets Sharing
- **D-09:** Universal filter presets — one pool of saved views shared across TicketList and Archive. When applied on Archive, incompatible filters (like status) are silently ignored.
- **D-10:** Presets stay in localStorage. No database migration needed. Extend the existing useFilterViews hook to support the Archive page.

### Claude's Discretion
- Exact responsive breakpoints and wrapping behavior for the filter row on mobile
- Internal component structure (how to split the UnifiedFilterBar into sub-components)
- Animation/transition for the date range popover
- Floating action bar design for bulk operations

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — FILT-01 through FILT-05 define the acceptance criteria for this phase

### Existing Filter Implementation
- `src/pages/TicketList.tsx` — Current ticket list with 5 filter sections (lines 312-458)
- `src/pages/Archive.tsx` — Current archive page with 4 filter sections (lines 259-348)
- `src/components/FilterViewSelector.tsx` — Saved filter view dropdown
- `src/components/FilterViewManager.tsx` — Create/delete saved filter views dialog
- `src/hooks/useFilterViews.ts` — LocalStorage-based filter preset hook
- `src/types/filterView.ts` — FilterView type definition

### Shared Filter Components
- `src/components/StatusMultiSelect.tsx` — Multi-checkbox status picker
- `src/components/TagMultiSelect.tsx` — Multi-checkbox tag picker
- `src/components/TagFilter.tsx` — Tag chips with AND/OR toggle
- `src/components/CategoryFilter.tsx` — Category chip display
- `src/components/SearchBar.tsx` — Search input component

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **StatusMultiSelect** — Multi-select status picker with Popover + Command pattern, reuse directly in unified filter
- **TagMultiSelect** — Multi-select tag picker, same pattern, reuse directly
- **TagFilter / CategoryFilter** — Active filter chip display, will be replaced by unified chip row component
- **FilterViewSelector / FilterViewManager** — Preset system, keep and extend for Archive support
- **useFilterViews hook** — localStorage preset management, extend to work on Archive page
- **Badge component** (`src/components/ui/badge.tsx`) — Base for unified filter chips
- **TagBadges** — Tag display with color dots and "+N more" indicator, may inform chip design

### Established Patterns
- **Popover + Command** pattern for multi-select dropdowns (used by StatusMultiSelect, TagMultiSelect)
- **React Query** for data fetching (categories, tags via hooks)
- **URL state persistence** for Archive date filter params
- **shadcn/Radix UI** for all UI primitives (Button, Popover, Select, Command, Dialog, AlertDialog)

### Integration Points
- Both TicketList.tsx and Archive.tsx manage filter state locally — new shared component needs to accept filter state + onChange callbacks as props
- TicketList line ~133: manual filter changes deactivate active filter view — this logic moves into the shared component
- Archive.tsx uses separate API params for its query — the shared filter component must output compatible filter objects for both pages
- Bulk operations on Archive need the same selection state pattern already in TicketList

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The key constraint is visual and functional consistency between the two pages.

</specifics>

<deferred>
## Deferred Ideas

- **Checklist calendar bug** — "Kalender-delen fungerar inte" (the calendar part of checklists doesn't work). Needs investigation as a separate bug fix, outside Phase 4 scope.

</deferred>

---

*Phase: 04-filter-consolidation-archive-parity*
*Context gathered: 2026-03-26*
