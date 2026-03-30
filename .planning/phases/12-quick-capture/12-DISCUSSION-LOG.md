# Phase 12: Quick Capture - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 12-quick-capture
**Areas discussed:** Title-only creation flow, Public form auth detection, Ticket cloning

---

## Title-Only Creation Flow

### Entry point

| Option | Description | Selected |
|--------|-------------|----------|
| Floating "+" button | Persistent FAB in bottom-right corner — always one tap away | ✓ |
| Top bar action | A "Snabbskapa" button in the header/nav bar | |
| Inline on ticket list | Input field at top of ticket list | |

**User's choice:** Floating "+" button
**Notes:** None

### After submit

| Option | Description | Selected |
|--------|-------------|----------|
| Stay on current page + toast | Show success toast with link to new ticket | ✓ |
| Navigate to the new ticket | Redirect to new ticket detail page | |
| Stay + undo option | Toast with "Angra" undo button | |

**User's choice:** Stay on current page + toast
**Notes:** None

### Input style

| Option | Description | Selected |
|--------|-------------|----------|
| Small popover/card | FAB expands into small floating card with title input + submit | ✓ |
| Bottom sheet / drawer | Slides up from bottom | |
| Full-page with pre-collapsed fields | Navigate to /tickets/new with everything collapsed | |

**User's choice:** Small popover/card
**Notes:** None

### Defaults

| Option | Description | Selected |
|--------|-------------|----------|
| Medium priority, no category, current user | Simplest defaults | ✓ |
| Medium priority, "Allmant" category, current user | Assigns default category | |
| User-configurable defaults in Settings | Add settings section | |

**User's choice:** Medium priority, no category, current user as requester
**Notes:** None

---

## Public Form Auth Detection

### Auth UX

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-detect + hide name/email | Check auth token, hide fields, show "Inloggad som" badge | ✓ |
| Show toggle | "Jag ar redan inloggad" toggle | |
| Redirect to /tickets/new | Public form only for anonymous | |

**User's choice:** Auto-detect + hide name/email
**Notes:** None

### Quick mode for logged-in

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — title-only with same defaults | Ultra-fast: just title + submit | ✓ |
| No — keep full form minus name/email | All fields but skip identity | |

**User's choice:** Yes — title-only with same defaults
**Notes:** None

---

## Ticket Cloning

### Clone entry point

| Option | Description | Selected |
|--------|-------------|----------|
| Ticket detail page action bar | "Klona" button alongside Edit/Delete/Share | ✓ |
| Both detail page and list context menu | Detail + right-click in list | |
| List page only | Clone icon in ticket list row | |

**User's choice:** Ticket detail page action bar
**Notes:** None

### Clone fields

| Option | Description | Selected |
|--------|-------------|----------|
| Title, description, category, priority, template fields | Core content. Status resets, no attachments. | ✓ |
| Everything except status and dates | Copy all including attachments/checklist | |
| Title and description only | Minimal clone | |

**User's choice:** Title, description, category, priority, template fields
**Notes:** None

### Clone flow

| Option | Description | Selected |
|--------|-------------|----------|
| Open /tickets/new pre-filled | Navigate to create form with pre-populated fields | ✓ |
| Create immediately + navigate to new | Instant clone, open new ticket | |
| Create immediately + stay on original | Instant clone, toast with link | |

**User's choice:** Open /tickets/new pre-filled
**Notes:** None

---

## Claude's Discretion

- FAB visual design (icon, size, color, animation)
- Popover card styling and positioning
- Auth token detection approach on public form
- Clone button icon and placement in action bar
- How pre-fill data is passed to /tickets/new (location state vs URL params)

## Deferred Ideas

None — discussion stayed within phase scope.
