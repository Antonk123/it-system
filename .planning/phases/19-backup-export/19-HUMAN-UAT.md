---
status: partial
phase: 19-backup-export
source: [19-VERIFICATION.md]
started: 2026-04-05T17:30:00.000Z
updated: 2026-04-05T17:30:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end download test
expected: Click "Ladda ned backup" in Settings and confirm the ZIP downloads with correct filename (it-ticket-backup-YYYY-MM-DD.zip) and a success toast with file size.
result: [pending]

### 2. ZIP content integrity
expected: Open the downloaded ZIP and confirm it contains data/database.sqlite (a valid SQLite file) and data/uploads/.
result: [pending]

### 3. Authentication gate
expected: Confirm an unauthenticated request to /api/backup returns 401.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
