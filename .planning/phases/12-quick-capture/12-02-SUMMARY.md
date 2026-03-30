---
phase: 12-quick-capture
plan: "02"
subsystem: frontend
tags: [clone, ticket-form, ticket-detail, navigation-state]
dependency_graph:
  requires: []
  provides: [QCAP-03]
  affects: [src/pages/TicketDetail.tsx, src/pages/TicketForm.tsx]
tech_stack:
  added: []
  patterns: [location.state for inter-page data transfer, Template server-to-client mapping]
key_files:
  created: []
  modified:
    - src/pages/TicketDetail.tsx
    - src/pages/TicketForm.tsx
decisions:
  - "Used ticket.category (stores category_id) instead of non-existent ticket.categoryId — Ticket type maps category_id from TicketRow directly to .category field"
  - "Fixed DynamicFieldsForm initialValues condition to remove isEditing guard — enables pre-fill in create (clone) mode"
  - "Mapped snake_case customFieldValues (field_name/field_label/field_value) to camelCase CustomFieldInput for DynamicFieldsForm compatibility"
metrics:
  duration_seconds: 124
  completed_date: "2026-03-30"
  tasks_completed: 2
  files_modified: 2
---

# Phase 12 Plan 02: Ticket Clone Summary

Ticket cloning (QCAP-03) via a "Klona ärende" button on the detail page that navigates to the new ticket form with all relevant fields pre-populated from the source ticket.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add clone button to TicketDetail action bar | 9073865 | src/pages/TicketDetail.tsx |
| 2 | Add clone data pre-fill to TicketForm | fc547a3 | src/pages/TicketForm.tsx |

## What Was Built

**TicketDetail.tsx:** Added `handleClone` function that collects `title`, `description`, `category` (ID), `priority`, `templateId`, and `customFieldValues` from the current ticket and navigates to `/tickets/new` with this data in `location.state.cloneData`. Shows a toast confirming pre-fill. A "Klona ärende" button using the `Copy` icon is inserted between Redigera and Ta bort in the action bar.

**TicketForm.tsx:** Added a `useEffect` (runs once on mount, create mode only) that reads `location.state?.cloneData`. Sets `formData` with the cloned title, description, priority, and category. If the source ticket had a template, fetches it via `api.getTemplate()`, maps the server snake_case response to the `Template` interface (camelCase), sets `selectedTemplate` to render `DynamicFieldsForm`, and pre-fills field values by mapping snake_case `customFieldValues` to `CustomFieldInput[]` and calling `setEditInitialFieldValues`. Also fixed `DynamicFieldsForm` `initialValues` condition to work in create mode (removed `isEditing` guard).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ticket.categoryId does not exist on Ticket type**
- **Found during:** Task 1
- **Issue:** The plan spec said `category: ticket.categoryId || 'none'` but `Ticket` has no `categoryId` field. The `useTickets` hook maps `TicketRow.category_id` directly to `Ticket.category`.
- **Fix:** Changed to `ticket.category || 'none'` — correct field, same value (category ID).
- **Files modified:** src/pages/TicketDetail.tsx
- **Commit:** 9073865

**2. [Rule 1 - Bug] DynamicFieldsForm initialValues condition excluded clone mode**
- **Found during:** Task 2
- **Issue:** The render condition `isEditing && editInitialFieldValues.length > 0` prevented pre-filled field values from being passed to DynamicFieldsForm in create (clone) mode.
- **Fix:** Removed `isEditing &&` guard — condition is now `editInitialFieldValues.length > 0`.
- **Files modified:** src/pages/TicketForm.tsx
- **Commit:** fc547a3

**3. [Rule 1 - Bug] customFieldValues format mismatch**
- **Found during:** Task 2
- **Issue:** `ticketFieldValues` in TicketDetail uses `{field_name, field_label, field_value}` (snake_case from API), but `CustomFieldInput` expects `{fieldName, fieldLabel, fieldValue}` (camelCase). Plan said to set `setEditInitialFieldValues(cloneData.customFieldValues)` directly without mapping.
- **Fix:** Added explicit mapping to convert snake_case to camelCase before calling `setEditInitialFieldValues`.
- **Files modified:** src/pages/TicketForm.tsx
- **Commit:** fc547a3

**4. [Rule 1 - Bug] Template type has `type` field not in plan's mapping code**
- **Found during:** Task 2
- **Issue:** The `Template` interface (src/types/ticket.ts) has a required `type: TemplateType` field, but the plan's mapping code didn't include it — would cause TypeScript error.
- **Fix:** Added `type: freshTemplate.template_type || 'dynamic'` to the mapping.
- **Files modified:** src/pages/TicketForm.tsx
- **Commit:** fc547a3

## Known Stubs

None — all data is wired from actual ticket state.

## Self-Check: PASSED
