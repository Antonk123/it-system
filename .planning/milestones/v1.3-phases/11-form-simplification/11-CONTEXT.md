# Phase 11: Form Simplification - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Rework ticket create and edit forms to be leaner — progressive disclosure on create, hidden empty fields on edit, inline template picker, and searchable comboboxes for category and template. No new features or capabilities.

</domain>

<decisions>
## Implementation Decisions

### Section Layout — Create Form (FORM-01)
- **D-01:** Progressive disclosure. Title + Beskrivning + Kategori + Beställare always visible. Prioritet defaults to Medium and goes into a collapsed "Detaljer" section. Bilagor and Checklista also collapsed by default.
- **D-02:** Template dropdown sits next to the Title field (inline, not a separate modal or dialog). See D-05.
- **D-03:** Collapsed sections use Collapsible or Accordion components (already in ui/). Each section expandable independently.

### Section Layout — Edit Form (FORM-02)
- **D-04:** Edit view keeps all fields visible (no collapsible sections for Bilagor, Checklista, etc.). The only hidden elements are empty Lösning and Interna anteckningar — shown as clickable add-buttons: `[+ Lösning] [+ Anteckningar]`. Clicking expands the RichTextEditor inline. Fields with existing content always display.

### Template Picker (FORM-03)
- **D-05:** Replace the current Dialog modal with a dropdown/combobox next to the Title field. Searchable if templates grow. Selecting a template auto-fills title (current behavior), description/fields, priority, and category. A "clear template" action restores free-form mode.
- **D-06:** Remove the "Skapa från mall" button and the entire Dialog component for template selection.

### Searchable Dropdowns (FORM-04)
- **D-07:** Category and Template become searchable Comboboxes using Command+Popover pattern (same as UserCombobox). This fixes the Radix Select scroll-jump bug on category (confirmed via user screenshot — 9+ categories, no search, popper positioning issues).
- **D-08:** Priority (4 items) and Status (5 items) stay as plain Radix Select — too few options for search to add value.
- **D-09:** Tags are not part of this phase's searchable scope.

### Claude's Discretion
- Collapsible component choice (Collapsible vs Accordion vs custom) — pick what fits the layout best
- Animation/transition style for section expand/collapse
- Exact placement and sizing of the template combobox relative to the Title field
- Whether to extract a generic `CategoryCombobox` component or keep it inline

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Form Components
- `src/pages/TicketForm.tsx` — Main 770-line form component to refactor (create + edit modes)
- `src/components/UserCombobox.tsx` — Reference implementation for searchable combobox (Command+Popover pattern to replicate)
- `src/components/DynamicFieldsForm.tsx` — Template dynamic fields renderer (keep as-is, just wire into new layout)

### UI Primitives
- `src/components/ui/collapsible.tsx` — Radix Collapsible primitive (for section toggling)
- `src/components/ui/command.tsx` — cmdk Command component (for searchable dropdowns)
- `src/components/ui/select.tsx` — Current Radix Select (being replaced for category/template)
- `src/components/ui/accordion.tsx` — Alternative to Collapsible if multiple sections

### Hooks
- `src/hooks/useCategories.ts` — Category data hook (React Query, 10min cache)
- `src/hooks/useTemplates.ts` — Template data hook

### Requirements
- `.planning/REQUIREMENTS.md` — FORM-01 through FORM-04 definitions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `UserCombobox` — Proven Command+Popover searchable combobox. Pattern to follow for CategoryCombobox and TemplateCombobox.
- `collapsible.tsx` / `accordion.tsx` — Radix primitives already installed, ready for section toggling.
- `DynamicFieldsForm` — Template field renderer, no changes needed — just needs to render inside the new layout.

### Established Patterns
- Form state managed via `useState` with individual `formData` object — not React Hook Form
- Validation via zod schemas (`ticketInsertSchema`, `ticketUpdateSchema`)
- Toast notifications via `sonner` for user feedback
- `useCallback` for handlers, `useEffect` for data loading

### Integration Points
- `TicketForm.tsx` is the only file that needs major changes — it handles both create and edit modes
- Template selection currently sets `selectedTemplate` state + calls `setFormData` — this wiring stays, just the trigger changes from Dialog to Combobox
- Category inline creation (`Ny kategori...` + `Lägg till`) should stay but move into the combobox or below it

</code_context>

<specifics>
## Specific Ideas

- User confirmed category dropdown has scroll-jump bug with 9+ items (Radix Select popper positioning) — Combobox pattern fixes this
- The "Ny kategori" inline creation field should remain accessible (currently below the Select)
- Template auto-fill includes title (user confirmed keeping current behavior)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 11-form-simplification*
*Context gathered: 2026-03-30*
