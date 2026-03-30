# Phase 12: Quick Capture - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can create a ticket in seconds with just a title (FAB quick-create), skip name/email on the public form when logged in (auto-detect auth), and clone past tickets as new pre-filled forms. Three distinct entry points for faster ticket creation — no new ticket fields, no settings, no workflow changes.

</domain>

<decisions>
## Implementation Decisions

### Title-Only Creation Flow (QCAP-01)
- **D-01:** Entry point is a floating action button (FAB) in the bottom-right corner, persistent across all pages (or at least ticket-related pages).
- **D-02:** Clicking the FAB opens a small floating popover/card with just a title input + submit button. Minimal, stays in context.
- **D-03:** Auto-defaults on quick-create: priority = medium, category = none, requester = current logged-in user.
- **D-04:** After submit: stay on current page, show success toast with a link to the new ticket.

### Public Form Auth Detection (QCAP-02)
- **D-05:** Auto-detect valid auth token on `/submit-ticket` load. If present, hide name/email fields and show an "Inloggad som [namn]" badge. Submit uses their user ID directly.
- **D-06:** Logged-in public form also gets quick-create treatment — title-only with same auto-defaults as FAB. Ultra-fast path.

### Ticket Cloning (QCAP-03)
- **D-07:** Clone button lives on the ticket detail page action bar (alongside Edit/Delete/Share).
- **D-08:** Fields that carry over: title, description, category, priority, template fields. Status resets to "open", requester set to current user, no attachments/checklist/notes copied.
- **D-09:** Clicking "Klona" navigates to `/tickets/new` with fields pre-populated. User reviews/edits before submitting.

### Claude's Discretion
- FAB visual design (icon, size, color, animation on click)
- Popover card styling and positioning
- How auth token check is implemented on the public form (existing token refresh interceptor vs direct check)
- Clone button icon and placement within the detail page action bar
- How pre-filled form data is passed to /tickets/new (URL params, location state, or context)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Quick Create
- `src/pages/TicketForm.tsx` — Main ticket form (create + edit), refactored in Phase 11 with collapsible sections
- `src/pages/TicketList.tsx` — Ticket list page where FAB will be most visible
- `src/pages/Dashboard.tsx` — Dashboard page, another key FAB location

### Public Form
- `src/pages/PublicTicketForm.tsx` — Current public form with name/email/title/description/category/priority
- `src/lib/api.ts` — API client including `getPublicCategories`, `getPublicTemplates`
- `src/lib/tokenRefresh.ts` — Axios interceptor for token refresh (auth detection reference)
- `server/src/routes/auth.ts` — Auth endpoints, token validation

### Ticket Cloning
- `src/pages/TicketDetail.tsx` — Detail page where clone button will live
- `src/types/ticket.ts` — Ticket type definitions (which fields to clone)

### Requirements
- `.planning/REQUIREMENTS.md` — QCAP-01, QCAP-02, QCAP-03 definitions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TicketForm.tsx` — Already supports create mode with collapsible sections. Clone can pre-fill formData via location state.
- `PublicTicketForm.tsx` — Standalone public form at `/submit-ticket`. Has its own state management, fetches categories/templates independently.
- `tokenRefresh.ts` — Existing auth interceptor can be used to detect logged-in state on the public form.
- `CategoryCombobox` and `TemplateCombobox` — New Phase 11 components, available for reuse if needed.

### Established Patterns
- Form state via `useState` + `formData` object (not React Hook Form)
- Toast notifications via `sonner` for user feedback
- Navigation via `react-router-dom` `useNavigate`
- Location state for passing data between routes (e.g., `navigate('/tickets/new', { state: { cloneData } })`)

### Integration Points
- FAB component will be rendered at the layout level (likely in `App.tsx` or a layout wrapper) so it persists across pages
- Public form auth detection needs to check for existing auth token without triggering a redirect
- Clone button integrates into `TicketDetail.tsx` action bar
- `/tickets/new` route (TicketForm in create mode) needs to accept and apply pre-fill data from location state

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 12-quick-capture*
*Context gathered: 2026-03-30*
