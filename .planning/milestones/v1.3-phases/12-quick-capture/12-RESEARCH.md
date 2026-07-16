# Phase 12: Quick Capture - Research

**Researched:** 2026-03-30
**Domain:** React frontend — FAB/Popover UI, auth detection, location-state pre-fill
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Title-Only Creation Flow (QCAP-01)**
- D-01: Entry point is a floating action button (FAB) in the bottom-right corner, persistent across all pages (or at least ticket-related pages).
- D-02: Clicking the FAB opens a small floating popover/card with just a title input + submit button. Minimal, stays in context.
- D-03: Auto-defaults on quick-create: priority = medium, category = none, requester = current logged-in user.
- D-04: After submit: stay on current page, show success toast with a link to the new ticket.

**Public Form Auth Detection (QCAP-02)**
- D-05: Auto-detect valid auth token on `/submit-ticket` load. If present, hide name/email fields and show an "Inloggad som [namn]" badge. Submit uses their user ID directly.
- D-06: Logged-in public form also gets quick-create treatment — title-only with same auto-defaults as FAB. Ultra-fast path.

**Ticket Cloning (QCAP-03)**
- D-07: Clone button lives on the ticket detail page action bar (alongside Edit/Delete/Share).
- D-08: Fields that carry over: title, description, category, priority, template fields. Status resets to "open", requester set to current user, no attachments/checklist/notes copied.
- D-09: Clicking "Klona" navigates to `/tickets/new` with fields pre-populated. User reviews/edits before submitting.

### Claude's Discretion
- FAB visual design (icon, size, color, animation on click)
- Popover card styling and positioning
- How auth token check is implemented on the public form (existing token refresh interceptor vs direct check)
- Clone button icon and placement within the detail page action bar
- How pre-filled form data is passed to /tickets/new (URL params, location state, or context)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QCAP-01 | User can create a ticket with just a title — priority, category, and tags default automatically | FAB + QuickCapturePopover component; `api.createTicket` with hardcoded defaults; `useAuth` provides logged-in user ID for requester_id |
| QCAP-02 | Public form skips name/email when used by the logged-in user, acting as a quick-add | `localStorage.getItem('auth_token')` + `api.getMe()` called on mount in PublicTicketForm; server-side public route requires name+email but needs a bypass path for authenticated users; alternatively call authenticated `/tickets` endpoint instead |
| QCAP-03 | User can clone an existing ticket as a new one with title, description, category, and template fields pre-filled | `navigate('/tickets/new', { state: { cloneData } })` from TicketDetail; TicketForm reads `location.state` in a useEffect to hydrate formData; template field values loaded via `api.getTicket(id)` |
</phase_requirements>

---

## Summary

Phase 12 is a pure frontend change — three independent UI features added on top of the existing ticket system with no new backend routes or database schema changes required. The primary technical risk is correctly wiring the FAB's quick-create call to `api.createTicket` with the logged-in user's ID as `requester_id`, which requires access to `useAuth` context from within a component mounted at layout level.

The public form auth detection (QCAP-02) has a subtle server-side constraint: the existing `POST /public/tickets` endpoint requires `name`, `email`, and `title` fields. When the user is logged in, the form must either (a) bypass the public route and call the authenticated `POST /tickets` endpoint instead, or (b) pass the logged-in user's name/email as hidden values. Option (a) is cleaner and maps to D-05's intent ("Submit uses their user ID directly"). This is the recommended approach.

Ticket cloning (QCAP-03) is the most mechanically involved: the TicketDetail page must fetch full template field values from `api.getTicket(id)` (since the list endpoint omits `field_values`), then pass them as `location.state.cloneData` to `/tickets/new`. TicketForm already reads `useLocation` for `state.from` navigation — extending it to also read `state.cloneData` for pre-fill is minimal.

**Primary recommendation:** Implement as three isolated tasks — FAB component, public form auth gate, clone button + TicketForm pre-fill hook — in that order, since QCAP-01 is the most visible and tests the layout-level injection pattern that confirms the approach.

---

## Standard Stack

### Core (all already installed — no new dependencies)

| Library | Version in use | Purpose | Notes |
|---------|---------------|---------|-------|
| React | 18.x | Component rendering | — |
| react-router-dom | 6.x | `useNavigate`, `useLocation`, `location.state` | Pre-fill pattern already used in TicketForm for `state.from` |
| shadcn/ui | current | Button, Input, Popover, Tooltip | All already in project |
| lucide-react | current | Icons: `Plus`, `Copy`, `User` | Already imported in TicketDetail |
| sonner | current | Toast notifications | `toast.success(...)` used throughout |
| @tanstack/react-query | 5.x | Ticket mutations via `useTickets` | `addTicket` mutation handles cache invalidation |
| AuthContext | — | `useAuth()` → `user.id`, `user.email` | Already wired into App.tsx |

**No new npm packages required.** All primitives are already present.

---

## Architecture Patterns

### Component Structure

```
src/
├── components/
│   └── QuickCaptureFAB.tsx        # NEW — FAB + Popover, self-contained
├── pages/
│   ├── TicketForm.tsx             # MODIFIED — read location.state.cloneData on mount
│   ├── TicketDetail.tsx           # MODIFIED — add clone button to action bar
│   └── PublicTicketForm.tsx       # MODIFIED — auth detection, conditional fields
└── App.tsx                        # MODIFIED — render <QuickCaptureFAB /> inside ProtectedRoute
```

### Pattern 1: FAB Mounted at Layout Level (App.tsx)

The UI-SPEC specifies that the FAB lives inside `ProtectedRoute` in App.tsx, after the Routes block. The current `ProtectedRoute` wraps each route individually, so the FAB must be co-located with the auth guard:

```tsx
// App.tsx — AppRoutes component
// The FAB cannot go inside ProtectedRoute easily since ProtectedRoute wraps individual routes.
// Better approach: add a new authenticated layout shell in AppRoutes.

const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
    <Route path="/submit-ticket" element={<PublicTicketForm />} />
    {/* ... other public routes ... */}
    <Route path="/*" element={
      <ProtectedRoute>
        <>
          <AuthenticatedRoutes />
          <QuickCaptureFAB />
        </>
      </ProtectedRoute>
    } />
  </Routes>
);
```

**Alternative (simpler):** Render `<QuickCaptureFAB />` inside `AuthContext`-aware component that calls `useAuth()` and only renders when `isAuthenticated`. Mount it unconditionally in `App` inside `AuthProvider` scope. This avoids restructuring AppRoutes.

```tsx
// QuickCaptureFAB.tsx — guards its own rendering
const QuickCaptureFAB = () => {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return null;
  // ... render FAB
};
```

This is the **recommended approach** — zero restructuring of App.tsx routing, just add `<QuickCaptureFAB />` as a sibling of `<AppRoutes />` inside `<AuthProvider>`.

### Pattern 2: Quick-Create API Call

The FAB popover submits a minimal ticket. Since `useTickets`'s `addTicket` mutation runs Zod validation that requires `description`, the FAB must call `api.createTicket` directly (bypassing the hook's Zod validation), or pass a placeholder description:

```tsx
// Option A: Call api.createTicket directly (recommended — avoids Zod description requirement)
const handleQuickSubmit = async (title: string) => {
  setIsSubmitting(true);
  try {
    const newTicket = await api.createTicket({
      title,
      description: '',        // empty is allowed at DB level
      status: 'open',
      priority: 'medium',
      category_id: null,
      requester_id: user.id,  // from useAuth()
    });
    toast.success(`Ärende skapat — Öppna ärende #${newTicket.id}`, {
      action: { label: 'Öppna', onClick: () => navigate(`/tickets/${newTicket.id}`) },
    });
    queryClient.invalidateQueries({ queryKey: ticketKeys.lists() });
    setOpen(false);
  } catch {
    toast.error('Något gick fel. Försök igen eller ladda om sidan.');
  } finally {
    setIsSubmitting(false);
  }
};
```

**Important:** Check whether the server-side `POST /tickets` allows empty description. Looking at `ticketInsertSchema`, description is `min(1)` — this means the Zod validation in `useTickets.addTicket` will reject empty descriptions. However, `api.createTicket` calls the server directly. The server-side validation is separate — review `server/src/routes/tickets.ts` to confirm the server allows `description: ''` or if it also enforces non-empty.

**Fallback if server also requires description:** Pass `description: ' '` (single space) as the minimal valid value. This satisfies string min-length and does not display anything meaningful in the UI.

### Pattern 3: Public Form Auth Detection (QCAP-02)

The public form runs outside `ProtectedRoute` — it cannot use `useAuth()` (which would throw if used outside `AuthProvider`). However, `AuthProvider` wraps all of `App` including the public route, so `useAuth()` IS available.

```tsx
// PublicTicketForm.tsx — auth detection on mount
const { user, isLoading: authLoading } = useAuth();
const isLoggedIn = !!user;

// When logged in, render differently:
// 1. Hide name/email fields (display:none, not unmounted — for accessibility)
// 2. Show InloggedBadge with user name
// 3. Submit to authenticated endpoint: api.createTicket({ requester_id: user.id, ... })
//    instead of api.submitPublicTicket({ name, email, ... })
```

The `AuthProvider` is the parent of `AppRoutes` in App.tsx, so `useAuth()` is safely available from PublicTicketForm.

**Server constraint:** `POST /public/tickets` validates `name` and `email` as required. When a logged-in user submits, call `POST /tickets` (authenticated endpoint) instead. The authenticated user's `requester_id` replaces the contact lookup. This means the success path in PublicTicketForm has two branches.

### Pattern 4: Ticket Clone via location.state

```tsx
// TicketDetail.tsx — clone handler
const handleClone = () => {
  // Fetch full ticket detail to get field_values (list endpoint omits them)
  // Already fetched in the existing useEffect for ticketFieldValues — reuse it
  navigate('/tickets/new', {
    state: {
      cloneData: {
        title: ticket.title,
        description: ticket.description,
        category: ticket.category || 'none',
        priority: ticket.priority,
        templateId: ticket.templateId,
        customFieldValues: ticketFieldValues.map(fv => ({
          fieldName: fv.field_name,
          fieldLabel: fv.field_label,
          fieldValue: fv.field_value,
        })),
      }
    }
  });
  toast.success(`Formuläret förfyllt från ärende #${ticket.id}`);
};
```

```tsx
// TicketForm.tsx — read cloneData on mount (add to existing useEffect)
const location = useLocation(); // already imported and used

useEffect(() => {
  const cloneData = location.state?.cloneData;
  if (cloneData && !isEditing) {
    setFormData(prev => ({
      ...prev,
      title: cloneData.title || '',
      description: cloneData.description || '',
      priority: cloneData.priority || 'medium',
      category: cloneData.category || 'none',
    }));
    if (cloneData.templateId) {
      // Load template to activate DynamicFieldsForm
      // Use same pattern as the existing loadTicketAndTemplate useEffect
    }
    if (cloneData.customFieldValues?.length) {
      setEditInitialFieldValues(cloneData.customFieldValues);
    }
  }
}, []); // run once on mount
```

**Note on template field pre-fill:** If the source ticket had a template with dynamic fields, the clone must also set `selectedTemplate` so DynamicFieldsForm renders. This requires calling `api.getTemplate(templateId)` and mapping to the Template shape — same code already exists in the edit-mode `loadTicketAndTemplate` useEffect. Extract that logic or duplicate it.

### Anti-Patterns to Avoid

- **Using `useTickets().addTicket` for quick-create:** The hook's Zod schema requires `description min(1)`. Call `api.createTicket` directly for the FAB popover to avoid this constraint.
- **Restructuring App.tsx routes:** Not needed. `QuickCaptureFAB` can self-guard with `useAuth()`.
- **Fetching ticket data again in clone handler:** `ticketFieldValues` is already fetched in TicketDetail's existing `useEffect`. Reuse it — don't add a second API call.
- **Calling `/public/tickets` when logged in:** That endpoint requires name/email and does a contact lookup — wrong path for authenticated users. Call the authenticated `/tickets` endpoint instead.
- **Unmounting name/email inputs when auth detected:** UI-SPEC says `hidden` class, not removed from DOM, for accessibility. Keep elements in DOM.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Popover positioning | Custom float/portal logic | shadcn `Popover` (Radix UI) | Already in project; handles viewport collision, focus trap, dismiss-on-outside-click |
| Toast with action link | Custom notification | `sonner` `toast.success` with `action` prop | Already used project-wide |
| Auth state in FAB | Re-fetch `/auth/me` | `useAuth()` context | Already resolved and cached in AuthContext |
| Cache invalidation after quick-create | Manual state update | `queryClient.invalidateQueries({ queryKey: ticketKeys.lists() })` | React Query handles all ticket list consumers |

---

## Common Pitfalls

### Pitfall 1: Server description validation blocks quick-create
**What goes wrong:** FAB submits `description: ''` → server's ticket route rejects with 400 "Description is required".
**Why it happens:** `ticketInsertSchema` (Zod) requires `description min(1)`. The server-side route likely mirrors this.
**How to avoid:** Check `server/src/routes/tickets.ts` validation before implementing. If empty description is rejected, submit `description: ' '` (single space) or `description: title` (copy title as description for quick tickets).
**Warning signs:** API error on first FAB test submission.

### Pitfall 2: useAuth() outside AuthProvider throws
**What goes wrong:** `useAuth()` in `QuickCaptureFAB` or `PublicTicketForm` throws "useAuth must be used within an AuthProvider".
**Why it happens:** Component mounted outside the `<AuthProvider>` wrapper in App.tsx.
**How to avoid:** Verify component is rendered inside `<AuthProvider>` in the tree. Current App.tsx wraps `AppRoutes` in `AuthProvider` — as long as FAB is inside that wrapper, it is safe. PublicTicketForm is already inside AuthProvider (it's in AppRoutes).
**Warning signs:** Runtime error on any page where FAB renders.

### Pitfall 3: Clone loses template field values
**What goes wrong:** Cloned ticket opens TicketForm with title/description pre-filled but no DynamicFieldsForm.
**Why it happens:** `selectedTemplate` is `null` on mount — the template is only loaded in the edit-mode `loadTicketAndTemplate` useEffect which only runs when `isEditing && id`.
**How to avoid:** When `cloneData.templateId` is present, call `api.getTemplate(templateId)` in a useEffect on mount, set `selectedTemplate`, and set `editInitialFieldValues` from `cloneData.customFieldValues`.
**Warning signs:** DynamicFieldsForm does not appear after cloning a ticket that originally used a dynamic template.

### Pitfall 4: Public form "Inloggad som" shows wrong name
**What goes wrong:** Badge shows email or undefined instead of a readable name.
**Why it happens:** `AuthUser` type (from `api.getMe()`) has `id`, `email`, `role` — no `name` field. There is no display name on the auth user.
**How to avoid:** Use `user.email` in the badge, or derive first name from email (e.g., split on `@` and `capitalize`). The UI-SPEC says "Inloggad som [firstName]" — document that firstName is derived from email as `email.split('@')[0]` if no display name is available. Consider using a `User` record lookup via `useUsers()` matching `user.id` if display name is needed.
**Warning signs:** Badge displays a raw email address or "undefined".

### Pitfall 5: FAB overlaps mobile content
**What goes wrong:** FAB at `bottom-6 right-6` covers action buttons on small screens.
**Why it happens:** Fixed positioning does not account for page content.
**How to avoid:** `z-50` ensures FAB is above content. On ticket detail page the action bar is at top — no overlap. Accept this as a known product decision (standard FAB pattern).
**Warning signs:** User reports button hidden behind FAB.

---

## Code Examples

### QuickCaptureFAB skeleton

```tsx
// src/components/QuickCaptureFAB.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { ticketKeys } from '@/hooks/useTickets';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

export const QuickCaptureFAB = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [titleError, setTitleError] = useState(false);

  if (!isAuthenticated) return null;

  const handleSubmit = async () => {
    if (!title.trim()) { setTitleError(true); return; }
    setIsSubmitting(true);
    try {
      const newTicket = await api.createTicket({
        title: title.trim(),
        description: ' ',      // minimal valid — server may require non-empty
        status: 'open',
        priority: 'medium',
        category_id: null,
        requester_id: user!.id,
      });
      queryClient.invalidateQueries({ queryKey: ticketKeys.lists() });
      setOpen(false);
      setTitle('');
      toast.success('Ärende skapat', {
        action: { label: 'Öppna', onClick: () => navigate(`/tickets/${newTicket.id}`) },
      });
    } catch {
      toast.error('Något gick fel. Försök igen eller ladda om sidan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg
                         bg-primary text-primary-foreground
                         hover:scale-105 hover:shadow-xl active:scale-95
                         transition-transform duration-200 animate-scale-in"
            >
              <Plus className="h-6 w-6" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Snabbt ärende</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" side="top" className="w-80 p-6">
        <p className="text-base font-semibold mb-4">Nytt ärende</p>
        <Input
          autoFocus
          value={title}
          onChange={(e) => { setTitle(e.target.value); setTitleError(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="Vad behöver du hjälp med?"
          className={titleError ? 'border-destructive' : ''}
        />
        {titleError && (
          <p className="text-xs text-destructive mt-1">Ange en rubrik för att fortsätta</p>
        )}
        <Button
          className="w-full mt-4"
          onClick={handleSubmit}
          disabled={isSubmitting || !title.trim()}
        >
          {isSubmitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sparar...</> : 'Skicka in'}
        </Button>
      </PopoverContent>
    </Popover>
  );
};
```

### PublicTicketForm auth detection

```tsx
// PublicTicketForm.tsx — add near top of component
const { user, isLoading: authLoading } = useAuth();
const isLoggedIn = !!user;

// In handleSubmit — branch on auth state
if (isLoggedIn) {
  // Authenticated path: call internal ticket API
  await api.createTicket({
    title: formData.title,
    description: formData.description || ' ',
    status: 'open',
    priority: formData.priority,
    category_id: formData.category || null,
    requester_id: user.id,
    customFields: customFieldValues.length > 0 ? customFieldValues : undefined,
    template_id: selectedTemplate?.id || null,
  });
} else {
  // Anonymous path: existing submitPublicTicket
  await api.submitPublicTicket({ ... });
}

// In render — conditionally show name/email
<div className={isLoggedIn ? 'hidden' : ''}>
  {/* name + email inputs */}
</div>
{isLoggedIn && (
  <div className="inline-flex items-center gap-1.5 bg-primary/15 text-primary border
                  border-primary/30 rounded-full px-3 py-1 text-sm">
    <User className="h-3.5 w-3.5" />
    Inloggad som {user.email.split('@')[0]}
  </div>
)}
```

### TicketForm clone pre-fill

```tsx
// TicketForm.tsx — add new useEffect after existing existingTicket useEffect
useEffect(() => {
  const cloneData = location.state?.cloneData;
  if (!cloneData || isEditing) return;

  setFormData(prev => ({
    ...prev,
    title: cloneData.title || '',
    description: cloneData.description || '',
    priority: cloneData.priority || 'medium',
    category: cloneData.category || 'none',
  }));

  if (cloneData.templateId) {
    // Load template so DynamicFieldsForm renders
    setIsLoadingTemplate(true);
    api.getTemplate(cloneData.templateId).then((freshTemplate) => {
      if (freshTemplate?.fields?.length > 0) {
        const mapped: Template = {
          id: freshTemplate.id,
          name: freshTemplate.name,
          description: freshTemplate.description,
          titleTemplate: freshTemplate.title_template,
          descriptionTemplate: freshTemplate.description_template,
          priority: freshTemplate.priority as Template['priority'],
          category: freshTemplate.category_id,
          notesTemplate: freshTemplate.notes_template,
          solutionTemplate: freshTemplate.solution_template,
          position: freshTemplate.position,
          createdBy: freshTemplate.created_by,
          createdAt: new Date(freshTemplate.created_at),
          updatedAt: new Date(freshTemplate.updated_at),
          fields: freshTemplate.fields,
        };
        setSelectedTemplate(mapped);
        if (cloneData.customFieldValues?.length) {
          setEditInitialFieldValues(cloneData.customFieldValues);
        }
      }
    }).catch(() => {
      // Template deleted — pre-fill fields silently ignored
    }).finally(() => {
      setIsLoadingTemplate(false);
    });
  }
}, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally run once
```

---

## Key Integration Points

### Action Bar Order (TicketDetail.tsx)

Current order: Dela (Share) | Påminnelse | Redigera | Ta bort

Decided order from UI-SPEC D-07: "between Dela and Radera" in the action bar.

After insertion: Dela | Påminnelse | Redigera | **Klona ärende** | Ta bort

The `Copy` icon from lucide-react is already imported in TicketDetail.tsx (line 5). No new imports required for the clone button.

### Server-Side Check Required

Before implementing the FAB, verify `server/src/routes/tickets.ts` to confirm whether description is required. This is the one unknown that affects the `description: ' '` vs `description: ''` choice. The client-side Zod schema (`ticketInsertSchema`) requires `description min(1)`, which strongly suggests the server mirrors this.

### AuthUser type vs User display name

`AuthUser` (from `api.getMe()`) has: `id`, `email`, `role`. No `name` field.
`User` (from `useUsers()`) has: `id`, `name`, `email`, `department`, `createdAt`.

For the "Inloggad som [namn]" badge, derive first name from email: `user.email.split('@')[0]`. If a display name is needed, call `useUsers()` and find the user with matching id — but this requires loading all users just for a badge. The email-split approach is simpler and acceptable.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all changes are frontend code modifications using already-installed packages).

---

## Open Questions

1. **Server-side description validation**
   - What we know: Client Zod schema requires `description min(1)`. FAB will not provide a description.
   - What's unclear: Whether `server/src/routes/tickets.ts` also enforces this (not read during research).
   - Recommendation: Read `server/src/routes/tickets.ts` as first action in Wave 1, and handle with `description: ' '` if required.

2. **Public form quick-create — should it be title-only per D-06?**
   - What we know: D-06 says "Logged-in public form also gets quick-create treatment — title-only with same auto-defaults as FAB."
   - What's unclear: The public form currently shows description, category, priority, template, and file upload. D-06 implies hiding all except title when logged in.
   - Recommendation: When `isLoggedIn`, show only the title input and submit button (matching FAB behavior). Category and priority remain hidden/auto-defaulted as per D-03.

---

## Sources

### Primary (HIGH confidence)

- Direct code read: `src/pages/TicketForm.tsx` — formData shape, location.state usage, template loading pattern
- Direct code read: `src/pages/PublicTicketForm.tsx` — current form fields, submitPublicTicket call
- Direct code read: `src/pages/TicketDetail.tsx` — action bar structure, Copy icon already imported, ticketFieldValues state
- Direct code read: `src/contexts/AuthContext.tsx` — useAuth() returns { user, isAuthenticated, isLoading }
- Direct code read: `src/lib/api.ts` — createTicket, submitPublicTicket, getMe signatures
- Direct code read: `src/lib/validations.ts` — ticketInsertSchema requires description min(1)
- Direct code read: `server/src/routes/public.ts` — POST /public/tickets requires name+email+title
- Direct code read: `src/App.tsx` — AuthProvider wraps AppRoutes; route for /submit-ticket is NOT in ProtectedRoute
- Direct code read: `.planning/phases/12-quick-capture/12-UI-SPEC.md` — component specs, animations, copy

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed and in active use
- Architecture patterns: HIGH — patterns derived directly from reading existing code
- Pitfalls: HIGH (pitfall 1) — server validation check needed before confirming; MEDIUM (pitfalls 2-5) — derived from code analysis
- Open questions: 2 low-risk items, both have clear resolution paths

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable React/shadcn stack)
