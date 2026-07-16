# Phase 11: Form Simplification - Research

**Researched:** 2026-03-30
**Domain:** React form UX — progressive disclosure, searchable comboboxes, inline template picker
**Confidence:** HIGH

## Summary

Phase 11 is a pure frontend refactor of `TicketForm.tsx` (770 lines). The goal is leaner forms through three mechanisms: (1) collapsible sections on the create form using already-installed Radix Collapsible/Accordion primitives, (2) hidden-until-clicked empty fields on edit, and (3) replacement of the Dialog-based template picker and the Radix Select category dropdown with Popover+Input searchable comboboxes.

All required UI primitives (`Collapsible`, `Accordion`, `Command`, `Popover`, `Select`, `Button`, `Input`, `RichTextEditor`) are already installed in `src/components/ui/`. No new package installs are needed. The `UserCombobox` component provides the exact Popover+Input search pattern to replicate for `CategoryCombobox` and `TemplateCombobox`. The `accordion-down`/`accordion-up` keyframes and animations are already declared in `tailwind.config.ts`.

The form manages state with plain `useState` + a `formData` object (not React Hook Form). Template auto-fill sets `selectedTemplate` state and calls `setFormData`. Both patterns are preserved — only the UI surface changes. The key complexity is the `CategoryCombobox` "Ny kategori" inline-creation row that must survive the Radix Select replacement.

**Primary recommendation:** Build `CategoryCombobox` and `TemplateCombobox` as extracted components mirroring `UserCombobox`. Restructure `TicketForm.tsx` in-place using `Collapsible` for create-mode sections and state-gated add-buttons for edit-mode empty fields. No backend changes needed.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Progressive disclosure on create form. Title + Beskrivning + Kategori + Beställare always visible. Prioritet defaults to Medium and goes into a collapsed "Detaljer" section. Bilagor and Checklista also collapsed by default.

**D-02:** Template dropdown sits next to the Title field (inline, not a separate modal or dialog).

**D-03:** Collapsed sections use Collapsible or Accordion components (already in ui/). Each section expandable independently.

**D-04:** Edit view keeps all fields visible (no collapsible sections for Bilagor, Checklista, etc.). The only hidden elements are empty Lösning and Interna anteckningar — shown as clickable add-buttons: `[+ Lösning] [+ Anteckningar]`. Clicking expands the RichTextEditor inline. Fields with existing content always display.

**D-05:** Replace the current Dialog modal with a dropdown/combobox next to the Title field. Searchable if templates grow. Selecting a template auto-fills title (current behavior), description/fields, priority, and category. A "clear template" action restores free-form mode.

**D-06:** Remove the "Skapa från mall" button and the entire Dialog component for template selection.

**D-07:** Category and Template become searchable Comboboxes using Command+Popover pattern (same as UserCombobox). This fixes the Radix Select scroll-jump bug on category.

**D-08:** Priority (4 items) and Status (5 items) stay as plain Radix Select — too few options for search to add value.

**D-09:** Tags are not part of this phase's searchable scope.

### Claude's Discretion

- Collapsible component choice (Collapsible vs Accordion vs custom) — pick what fits the layout best
- Animation/transition style for section expand/collapse
- Exact placement and sizing of the template combobox relative to the Title field
- Whether to extract a generic `CategoryCombobox` component or keep it inline

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FORM-01 | Ticket create/edit form uses collapsible sections (basics, details, template fields) — only expand what's needed | Radix Collapsible + existing `accordion-down` keyframes cover this. Create form gets collapsible "Detaljer" and "Bilagor & Checklista" sections. Edit form does NOT get collapsible sections per D-04. |
| FORM-02 | Ticket edit view hides empty optional fields (notes, solution, custom fields) until user clicks to add them | State-gated pattern: check `formData.solution === ''` and `formData.notes === ''`, render ghost Button add-buttons. On click, set a `showSolution`/`showNotes` boolean state. Already loaded values always display. |
| FORM-03 | Template picker is a lightweight dropdown on the create form instead of a separate flow | `TemplateCombobox` using Popover+Input pattern (mirrors UserCombobox). Replaces `templateDialogOpen` state and `<Dialog>` block. The `selectedTemplate` state and `setFormData` auto-fill logic stay unchanged — only the trigger UI changes. |
| FORM-04 | All dropdowns (category, priority, assignee, template, tags) are searchable/filterable | Per D-07/D-08/D-09: Category → `CategoryCombobox`. Template → `TemplateCombobox`. UserCombobox already searchable. Priority/Status stay as Radix Select. Tags out of scope. |
</phase_requirements>

---

## Standard Stack

### Core (all already installed — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@radix-ui/react-collapsible` | installed | Collapsible section toggle (create form) | Already wired in `ui/collapsible.tsx` |
| `@radix-ui/react-accordion` | installed | Alternative multi-section toggle | Already wired in `ui/accordion.tsx` — has built-in `accordion-down` animation |
| `@radix-ui/react-popover` | installed | Combobox dropdown container | Used by UserCombobox — proven in production |
| `@radix-ui/react-select` | installed | Priority + Status dropdowns (stays) | Good for small fixed-option lists |
| `lucide-react` | installed | Icons (ChevronDown, PlusCircle, Check, ChevronsUpDown, Search) | Project standard |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sonner` | installed | Toast notifications | Form submit feedback — existing pattern |
| `@tanstack/react-query` | installed | Data hooks (`useCategories`, `useTemplates`) | Already powering all data fetching |

**Installation:** No installs required. All primitives are in `src/components/ui/`.

---

## Architecture Patterns

### Recommended File Changes

```
src/
├── components/
│   ├── CategoryCombobox.tsx        # NEW — extracted from TicketForm (mirrors UserCombobox)
│   ├── TemplateCombobox.tsx        # NEW — inline template picker (mirrors UserCombobox)
│   └── UserCombobox.tsx            # UNCHANGED — reference implementation
├── pages/
│   └── TicketForm.tsx              # MODIFIED — restructured layout, import new comboboxes
```

Extraction is recommended over inline for both new comboboxes. The `CategoryCombobox` has its own "Ny kategori" creation logic that would bloat an already large form file.

### Pattern 1: Combobox (Popover + Input search)

The established pattern from `UserCombobox.tsx`. All new comboboxes follow this — NOT the `cmdk` Command wrapper pattern. The UI-SPEC explicitly states "no Command wrapper — mirrors UserCombobox pattern, not cmdk Command."

```typescript
// Pattern from src/components/UserCombobox.tsx
const [open, setOpen] = useState(false);
const [search, setSearch] = useState('');

const filtered = useMemo(() => {
  if (!search) return items;
  return items.filter(item => item.label.toLowerCase().includes(search.toLowerCase()));
}, [items, search]);

return (
  <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
        {selectedLabel ?? placeholder}
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-[260px] p-0 bg-popover border border-border z-50" align="start">
      <div className="flex items-center border-b px-3 py-2">
        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        <Input
          placeholder="Sök..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 border-0 bg-transparent p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
      <div className="max-h-60 overflow-y-auto">
        {filtered.map(item => (
          <div
            key={item.id}
            className={cn('flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60', value === item.id && 'bg-muted/60')}
            onClick={() => { onValueChange(item.id); setOpen(false); setSearch(''); }}
          >
            <Check className={cn('h-4 w-4 shrink-0', value === item.id ? 'opacity-100' : 'opacity-0')} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </PopoverContent>
  </Popover>
);
```

### Pattern 2: Collapsible Section (create form)

Uses `Collapsible` from `ui/collapsible.tsx`. The `accordion-down` / `accordion-up` animations already declared in `tailwind.config.ts` apply when content height transitions. The `CollapsibleContent` needs `overflow-hidden` for the animation to work correctly.

```typescript
// Source: src/components/ui/collapsible.tsx + tailwind.config.ts
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

const [detailsOpen, setDetailsOpen] = useState(false);

<Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
  <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-card px-4 h-11 text-sm font-semibold hover:bg-accent/10 transition-colors">
    <span>Detaljer</span>
    <div className="flex items-center gap-2">
      {/* Badge: show "1 valt" when non-default values exist */}
      {nonDefaultCount > 0 && (
        <span className="text-xs text-muted-foreground">{nonDefaultCount} valt</span>
      )}
      <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', detailsOpen && 'rotate-180')} />
    </div>
  </CollapsibleTrigger>
  <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
    <div className="pt-4 space-y-4">
      {/* Prioritet Select */}
    </div>
  </CollapsibleContent>
</Collapsible>
```

**Important:** `CollapsibleContent` does not automatically apply `accordion-down` animations — those are baked into the `AccordionContent` wrapper in `ui/accordion.tsx`. For `Collapsible`, add `data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden` classes manually on `CollapsibleContent`.

### Pattern 3: Hidden Add-Button (edit form)

For FORM-02 — empty optional fields replaced by ghost add-buttons.

```typescript
// Two state booleans, initialized based on whether field has content
const [showSolution, setShowSolution] = useState(!!existingTicket?.solution);
const [showNotes, setShowNotes] = useState(!!existingTicket?.notes);

// In render (edit mode only):
{showSolution ? (
  <div className="space-y-2">
    <Label htmlFor="solution">Lösning</Label>
    <RichTextEditor ... />
  </div>
) : (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    className="text-muted-foreground hover:text-foreground"
    onClick={() => setShowSolution(true)}
  >
    <PlusCircle className="mr-2 h-4 w-4" />
    + Lösning
  </Button>
)}
```

**Initialization rule:** `showSolution` starts `true` if `existingTicket.solution` is non-empty, `false` if empty. This ensures existing content always displays on load.

### Pattern 4: Template Combobox Clear Action

The current "clear template" logic is a `<button>` that calls `setSelectedTemplate(null)` and `setCustomFieldValues([])`. The new TemplateCombobox must expose a "Rensa mall" action:

```typescript
// After selection, show clear link below or inside combobox
{selectedTemplate && (
  <button
    type="button"
    className="text-xs text-accent hover:text-accent/80 mt-1"
    onClick={() => {
      setSelectedTemplate(null);
      setCustomFieldValues([]);
      setEditInitialFieldValues([]);
    }}
  >
    Rensa mall
  </button>
)}
```

The auto-fill logic on template selection (lines 447-458 in current TicketForm) moves into the `TemplateCombobox`'s `onSelect` callback prop — the same state mutations, just triggered differently.

### Pattern 5: CategoryCombobox with Inline Creation

The current "Ny kategori" input+button lives below the Radix Select. In `CategoryCombobox`, it becomes a footer row inside the popover:

```typescript
// Last item in the scrollable list — always visible
<div
  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60 border-t border-border/40"
  onClick={() => setShowNewInput(true)}
>
  <PlusCircle className="h-4 w-4 text-muted-foreground" />
  <span className="text-sm text-muted-foreground">Ny kategori...</span>
</div>
{showNewInput && (
  <div className="flex gap-2 px-3 py-2 border-t border-border/40">
    <Input
      autoFocus
      placeholder="Kategorinamn..."
      value={newCategoryName}
      onChange={(e) => setNewCategoryName(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
      className="h-8"
    />
    <Button size="sm" onClick={handleAddCategory} disabled={isAddingCategory}>
      Lägg till
    </Button>
  </div>
)}
```

### Anti-Patterns to Avoid

- **Replacing UserCombobox with cmdk Command:** UI-SPEC explicitly says "no Command wrapper." UserCombobox uses Popover+Input, not Command.
- **Collapsible without overflow-hidden:** Without `overflow-hidden` on CollapsibleContent, the height animation won't clip properly and content flickers into view instantly.
- **Initializing showSolution/showNotes to false when content exists:** If an existing ticket has a solution and we initialize `showSolution = false`, the user loses access to their data until they click. Always check content presence at init.
- **Removing selectedTemplate state on Dialog deletion:** `templateDialogOpen` state is removed, but `selectedTemplate` and the auto-fill `setFormData` block stay. Only the trigger mechanism changes.
- **Breaking DynamicFieldsForm wiring:** `DynamicFieldsForm` renders when `selectedTemplate && selectedTemplate.fields.length > 0`. This condition and the `handleCustomFieldsChange` callback must survive the refactor.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Animated collapse/expand | Custom CSS height animation | `Collapsible` + existing `accordion-down` keyframes | Radix handles a11y (aria-expanded), timing, and the height transition uses `--radix-collapsible-content-height` CSS var |
| Search filtering | Debounced fetch or fuse.js | `useMemo` filter (already in UserCombobox) | Synchronous in-memory filter is fast enough for <50 items |
| Keyboard navigation in combobox | Manual keydown handlers | Popover + `div` list is sufficient; arrow key nav via tabIndex if needed | UserCombobox works without arrow-key list navigation — match existing UX |

---

## Common Pitfalls

### Pitfall 1: Collapsible Animation Not Firing

**What goes wrong:** Section snaps open/closed without animation.
**Why it happens:** `CollapsibleContent` in `ui/collapsible.tsx` is a bare Radix primitive with no animation classes. Unlike `AccordionContent` (which has them baked in), `CollapsibleContent` needs animation classes added at usage site.
**How to avoid:** Apply `className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up"` directly on `CollapsibleContent`.
**Warning signs:** Section instantly appears/disappears without transition.

### Pitfall 2: showSolution/showNotes State Desync on Load

**What goes wrong:** Edit form loads an existing ticket with a solution but "Lösning" field is hidden behind the add-button.
**Why it happens:** `showSolution` initialized to `false` unconditionally before `existingTicket` data arrives.
**How to avoid:** Initialize `showSolution` in a `useEffect` that runs when `existingTicket` loads: `setShowSolution(!!existingTicket?.solution)`.
**Warning signs:** Existing solution content invisible on first render, reappears after state update.

### Pitfall 3: Category "none" Value Handling

**What goes wrong:** `CategoryCombobox` doesn't handle the `'none'` sentinel value that means "no category."
**Why it happens:** Current code uses `value="none"` in the Radix Select as a "Ingen kategori" option. A combobox based on the categories array won't include this.
**How to avoid:** Add a hardcoded "Ingen kategori" entry at the top of the combobox list with `id: 'none'`. Ensure `onValueChange('none')` clears the category correctly.
**Warning signs:** Category field stuck, or "none" stored as a literal category ID.

### Pitfall 4: Template Auto-Fill Description Conflict with DynamicFieldsForm

**What goes wrong:** After selecting a template with dynamic fields, both the standard RichTextEditor description and DynamicFieldsForm render simultaneously.
**Why it happens:** Template fill sets `selectedTemplate` (triggers DynamicFieldsForm) but description field isn't cleared.
**How to avoid:** The existing auto-fill logic at TicketForm lines 447-458 sets `description: hasFields ? '' : template.descriptionTemplate` — preserve this logic exactly when moving the trigger to TemplateCombobox.
**Warning signs:** Two description sections appear at once.

### Pitfall 5: Popover z-index Inside Card

**What goes wrong:** Combobox popover renders behind the Card component or adjacent form elements.
**Why it happens:** Stacking context from parent Card elevation.
**How to avoid:** `PopoverContent` already uses `z-50` in UserCombobox — replicate this. Test both comboboxes visually in the Card context.
**Warning signs:** Popover list appears clipped or behind other elements.

---

## Code Examples

### CategoryCombobox skeleton (verified against UserCombobox pattern)

```typescript
// src/components/CategoryCombobox.tsx
interface CategoryComboboxProps {
  categories: Category[];
  value: string;                    // 'none' or category.id
  onValueChange: (value: string) => void;
  onAddCategory: (label: string) => Promise<void>;
  placeholder?: string;
}
```

The `onAddCategory` prop receives the `addCategory` function from `useCategories` — the combobox handles its own `newCategoryName` state internally.

### TemplateCombobox skeleton

```typescript
// src/components/TemplateCombobox.tsx
interface TemplateComboboxProps {
  templates: Template[];
  selectedTemplate: Template | null;
  onSelect: (template: Template) => void;
  onClear: () => void;
  placeholder?: string;
}
```

`onSelect` receives the full `Template` object so `TicketForm` can run the auto-fill logic. `onClear` resets `selectedTemplate` and `customFieldValues`.

### Collapsible badge count (details section)

```typescript
// Count non-default values in the Detaljer section
const detailsBadgeCount = useMemo(() => {
  let count = 0;
  if (formData.priority !== 'medium') count++;
  // Status only appears in edit mode, skip for create
  return count;
}, [formData.priority]);
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Dialog modal for template selection | Inline Popover combobox next to Title | Reduces steps: was 2 clicks (button → pick), becomes 1 interaction |
| Radix Select for category (scroll-jump bug) | Popover+Input combobox | Fixes reported scroll-jump on 9+ categories |
| All optional fields always visible | Progressive disclosure (create) + add-buttons (edit) | Shorter initial form — user sees only what they need |

**Deprecated in this phase:**
- `templateDialogOpen` state variable: removed
- `<Dialog>` / `<DialogContent>` import block in TicketForm: removed
- `LayoutTemplate` icon import (used only for the Dialog trigger button): removed
- Direct Radix Select on category: replaced by CategoryCombobox

---

## Open Questions

1. **Accordion vs Collapsible for create form sections**
   - What we know: Both are installed; Accordion uses `type="multiple"` for independent section control; Collapsible is simpler for single sections
   - What's unclear: Whether two Collapsibles or one Accordion with `type="multiple"` is cleaner for the "Detaljer" + "Bilagor & Checklista" sections
   - Recommendation: Use two independent `Collapsible` components (matches D-03 "each section expandable independently" and avoids Accordion's border-b default styling that would need overriding)

2. **TemplateCombobox placement — next to Title or below Title**
   - What we know: D-02 says "next to Title field"; UI-SPEC says "next to or below Titel field"
   - What's unclear: CSS layout — same row (grid/flex) or stacked
   - Recommendation: Same row using a 2-column grid (`grid-cols-[1fr_auto]`), combobox ~240px wide. Falls back to stacked on mobile.

3. **showSolution / showNotes initialization timing**
   - What we know: `existingTicket` may be `null` on first render (data is sync from `getTicketById` which reads from React Query cache)
   - What's unclear: Whether the cache is always populated before component mounts (it should be, given `useTickets` preloads)
   - Recommendation: Initialize in the same `useEffect` that populates `formData` (lines 98-111), setting `showSolution`/`showNotes` alongside other field hydration.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely frontend code changes. No external tools, services, CLIs, or databases are involved beyond the existing project stack.

---

## Project Constraints (from CLAUDE.md)

| Directive | Applies To |
|-----------|------------|
| Simplicity First: minimal code impact | Don't refactor unrelated parts of TicketForm; only change what the requirements touch |
| No Laziness: find root causes | Category scroll-jump is a Radix Select positioning bug — fix at root by replacing the component, not by patching popper options |
| Plan First: write plan to tasks/todo.md | Planner must write tasks/todo.md before implementation begins |
| No React Hook Form — form state is plain useState + formData object | Keep existing state management pattern; do not migrate to RHF |
| Toast notifications via sonner | Feedback messages on template load, category add stay as `toast.success()` / `toast.error()` |
| Frontend aesthetics: Plus Jakarta Sans, slate/dark theme, CSS variables | New components inherit existing theme; no new fonts or color schemes |

---

## Sources

### Primary (HIGH confidence)
- `src/components/UserCombobox.tsx` — definitive Popover+Input combobox pattern for this codebase
- `src/pages/TicketForm.tsx` — full current implementation; all state variables, handlers, and existing Dialog/Select blocks confirmed by direct read
- `src/components/ui/collapsible.tsx` — confirmed bare Radix primitive (no animation classes baked in)
- `src/components/ui/accordion.tsx` — confirmed has `data-[state=open]:animate-accordion-down` baked into AccordionContent
- `tailwind.config.ts` — confirmed `accordion-down` / `accordion-up` keyframes at 0.2s ease-out
- `.planning/phases/11-form-simplification/11-UI-SPEC.md` — interaction contract and copy strings

### Secondary (MEDIUM confidence)
- `.planning/phases/11-form-simplification/11-CONTEXT.md` — user decisions D-01 through D-09
- `src/hooks/useCategories.ts`, `src/hooks/useTemplates.ts` — confirmed hook API signatures

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components read directly from source, no package lookups needed
- Architecture patterns: HIGH — patterns derived from existing working code (UserCombobox), not hypothetical
- Pitfalls: HIGH — identified from direct code analysis (scroll-jump confirmed by user, collapsible animation gap identified from source diff between CollapsibleContent and AccordionContent)

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable stack, no external dependencies)
