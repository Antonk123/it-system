---
status: partial
phase: 20-pwa-push-notifications
source: [20-VERIFICATION.md]
started: 2026-04-05T20:00:00.000Z
updated: 2026-04-05T20:00:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Settings toggle subscribe/unsubscribe flow
expected: Toggle in Settings triggers browser permission prompt, subscribes to push, shows "Aktiverade" badge. Toggle off unsubscribes and shows "Avaktiverade".
result: [pending]

### 2. Reminder push notification
expected: When a reminder triggers, OS push notification appears. Clicking it navigates to the relevant ticket.
result: [pending]

### 3. Precache regression check
expected: injectManifest produces correct sw.js at build time. Offline caching still works for static assets.
result: [pending]

### 4. Aging ticket daily push
expected: At 09:00, tickets with no activity in 7+ days trigger push notifications with correct Swedish copy.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
