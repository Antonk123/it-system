---
phase: 12-quick-capture
plan: "01"
subsystem: frontend
tags: [quick-capture, fab, auth-detection, public-form]
dependency_graph:
  requires: []
  provides: [QuickCaptureFAB, PublicTicketForm-auth-detection]
  affects: [src/App.tsx, src/pages/PublicTicketForm.tsx]
tech_stack:
  added: []
  patterns:
    - FAB + Popover quick-create with useAuth self-guard
    - Dual submit path in public form (authenticated vs public endpoint)
    - Email-derived displayName (split on @, take first part)
key_files:
  created:
    - src/components/QuickCaptureFAB.tsx
  modified:
    - src/App.tsx
    - src/pages/PublicTicketForm.tsx
decisions:
  - QuickCaptureFAB sends description=' ' (single space) to satisfy server validation constraint (non-empty description required when no customFields)
  - Public form hides name/email/description/template/category/priority/file upload when logged in — title-only quick-create matching FAB behavior
  - Logged-in public form submit uses api.createTicket not api.submitPublicTicket — public endpoint requires name/email and does contact lookup
metrics:
  duration: "2m 12s"
  completed_date: "2026-03-30"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 12 Plan 01: Quick Capture Implementation Summary

QuickCaptureFAB with title-only ticket creation from any authenticated page, plus auth-aware public form with conditional fields and dual submit path.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create QuickCaptureFAB component and mount in App.tsx | 06c0d71 | src/components/QuickCaptureFAB.tsx, src/App.tsx |
| 2 | Add auth detection to PublicTicketForm with conditional fields and dual submit | 6035ec7 | src/pages/PublicTicketForm.tsx |

## What Was Built

**Task 1 — QuickCaptureFAB:**
- Fixed bottom-right FAB button (56px, primary blue, rounded-full, z-50)
- Opens Popover on click with auto-focused title input
- Enter key submits; button disabled when title empty or submitting
- On submit: calls `api.createTicket` with `description: ' '`, `priority: 'medium'`, `category_id: null`, `requester_id: user.id`
- On success: invalidates `ticketKeys.lists()` cache, closes popover, shows `toast.success('Ärende skapat')` with "Öppna" action link to new ticket
- Self-guards via `useAuth()` — returns null if unauthenticated, so safe to mount globally
- Mounted as sibling of `<AppRoutes />` inside `<AuthProvider>` in App.tsx

**Task 2 — PublicTicketForm auth detection:**
- Imports `useAuth`, derives `isLoggedIn = !!user`
- Shows InloggedBadge above title when logged in: `Inloggad som {email.split('@')[0]}`
- Hides name/email/description/template/dynamic-fields/category/priority/file-upload when logged in
- `handleSubmit` branches: logged-in path calls `api.createTicket` with same auto-defaults as FAB; non-logged-in path unchanged with `api.submitPublicTicket`
- Title-only validation when logged in (skips name/email/description validation)

## Decisions Made

1. **description: ' ' (single space)** — Server validation at `/tickets` route requires non-empty description when no customFields. Empty string `''` is falsy so fails. Single space passes the check.

2. **Logged-in public form hides all extra fields** — D-06 spec: title-only with same auto-defaults as FAB. This keeps the UX consistent with quick-capture philosophy and avoids confusing logged-in users with public-facing fields.

3. **Public form uses `api.createTicket` for logged-in path** — `api.submitPublicTicket` requires name/email and performs contact lookup on the backend. For authenticated users, direct `api.createTicket` is the correct endpoint.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all features fully wired with live API calls.

## Self-Check: PASSED

- [x] `src/components/QuickCaptureFAB.tsx` exists — FOUND
- [x] `src/App.tsx` contains `QuickCaptureFAB` — FOUND
- [x] `src/pages/PublicTicketForm.tsx` contains `useAuth` and `isLoggedIn` — FOUND
- [x] Commits 06c0d71 and 6035ec7 exist in git log
- [x] TypeScript compiles without errors (npx tsc --noEmit passed)
