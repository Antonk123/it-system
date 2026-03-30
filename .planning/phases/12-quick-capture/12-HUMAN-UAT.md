---
status: partial
phase: 12-quick-capture
source: [12-VERIFICATION.md]
started: 2026-03-30T00:00:00Z
updated: 2026-03-30T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. FAB button visible at bottom-right on authenticated pages
expected: 56px primary-blue circular button appears fixed at bottom-right on ticket list, detail, and other auth pages
result: [pending]

### 2. Submitting FAB with a title creates a ticket and shows toast
expected: Toast appears with 'Ärende skapat' text and an 'Öppna' link that navigates to the new ticket
result: [pending]

### 3. Visiting /submit-ticket while logged in shows InloggedBadge and hides name/email fields
expected: Badge reads 'Inloggad som [username]'. Name/email/description/template/category/priority/file fields are hidden.
result: [pending]

### 4. Clicking 'Klona ärende' on a ticket with template fields carries all fields to the new-ticket form
expected: Title, description, category, priority pre-filled; DynamicFieldsForm renders with source values
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
