# Phase 11: Form Simplification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 11-form-simplification
**Areas discussed:** Section layout, Template picker UX, Searchable dropdowns, Edit view simplification

---

## Section Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Progressive disclosure | Title + Description always visible. Details collapsed. Bilagor + Checklista collapsed. | ✓ |
| Smart defaults | Everything visible, but Details auto-filled with defaults. | |
| Two-step | Wizard-style: Step 1 essentials, Step 2 details. | |

**User's choice:** Progressive disclosure
**Notes:** User specified Kategori must stay visible alongside Title and Description, not be hidden in collapsed Detaljer.

### Follow-up: Beställare placement

| Option | Description | Selected |
|--------|-------------|----------|
| Visible with Kategori | Title + Description + Kategori + Beställare always visible | ✓ |
| In Detaljer section | Only Title + Description + Kategori visible | |

**User's choice:** Visible with Kategori

---

## Template Picker UX

| Option | Description | Selected |
|--------|-------------|----------|
| Dropdown next to Title | Small dropdown/combobox beside Title field | ✓ |
| Dropdown above form | Full-width dropdown at top, before Title | |
| Inline chip selector | Templates as clickable pills below title | |

**User's choice:** Dropdown next to Title

### Follow-up: Auto-fill behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-fill title (current behavior) | Selecting template fills title field | ✓ |
| Leave title empty | Template only fills description/fields | |

**User's choice:** Auto-fill title (keep current behavior)

---

## Searchable Dropdowns

| Option | Description | Selected |
|--------|-------------|----------|
| Category + Template only | Variable-length lists. Priority/Status stay plain Select. | ✓ |
| All dropdowns | Everything becomes combobox | |
| Category + Template + Tags | Plus tags get searchable multi-select | |

**User's choice:** Category + Template only

### Follow-up: Scroll bug fix approach

| Option | Description | Selected |
|--------|-------------|----------|
| Combobox pattern (Command+Popover) | Replace Radix Select, fixes scroll jump, adds search | ✓ |
| Fix Radix Select | Keep Select, fix positioning bug only | |

**User's choice:** Combobox pattern — user confirmed with screenshot showing 9+ categories in buggy Radix Select

---

## Edit View Simplification

| Option | Description | Selected |
|--------|-------------|----------|
| Add-button row | Empty fields as clickable chips: [+ Lösning] [+ Anteckningar] | ✓ |
| Collapsible section | Same collapsible pattern as create form | |
| Always show all | Keep current behavior | |

**User's choice:** Add-button row

### Follow-up: Edit view collapsible sections

| Option | Description | Selected |
|--------|-------------|----------|
| Same collapsibles as create | Bilagor/Checklista collapsed on edit too | |
| Always visible on edit | Everything visible except empty Lösning/Anteckningar | ✓ |

**User's choice:** Always visible on edit

---

## Claude's Discretion

- Collapsible component choice (Collapsible vs Accordion vs custom)
- Animation/transition style for expand/collapse
- Template combobox exact sizing/placement
- Whether to extract CategoryCombobox as separate component

## Deferred Ideas

None — discussion stayed within phase scope.
