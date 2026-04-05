---
phase: 20-pwa-push-notifications
plan: "02"
subsystem: push-notifications
tags: [push, settings, scheduler, cron, pwa, react, typescript]

dependency_graph:
  requires:
    - phase: 20-01
      provides: sendPushToAllSubscriptions, isPushEnabled, /api/push/* routes, custom service worker
  provides:
    - reminder-scheduler-push-integration   # sendPushToAllSubscriptions called for every due reminder
    - aging-ticket-push-scheduler           # daily 09:00 cron for tickets inactive > PUSH_AGING_DAYS
    - settings-notifikationer-section       # Notifikationer collapsible in Settings.tsx
    - push-subscribe-ui-flow                # full subscribe/unsubscribe via browser PushManager + backend
  affects:
    - server/src/lib/reminderScheduler.ts   # SMTP now conditional, push added
    - server/src/lib/pushScheduler.ts       # new aging-ticket daily scheduler
    - server/src/index.ts                   # startPushScheduler wired inside pushReady guard
    - src/pages/Settings.tsx                # Notifikationer section with toggle
    - src/lib/api.ts                        # getPushVapidKey, subscribePush, unsubscribePush

tech-stack:
  added: []
  patterns:
    - "SMTP conditional guard: if (process.env.SMTP_HOST && process.env.EMAIL_FROM) wraps email send"
    - "Push-only path: sendPushToAllSubscriptions is no-op when VAPID not configured - safe to call unconditionally"
    - "isPushEnabled guard in aging scheduler prevents DB queries when VAPID not configured"
    - "VAPID base64->Uint8Array: padding + replace + atob + Uint8Array.from conversion for applicationServerKey"
    - "Permission-on-action: Notification.requestPermission() only called inside checked=true branch"
    - "iOS non-standalone detection: navigator.userAgent /iPhone|iPad/ + matchMedia(display-mode: standalone)"

key-files:
  created:
    - server/src/lib/pushScheduler.ts   # Daily aging-ticket push check, startPushScheduler export
  modified:
    - server/src/lib/reminderScheduler.ts  # SMTP conditional + push call added
    - server/src/index.ts                  # startPushScheduler import + conditional start
    - src/lib/api.ts                       # getPushVapidKey, subscribePush, unsubscribePush methods
    - src/pages/Settings.tsx               # Notifikationer section, push state, useEffect, handlePushToggle

key-decisions:
  - "Email send wrapped in SMTP_HOST + EMAIL_FROM guard per D-08 - push fires regardless of email config"
  - "startPushScheduler called only inside pushReady guard - aging scheduler doesn't start if VAPID not configured"
  - "PushSubscriptionJSON used as TypeScript type for subscribePush parameter - matches browser subscription.toJSON() return type"
  - "Notifikationer section placed after Backup section - logical grouping at end of Settings page"

patterns-established:
  - "Push state detection pattern: check Notification.permission on mount, check pushManager.getSubscription() for active sub"
  - "Scheduler guard pattern: isPushEnabled() checked before DB query in aging scheduler"

requirements-completed: [PUSH-01, PUSH-02, PUSH-03]

duration: 15min
completed: "2026-04-05"
---

# Phase 20 Plan 02: Push Notification Integration Summary

**Scheduler integration (reminder + aging-ticket push) and Settings UI Notifikationer section with full subscribe/unsubscribe flow - completes end-to-end push notifications**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-05T21:20:00Z
- **Completed:** 2026-04-05T21:35:00Z
- **Tasks:** 2 (+ 1 auto-approved checkpoint)
- **Files modified:** 5

## Accomplishments

- Reminder scheduler now sends push notification alongside conditional email for every due reminder
- New `pushScheduler.ts` runs daily at 09:00 checking for tickets inactive more than `PUSH_AGING_DAYS` (default 7) days
- Settings page gains "Notifikationer" collapsible section with toggle, status display (Aktiverade/Blockerade/Avaktiverade), iOS non-standalone callout, and loading state

## Task Commits

1. **Task 1: Scheduler integration** - `1c868ec` (feat)
2. **Task 2: Settings UI** - `ba625a4` (feat)
3. **Task 3: Human verify checkpoint** - auto-approved (⚡ auto-approved, `_auto_chain_active: true`)

## Files Created/Modified

- `server/src/lib/pushScheduler.ts` - New daily cron at 09:00 for aging-ticket push notifications with PUSH_AGING_DAYS configurable threshold
- `server/src/lib/reminderScheduler.ts` - Email sending wrapped in SMTP_HOST/EMAIL_FROM guard; sendPushToAllSubscriptions call added
- `server/src/index.ts` - startPushScheduler import and conditional start inside pushReady guard
- `src/lib/api.ts` - getPushVapidKey, subscribePush, unsubscribePush methods added to ApiClient
- `src/pages/Settings.tsx` - Notifikationer section with Bell icon, full toggle flow, permission state display, iOS detection

## Decisions Made

- Email send wrapped in `SMTP_HOST && EMAIL_FROM` guard per D-08 — push fires regardless of email config so reminders always reach the user if push is subscribed
- `startPushScheduler` only called inside `pushReady` guard — aging scheduler doesn't unnecessarily start or query DB when VAPID not configured
- `PushSubscriptionJSON` used as TypeScript type for `subscribePush` parameter — matches `subscription.toJSON()` browser return type exactly
- Notifikationer section placed after Backup section — logical flow in Settings from functional settings to notification/export utilities

## Deviations from Plan

None - plan executed exactly as written. All Swedish copy uses proper UTF-8 characters (å, ä, ö) as specified.

## Issues Encountered

- TypeScript check via `tsc --noEmit` could only be run via the original project's node_modules (not the worktree), because the worktree has no node_modules. All module-not-found errors were pre-existing (no node_modules in worktree context). Frontend tsc exited with no output = clean.

## Known Stubs

None. All functionality is implemented end-to-end:
- Scheduler integration is live code (no mocks)
- Settings toggle wires to real browser PushManager and real backend API
- Push state detection on mount reads actual Notification.permission and pushManager.getSubscription()

## Threat Flags

No new threat surface introduced beyond the plan's threat model. All T-20-06 through T-20-09 mitigations are implemented:
- T-20-06: handlePushToggle only fires on explicit Switch onCheckedChange — permission prompt never on page load
- T-20-07: Push payloads constructed server-side from DB data
- T-20-08: Console logging in pushScheduler tracks which tickets triggered aging notifications
- T-20-09: isPushEnabled() guard prevents unnecessary DB queries; single cron per day

## Next Phase Readiness

- Full push notification system is complete (Plan 01 + Plan 02)
- VAPID keys must be generated and added to server .env before production deployment
- Phase 20 complete — all 3 push requirements (PUSH-01, PUSH-02, PUSH-03) delivered

## Self-Check: PASSED

Files exist:
- [x] server/src/lib/pushScheduler.ts — FOUND
- [x] server/src/lib/reminderScheduler.ts — FOUND
- [x] src/pages/Settings.tsx — FOUND
- [x] src/lib/api.ts — FOUND
- [x] .planning/phases/20-pwa-push-notifications/20-02-SUMMARY.md — FOUND

Commits exist:
- [x] 1c868ec — FOUND (feat(20-02): scheduler integration)
- [x] ba625a4 — FOUND (feat(20-02): Settings UI)

---
*Phase: 20-pwa-push-notifications*
*Completed: 2026-04-05*
