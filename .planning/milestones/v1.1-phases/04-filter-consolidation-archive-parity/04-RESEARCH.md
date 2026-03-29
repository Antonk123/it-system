# Phase 4: Filter Consolidation & Archive Parity - Research

**Researched:** 2026-03-26
**Domain:** React component architecture, URL-state filter management, shared component design
**Confidence:** HIGH

## Summary

Phase 4 is a pure frontend refactor with one small backend addition. The work involves merging five separate filter sections on TicketList (filter view bar, main filter bar, date range row, quick filters, active chip rows) into one `UnifiedFilterBar` component, then applying that same component on the Archive page. A new `BulkActionBar` component handles Archive-specific bulk actions including permanent delete.

All the building blocks exist: `StatusMultiSelect`, `TagMultiSelect`, `SearchBar`, `Badge`, `Popover`, `Calendar`, and `FilterViewSelector` are reusable as-is. The `useFilterViews` hook manages localStorage presets via URL params, and the `useTickets` hook already supports all filter params both pages need. The `bulkUpdateTickets` API method covers status and priority changes; a new `DELETE /api/tickets/bulk` endpoint must be added for permanent deletion (single-ticket `DELETE /api/tickets/:id` already exists, bulk does not).

The key design challenge is the `UnifiedFilterBar` props interface: it must be flexible enough to hide the status control on Archive (via `hideStatus` prop) and suppress the date field selector on Archive (Archive always uses `closed_at`). Filter state stays in URL params on both pages — the component receives current state and an `onChange` callback; it does not own state.

**Primary recommendation:** Build `UnifiedFilterBar` as a controlled, stateless component that reads props and fires onChange. Keep all URL-state management in the pages. This avoids duplicating URL sync logic and matches the existing pattern in both TicketList and Archive.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Merge all 5 current filter sections into a single dense row with controls: search, status, priority, category, tags, checklist, date range popover, and views selector.
- **D-02:** Remove quick filter buttons (Hog/Kritisk) entirely. Users who want quick access should save a filter preset instead.
- **D-03:** Active filters display as a unified chip row below the filter controls. All chip types (status, priority, category, tags, date range, checklist) use the same visual style. A "Rensa alla" button at the end clears everything.
- **D-04:** Date range filter becomes a popover dropdown ("Datum" button) containing from/to date pickers and the date field selector (created_at / updated_at / closed_at). Active date range shows as a chip.
- **D-05:** Archive uses the exact same shared UnifiedFilterBar component as TicketList. Status filter is hidden on Archive (all tickets are closed). All other filters are available: priority, category, tags with AND/OR toggle, checklist, date range, search.
- **D-06:** Archive date filter is locked to closed_at only — the date field selector is hidden on the Archive page.
- **D-07:** Archive supports four bulk actions: change status (re-open), change priority, delete permanently (with confirmation dialog), and export selection to CSV.
- **D-08:** Multi-select via checkbox column in the Archive table (same pattern as TicketList). Select-all header checkbox. Selected count shown in a floating action bar at the bottom with bulk action buttons.
- **D-09:** Universal filter presets — one pool of saved views shared across TicketList and Archive. When applied on Archive, incompatible filters (like status) are silently ignored.
- **D-10:** Presets stay in localStorage. No database migration needed. Extend the existing useFilterViews hook to support the Archive page.

### Claude's Discretion

- Exact responsive breakpoints and wrapping behavior for the filter row on mobile
- Internal component structure (how to split the UnifiedFilterBar into sub-components)
- Animation/transition for the date range popover
- Floating action bar design for bulk operations

### Deferred Ideas (OUT OF SCOPE)

- **Checklist calendar bug** — "Kalender-delen fungerar inte" (the calendar part of checklists doesn't work). Needs investigation as a separate bug fix, outside Phase 4 scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FILT-01 | Alla ärenden har en enda konsoliderad filterrad (sök, status, prioritet, kategori, taggar, datum — inga separata snabbfilter eller datumrader) | UnifiedFilterBar component replaces 5 separate sections; quick filter buttons removed (D-02) |
| FILT-02 | Aktiva filter visas som kompakta chips som kan tas bort, integrerade i filterraden | ActiveFilterChips component built from Badge primitives; replaces TagFilter and CategoryFilter display components |
| FILT-03 | Filtervyer (spara/ladda filter-presets) fungerar på både Alla ärenden och Arkiv | useFilterViews hook extended with page-context awareness; applyView silently drops status filter when on Archive |
| FILT-04 | Arkiv-sidan har samma filteralternativ som Alla ärenden (prioritet, checklistefilter, datumfilter) | UnifiedFilterBar with hideStatus=true and hideDateFieldSelector=true used in Archive; same hook pattern |
| FILT-05 | Arkiv-sidan stödjer bulk-operationer (markera flera, ändra status/prioritet) | TicketTable already supports selectedIds/onSelectionChange/onBulkAction props; Archive just needs them wired up; new BulkActionBar component; new backend DELETE /tickets/bulk endpoint needed |
</phase_requirements>

---

## Standard Stack

### Core (already installed — no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | Component model | Project baseline |
| shadcn/ui | — | Button, Popover, Calendar, Select, Command, Checkbox, AlertDialog, Badge | Already in project; all components exist |
| lucide-react | — | Icons (Calendar, X, ChevronDown) | Already in project |
| react-router-dom | — | useSearchParams for URL state | Already in project pattern |
| sonner | — | Toast notifications | Already in project |

### Verified Component Availability

All required shadcn primitives are confirmed present in `src/components/ui/`:

- `calendar.tsx` — confirmed present (for DateRangePopover)
- `popover.tsx` — confirmed present
- `checkbox.tsx` — confirmed present (for row selection in Archive)
- `alert-dialog.tsx` — confirmed present (for delete confirmation)
- `badge.tsx` — confirmed present (base for ActiveFilterChips)
- `command.tsx` — confirmed present (used by StatusMultiSelect, TagMultiSelect)

**Installation:** No new packages. All dependencies exist.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom DateRangePopover | react-datepicker | Not needed; shadcn Calendar already in project |
| URL state for filters | React useState | URL state matches existing pattern; enables bookmark/share of filtered views |

---

## Architecture Patterns

### Recommended Component Structure

```
src/components/
├── UnifiedFilterBar.tsx       # New — single filter row, controlled component
├── ActiveFilterChips.tsx      # New — chip row below filter bar
├── DateRangePopover.tsx       # New — "Datum" button + popover with pickers
├── BulkActionBar.tsx          # New — fixed-bottom floating bar for Archive
├── FilterViewSelector.tsx     # Extend — same component, Archive-aware apply
├── FilterViewManager.tsx      # Extend — minor: display checklist/date filters
└── (all existing components unchanged)
```

### Pattern 1: Controlled UnifiedFilterBar

`UnifiedFilterBar` owns zero state. Pages own all filter state in URL params and pass it down as props.

```typescript
// UnifiedFilterBar props interface
interface UnifiedFilterBarProps {
  // Current filter values (from URL params in parent)
  search: string;
  selectedStatuses: TicketStatus[];
  priorityFilter: TicketPriority | 'all';
  categoryFilter: string;
  selectedTagIds: string[];
  tagMode: 'or' | 'and';
  checklistFilter: string;
  dateFrom: string;
  dateTo: string;
  dateField: 'created_at' | 'updated_at' | 'closed_at';

  // Page-specific overrides
  hideStatus?: boolean;             // true on Archive
  hideDateFieldSelector?: boolean;  // true on Archive (locked to closed_at)

  // Filter preset integration
  views: FilterView[];
  activeViewId: string | null;
  onSelectView: (viewId: string) => void;
  onManageViews: () => void;

  // Single onChange handler — parent updates URL
  onChange: (updates: Record<string, any>) => void;
}
```

**When to use:** Always. Both TicketList and Archive render `UnifiedFilterBar` with their own `onChange` wired to their `updateFilters` function.

### Pattern 2: ActiveFilterChips — Derive from URL State

`ActiveFilterChips` receives the same filter values as `UnifiedFilterBar` and renders one chip per active filter. Category and tag names are resolved by calling existing hooks (`useCategories`, `useTags`) inside the component.

```typescript
interface ActiveFilterChipsProps {
  // Same filter values as UnifiedFilterBar
  selectedStatuses: TicketStatus[];
  priorityFilter: TicketPriority | 'all';
  categoryFilter: string;
  selectedTagIds: string[];
  tagMode: 'or' | 'and';
  checklistFilter: string;
  dateFrom: string;
  dateTo: string;
  dateField: 'created_at' | 'updated_at' | 'closed_at';

  // Individual remove handlers wired to onChange in parent
  onRemoveStatus: (status: TicketStatus) => void;
  onRemovePriority: () => void;
  onRemoveCategory: () => void;
  onRemoveTag: (tagId: string) => void;
  onToggleTagMode: () => void;
  onRemoveChecklist: () => void;
  onRemoveDateRange: () => void;
  onClearAll: () => void;
}
```

### Pattern 3: Archive Bulk Action Integration

Archive.tsx already uses `TicketTable` which supports `selectedIds`, `onSelectionChange`, and `onBulkAction` props. These are already wired in TicketList. Archive needs to:

1. Add `useState<string[]>([])` for `selectedIds`
2. Pass `selectedIds`, `onSelectionChange`, and `onBulkAction` to `TicketTable`
3. Render `BulkActionBar` when `selectedIds.length > 0`
4. Wire Archive-specific bulk actions: re-open (status → 'open'), change priority, export CSV, permanent delete

The existing `bulkUpdateTickets` API call handles re-open and priority change. Export is handled by `api.exportTickets` with `ids` param added. Permanent delete needs a new backend endpoint.

### Pattern 4: useFilterViews Extension for Archive

Current `useFilterViews` hook calls `setSearchParams` directly. It works on both pages because both use `useSearchParams`. The only Archive-specific change is in `applyView`: when called on Archive, silently skip any `status` filter in the preset.

```typescript
// Extension to applyView — add a context param
const applyView = useCallback(
  (view: FilterView, context: 'ticketlist' | 'archive' = 'ticketlist') => {
    // ... existing logic ...
    // Skip status for Archive
    if (context !== 'archive' && view.filters.status?.length) {
      newParams.set('status', view.filters.status.join(','));
    }
    // ... rest unchanged ...
  },
  [searchParams, setSearchParams]
);
```

### Anti-Patterns to Avoid

- **Lifting filter state into UnifiedFilterBar:** The component must remain stateless. Pages own URL state.
- **Duplicating updateFilters logic:** Both pages have identical `updateFilters` callback patterns. Do not copy-paste; both call the same shaped function, just from different pages.
- **Using component-local state for date inputs:** Date picker selection must immediately update URL params (via onChange) to keep URL as single source of truth. Do not buffer in local state.
- **Forgetting tagMode in chip render:** The AND/OR toggle between tag chips must be preserved in `ActiveFilterChips`. The existing `TagFilter` component has this logic — carry it over.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date picker UI | Custom input[type=date] styled component | shadcn `Calendar` in a `Popover` | Calendar is already installed; provides accessible date selection with keyboard nav |
| Multi-select dropdown | Custom dropdown list | Existing `StatusMultiSelect` / `TagMultiSelect` (Popover+Command pattern) | Already handles keyboard nav, search, check state |
| Confirmation dialog | Custom modal | shadcn `AlertDialog` | Already installed, already used in Archive for status confirmation |
| Chip remove button | Custom X button | `Badge` + `X` icon from lucide-react | Matches existing TagFilter chip pattern |
| Floating action bar animation | JS-driven transitions | Tailwind `transition-transform translate-y-full/translate-y-0` | Pure CSS, no deps, matches UI-SPEC (200ms ease-out) |
| Bulk export with IDs | New backend endpoint | Existing `api.exportTickets` with `?ids=` param | The existing export route accepts query params; add IDs to the query string |

**Key insight:** This is almost entirely a component composition problem, not a new functionality problem. The primitives exist — the work is wiring them together correctly.

---

## Backend Gap: Bulk Delete Endpoint

This is the only backend change required for Phase 4.

**Current state:** `DELETE /api/tickets/:id` deletes a single ticket. `PUT /api/tickets/bulk` updates many tickets. No bulk delete endpoint exists.

**Required:** `DELETE /api/tickets/bulk` (or `POST /api/tickets/bulk-delete`) accepting `{ ids: string[] }` in the request body.

**Pattern to follow:** Mirror the existing `PUT /api/tickets/bulk` route structure:
- Validate `ids` is non-empty array
- Run in a `db.transaction()`
- Delete cascade-dependent records (ticket_history, comments, tags, checklists, reminders, attachments, links) then the ticket itself — check what `DELETE /api/tickets/:id` deletes to copy that cascade logic

**Location:** `server/src/routes/tickets.ts` around line 1077, after the existing bulk update route.

**Frontend API client addition:**

```typescript
// In src/lib/api.ts
async bulkDeleteTickets(ids: string[]): Promise<{ deleted: number }> {
  return this.request('/tickets/bulk-delete', {
    method: 'DELETE',
    body: { ids },
  });
}
```

---

## Common Pitfalls

### Pitfall 1: useFilterViews Hook Initialized in Wrong Scope

**What goes wrong:** If `useFilterViews` is called inside `UnifiedFilterBar`, it creates a separate hook instance per component render. The hook reads/writes localStorage on init and calls `setSearchParams`, causing conflicts.

**Why it happens:** Hook called in child component instead of page-level component.

**How to avoid:** Call `useFilterViews` only in the page component (TicketList, Archive). Pass `views`, `activeViewId`, `onSelectView`, `onManageViews` as props to `UnifiedFilterBar`.

**Warning signs:** Double-write to localStorage, stale view state after navigation.

### Pitfall 2: Archive "activeView" Deactivation Logic Missing

**What goes wrong:** On TicketList, changing any filter manually calls `setActiveView(null)` (line 133 in TicketList.tsx). Archive does not have this. After Phase 4, Archive also has the preset selector, so it needs the same deactivation logic.

**How to avoid:** In Archive's `updateFilters` function, add `setActiveView(null)` the same way TicketList does. This requires Archive to also call `useFilterViews` and receive `setActiveView`.

### Pitfall 3: Checklist Filter Not in FilterView Type

**What goes wrong:** `FilterView.filters` type in `src/types/filterView.ts` does not include `checklist`, `dateFrom`, `dateTo`, or `dateField`. Saving a preset while a checklist or date filter is active will silently drop those filters from the saved preset.

**How to avoid:** Extend the `FilterView` interface before implementing preset save:

```typescript
export interface FilterView {
  // ... existing fields ...
  filters: {
    status?: string[];
    priority?: string;
    category?: string;
    tags?: string[];
    tagMode?: 'or' | 'and';
    search?: string;
    // Add these:
    checklist?: string;
    dateFrom?: string;
    dateTo?: string;
    dateField?: 'created_at' | 'updated_at' | 'closed_at';
  };
  // ...
}
```

Also extend `getCurrentFiltersAsView` and `applyView` in `useFilterViews.ts` to include the new fields.

### Pitfall 4: Archive Bulk Export Must Force status=closed

**What goes wrong:** `api.exportTickets` builds query params from the filter state. If a preset is applied that doesn't include `status=closed`, Archive export will return non-closed tickets.

**How to avoid:** In Archive's `handleBulkExport`, always force `params.append('status', 'closed')` regardless of what filters are active, and additionally pass `?ids=` for the selection. If the existing export endpoint does not support `ids`, it will export all matching filters — for the selection export, either add `ids` support to the backend export route or build the CSV client-side from the already-loaded ticket data.

**Recommendation:** Build Archive bulk export client-side from `selectedIds` mapped to the loaded `tickets` array. This avoids a backend change and is simpler for the Archive use case (selection is visible, data is loaded).

### Pitfall 5: TagMode Missing from Unified Chip Row

**What goes wrong:** When multiple tags are selected, the AND/OR toggle between chips is part of `TagFilter` component. If `ActiveFilterChips` replaces `TagFilter` without carrying over the toggle, users lose the ability to switch between AND/OR.

**How to avoid:** `ActiveFilterChips` must render the AND/OR clickable label between consecutive tag chips, using `tagMode` prop and `onToggleTagMode` callback. Copy the pattern from `TagFilter.tsx` lines 31-38.

---

## Code Examples

### DateRangePopover Structure

```typescript
// Source: shadcn Calendar component (already in project)
// Pattern: Popover trigger + Calendar pickers

export function DateRangePopover({ dateFrom, dateTo, dateField, hideDateFieldSelector, onChange }) {
  const [open, setOpen] = useState(false);
  const isActive = !!(dateFrom || dateTo);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10 gap-2">
          {isActive && <span className="w-2 h-2 rounded-full bg-primary" />}
          <Calendar className="w-4 h-4" />
          Datum
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-4 space-y-4">
        {!hideDateFieldSelector && (
          // Radio-style date field selector
        )}
        <div className="space-y-2">
          <Label>Från</Label>
          <input type="date" value={dateFrom} onChange={...} />
        </div>
        <div className="space-y-2">
          <Label>Till</Label>
          <input type="date" value={dateTo} onChange={...} />
        </div>
        {isActive && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ dateFrom: undefined, dateTo: undefined })}>
            Rensa datum
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

### BulkActionBar Slide Animation

```typescript
// Pure CSS transition — no animation library needed
<div
  className={cn(
    "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
    "flex items-center gap-3 px-4 py-2",
    "bg-card shadow-lg rounded-lg border",
    "transition-transform duration-200",
    selectedIds.length > 0 ? "translate-y-0" : "translate-y-[200%]"
  )}
>
  <span className="text-sm">{selectedIds.length} ärende(n) valda</span>
  {/* Action buttons */}
</div>
```

### ActiveFilterChips Chip Anatomy

```typescript
// One chip — same markup for all filter types
<Badge
  variant="secondary"
  className="flex items-center gap-1 pr-1 border border-primary text-xs font-semibold"
>
  <span className="text-muted-foreground">{label}:</span>
  {value}
  <button
    onClick={onRemove}
    className="ml-1 rounded-sm hover:text-destructive p-0.5"
  >
    <X className="w-3 h-3" />
  </button>
</Badge>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Date inputs as raw `input[type=date]` in page | DateRangePopover component with shadcn Calendar | Phase 4 | Cleaner UI; less vertical space |
| TagFilter + CategoryFilter as separate display rows | ActiveFilterChips unified row | Phase 4 | Single consistent chip pattern |
| Quick filter buttons (Hog/Kritisk) | Removed; use presets instead | Phase 4 | Fewer UI elements; presets more powerful |
| Archive without bulk ops | Archive with full BulkActionBar | Phase 4 | Parity with TicketList |

**Removed in this phase:**
- `TagFilter` component: replaced by `ActiveFilterChips` (may keep file for safety, but Archive and TicketList stop using it)
- `CategoryFilter` component: same — replaced by `ActiveFilterChips`
- Quick filter priority buttons in both pages

---

## Open Questions

1. **Bulk export via IDs — backend or client-side?**
   - What we know: `api.exportTickets` sends a GET with query params; selected ticket data is already in memory on Archive page
   - What's unclear: Whether adding `ids` param to the backend export is worth the backend change vs. client-side CSV generation from loaded data
   - Recommendation: Client-side CSV generation for Archive bulk export. The Archive table is paginated (10/page) so the selection is constrained to the current page's loaded data, which is sufficient.

2. **Should checklist and date filters be saveable in presets?**
   - What we know: FilterView type does not include `checklist`, `dateFrom`, `dateTo`, `dateField`
   - What's unclear: User intent (CONTEXT.md does not address this explicitly)
   - Recommendation: Yes, extend FilterView to include all filter params. Partial preset support (only some filters saved) would be confusing.

3. **Does TicketTable's bulk action bar conflict with the new Archive BulkActionBar?**
   - What we know: TicketTable already renders a bulk action bar inline when `selectedIds.length > 0` (line 308). The UI-SPEC defines a separate fixed-position `BulkActionBar` for Archive.
   - What's unclear: Whether to reuse TicketTable's inline bar or bypass it with a new floating component
   - Recommendation: Pass `onBulkAction` to TicketTable for Archive to get the checkbox selection behavior, but suppress TicketTable's built-in bar by not passing `onBulkAction` — instead, render the external `BulkActionBar`. Wire TicketTable's `onSelectionChange` to Archive's `selectedIds` state and let `BulkActionBar` call the API directly. This avoids modifying TicketTable.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — pure frontend component work with one backend route addition to existing Express server).

---

## Sources

### Primary (HIGH confidence)
- Direct source code reading — `src/pages/TicketList.tsx`, `src/pages/Archive.tsx` — current 5-section filter implementation mapped
- Direct source code reading — `src/hooks/useFilterViews.ts` — localStorage preset hook, full implementation reviewed
- Direct source code reading — `src/types/filterView.ts` — FilterView type missing checklist/date fields confirmed
- Direct source code reading — `server/src/routes/tickets.ts` lines 995-1077 — bulk update exists; no bulk delete endpoint confirmed
- Direct source code reading — `src/lib/api.ts` — `bulkUpdateTickets`, `deleteTicket`, `exportTickets` methods reviewed
- Direct source code reading — `src/components/TicketTable.tsx` — selectedIds/onSelectionChange/onBulkAction prop interface confirmed; existing bulk action bar implementation reviewed
- UI-SPEC `04-UI-SPEC.md` — component inventory, interaction contracts, copy contract all reviewed

### Secondary (MEDIUM confidence)
- `src/components/ui/calendar.tsx` confirmed present — Calendar component available for DateRangePopover

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified by direct file inspection
- Architecture: HIGH — based on reading actual current implementation; patterns confirmed
- Pitfalls: HIGH — identified from reading existing code patterns and type definitions
- Backend gap: HIGH — searched routes file; no bulk delete endpoint found

**Research date:** 2026-03-26
**Valid until:** 2026-04-25 (stable codebase; frontend-only changes)
