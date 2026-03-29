---
status: partial
phase: 05-automation-recurring-tickets-dashboard-queues
source: [05-VERIFICATION.md]
started: 2026-03-29T04:10:00Z
updated: 2026-03-29T04:10:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Dashboard queue card live count
expected: Navigate to Dashboard, add a queue from a saved filter view. Queue card appears with a non-zero count matching the filter, updates on 30s stale timeout.
result: [pending]

### 2. Recurring scheduler fires and creates ticket
expected: Create a recurring template (daily), wait for the scheduler to fire (up to 1 minute), then check the template's history. A new ticket appears in the history list with a clickable link and the template's last_run updates.
result: [pending]

### 3. Recurring template pause/resume toggle
expected: Navigate to /recurring, create a template, pause it, then resume it. Status badge toggles between Aktiv/Pausad, next_run updates on resume.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
