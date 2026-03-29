# Phase 4: Filter Consolidation & Archive Parity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-26
**Phase:** 04-filter-consolidation-archive-parity
**Areas discussed:** Filter row consolidation, Archive filter parity, Bulk operations on Archive, Filter presets sharing

---

## Filter Row Consolidation

### Layout Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Single dense row | All controls in one horizontal row. Quick filter buttons removed. Active filters as removable chips below. | ✓ |
| Two-tier row | Top tier: search + most-used. Bottom tier: tags, checklist, date. Quick filters kept. | |
| Collapsible panel | Search always visible + toggle button for filter panel. | |

**User's choice:** Single dense row
**Notes:** None

### Quick Filter Buttons

| Option | Description | Selected |
|--------|-------------|----------|
| Remove them | Quick filter buttons are redundant with Priority dropdown and saved presets. | ✓ |
| Keep as preset shortcuts | Convert to clickable preset chips alongside filter row. | |
| You decide | Claude's discretion. | |

**User's choice:** Remove them
**Notes:** None

### Active Filter Chips

| Option | Description | Selected |
|--------|-------------|----------|
| Unified chip row | All active filters shown as uniform removable chips in one row. Same style for all. "Rensa alla" at end. | ✓ |
| Grouped by type | Chips grouped by filter type with subtle separators. Each group has own clear button. | |
| You decide | Claude's discretion on chip styling. | |

**User's choice:** Unified chip row
**Notes:** None

### Date Range Filter

| Option | Description | Selected |
|--------|-------------|----------|
| Popover dropdown | "Datum" button opens popover with from/to pickers and field selector. Active range shows as chip. | ✓ |
| Inline date inputs | Keep from/to date inputs visible in the filter row. | |

**User's choice:** Popover dropdown
**Notes:** None

---

## Archive Filter Parity

### Shared Component

| Option | Description | Selected |
|--------|-------------|----------|
| Same component | One shared UnifiedFilterBar on both pages. Archive hides status filter. Everything else shared. | ✓ |
| Subset variant | Simpler version for Archive: search, category, tags, date, priority. No checklist. | |
| You decide | Claude picks the right level of parity. | |

**User's choice:** Same component
**Notes:** None

### Date Field on Archive

| Option | Description | Selected |
|--------|-------------|----------|
| closed_at only | Archive keeps date filter locked to closed_at. Date field selector hidden. | ✓ |
| All date fields | Archive allows same date field selector as TicketList. | |
| You decide | Claude picks. | |

**User's choice:** closed_at only
**Notes:** None

---

## Bulk Operations on Archive

### Available Actions

| Option | Description | Selected |
|--------|-------------|----------|
| Change status | Bulk re-open archived tickets. | ✓ |
| Change priority | Bulk update priority. | ✓ |
| Delete permanently | Bulk delete with confirmation dialog. | ✓ |
| Export selection | Export selected tickets to CSV. | ✓ |

**User's choice:** All four actions selected
**Notes:** User also mentioned a checklist calendar bug ("Kalender-delen fungerar inte") — noted as deferred idea, outside Phase 4 scope.

### Selection UI

| Option | Description | Selected |
|--------|-------------|----------|
| Checkbox column | Checkbox column in table, select-all header, floating action bar at bottom. | ✓ |
| Click-to-select rows | Click rows to toggle, shift+click for range. No checkboxes. | |
| You decide | Claude picks. | |

**User's choice:** Checkbox column
**Notes:** None

---

## Filter Presets Sharing

### Preset Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Universal presets | One pool shared across both pages. Incompatible filters silently ignored on Archive. | ✓ |
| Page-specific presets | Separate pools for TicketList and Archive. | |
| You decide | Claude picks. | |

**User's choice:** Universal presets
**Notes:** None

### Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Keep localStorage | No migration needed. Extend useFilterViews hook. Single-user so no sync concern. | ✓ |
| Move to database | SQLite filter_views table. Survives cache clears. Requires new API. | |
| You decide | Claude picks. | |

**User's choice:** Keep localStorage
**Notes:** None

---

## Claude's Discretion

- Responsive breakpoints and wrapping behavior for filter row on mobile
- Internal component structure for UnifiedFilterBar
- Animation/transition for date range popover
- Floating action bar design for bulk operations

## Deferred Ideas

- Checklist calendar bug — "Kalender-delen fungerar inte" — separate investigation needed
