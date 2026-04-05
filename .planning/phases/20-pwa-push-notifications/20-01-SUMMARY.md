---
phase: 20-pwa-push-notifications
plan: "01"
subsystem: push-notifications
tags: [push, service-worker, pwa, vapid, backend, nginx]
one_liner: "VAPID web push backend with 3 authenticated API routes, push_subscriptions DB table, custom service worker with push/notificationclick handlers, and injectManifest PWA strategy switch"

dependency_graph:
  requires: []
  provides:
    - push-subscription-api        # /api/push/subscribe, /api/push/unsubscribe, /api/push/vapid-public-key
    - push-send-utility            # sendPushToAllSubscriptions for use by Plan 02 scheduler
    - custom-service-worker        # src/sw.ts with push+notificationclick handlers
    - injectManifest-pwa           # vite-plugin-pwa switched from workbox to injectManifest
  affects:
    - server/src/index.ts          # new imports, initWebPush, pushRoutes, CSP update, scheduler change
    - server/src/db/connection.ts  # push_subscriptions migration
    - vite.config.ts               # PWA strategy switch
    - nginx.conf                   # sw.js no-cache headers

tech_stack:
  added:
    - "web-push (npm) - VAPID signing and push notification delivery"
    - "@types/web-push (devDep) - TypeScript types for web-push"
    - "workbox-precaching (devDep) - precacheAndRoute for injectManifest service worker"
  patterns:
    - "injectManifest strategy: vite-plugin-pwa injects __WB_MANIFEST into src/sw.ts at build time"
    - "VAPID graceful degradation: initWebPush returns false if keys not set, app runs without push"
    - "Expired subscription cleanup: 410/404 from push service triggers DELETE from push_subscriptions"

key_files:
  created:
    - server/src/lib/push.ts       # initWebPush, isPushEnabled, sendPushToAllSubscriptions
    - server/src/routes/push.ts    # GET /vapid-public-key, POST /subscribe, DELETE /unsubscribe
    - src/sw.ts                    # Custom service worker with push + notificationclick handlers
  modified:
    - server/src/db/connection.ts  # Added push_subscriptions to VALID_TABLE_NAMES + ensurePushSubscriptionsTable migration
    - server/src/index.ts          # Wired pushRoutes + initWebPush, updated CSP, decoupled scheduler from SMTP
    - server/package.json          # Added web-push + @types/web-push
    - vite.config.ts               # Switched to strategies: injectManifest, removed workbox + runtimeCaching
    - tsconfig.app.json            # Added "WebWorker" to lib array for ServiceWorkerGlobalScope types
    - nginx.conf                   # Added location = /sw.js block with no-cache headers
    - package.json                 # Added workbox-precaching devDependency

decisions:
  - "Used authenticate (not authenticateToken) as that is the actual middleware name exported from server/src/middleware/auth.ts"
  - "Reminder scheduler decoupled from SMTP guard per D-08 - now starts unconditionally so push reminders fire even without email"
  - "runtimeCaching intentionally removed during injectManifest switch - LAN-only app, offline API cache adds complexity without benefit (see 20-RESEARCH.md Assumption A1)"
  - "Pre-existing TypeScript errors in kb.ts (server) and KanbanView/TemplateEditorModal/TicketTagSelector (frontend) are out of scope - not introduced by this plan"

metrics:
  duration_minutes: 25
  completed_date: "2026-04-05"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 8
---

# Phase 20 Plan 01: Push Notification Foundation Summary

VAPID web push backend with 3 authenticated API routes, push_subscriptions DB table, custom service worker with push/notificationclick handlers, and injectManifest PWA strategy switch.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Backend push infrastructure | f22641b | Complete |
| 2 | Custom service worker + injectManifest + nginx | dafa296 | Complete |

## What Was Built

### Task 1: Backend Push Infrastructure

**Dependencies:** `web-push` added to `server/package.json` (runtime) and `@types/web-push` (devDep).

**DB Migration:** `push_subscriptions` table added to `server/src/db/connection.ts` via `ensurePushSubscriptionsTable()` called at end of `initializeDatabase()`. Schema: `id` (PK), `endpoint` (UNIQUE NOT NULL), `p256dh`, `auth`, `created_at`. Index on `endpoint`.

**Push Utility (`server/src/lib/push.ts`):**
- `initWebPush()` — reads VAPID env vars, calls `webpush.setVapidDetails`, returns bool (false = graceful disable)
- `isPushEnabled()` — returns current state
- `sendPushToAllSubscriptions(payload)` — fetches all subs from DB, sends push, auto-deletes on 410/404

**Routes (`server/src/routes/push.ts`):** 3 endpoints, all protected by `authenticate` middleware:
- `GET /api/push/vapid-public-key` — returns public key (or 503 if not configured)
- `POST /api/push/subscribe` — upserts subscription via `ON CONFLICT(endpoint) DO UPDATE`
- `DELETE /api/push/unsubscribe` — removes subscription by endpoint

**Server wiring (`server/src/index.ts`):**
- `initWebPush()` called after `initializeDatabase()` at startup
- `app.use('/api/push', pushRoutes)` mounted alongside other routes
- Helmet CSP `connectSrc` updated from `["'self'"]` to `["'self'", "https:"]` to allow push service endpoints
- Reminder scheduler decoupled from SMTP guard (now starts unconditionally per D-08)

### Task 2: Custom Service Worker + injectManifest Switch + nginx Cache Headers

**Service Worker (`src/sw.ts`):**
- `precacheAndRoute(self.__WB_MANIFEST)` — vite-plugin-pwa injects precache manifest at build time
- `push` event listener: calls `self.registration.showNotification()` with title, body, icon, and `data.url = /tickets/:id`
- `notificationclick` listener: closes notification, focuses existing window if URL matches, otherwise opens `self.clients.openWindow(url)`

**vite.config.ts:** Switched from `workbox:` strategy to `injectManifest:` strategy:
- Added `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`
- Replaced `workbox: { globPatterns, maximumFileSizeToCacheInBytes, runtimeCaching }` with `injectManifest: { globPatterns, maximumFileSizeToCacheInBytes }`
- `runtimeCaching` intentionally omitted (LAN-only app)

**tsconfig.app.json:** Added `"WebWorker"` to `lib` array to provide `ServiceWorkerGlobalScope`, `PushEvent`, `NotificationEvent` types.

**nginx.conf:** Added exact-match `location = /sw.js` block with `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` and `expires off`. Block is placed BEFORE the `~*` regex block so it takes priority.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Correct middleware name used**
- **Found during:** Task 1
- **Issue:** Plan specified `authenticateToken` as the middleware import, but the actual exported name from `server/src/middleware/auth.ts` is `authenticate`
- **Fix:** Used `authenticate` in `server/src/routes/push.ts` to match existing codebase pattern (same as `backup.ts`)
- **Files modified:** `server/src/routes/push.ts`
- **Commit:** f22641b

### Out-of-Scope Pre-existing Issues

The following TypeScript errors existed before this plan and are NOT introduced by our changes. They are deferred per deviation scope rules:

**server/ (`npx tsc --noEmit`):**
- `server/src/routes/kb.ts` (lines 232-233): `Type 'string | string[]' is not assignable to type 'string'`

**frontend (`npx tsc -p tsconfig.app.json --noEmit`):**
- `src/components/KanbanView.tsx` (line 37): `distance` property not in `AbstractPointerSensorOptions`
- `src/components/TemplateEditorModal.tsx` (multiple): Type errors
- `src/components/TicketTagSelector.tsx` (multiple): API client method name errors
- `src/components/ui/rich-text-editor.tsx` (line 179): NodeView component type mismatch

These are pre-existing and none are in files modified by this plan.

## Known Stubs

None. All implementation is complete and functional.

## Threat Flags

All threats from the plan's threat model have been mitigated:

| Threat | Mitigation Applied |
|--------|--------------------|
| T-20-01: Spoofing POST /api/push/subscribe | `authenticate` middleware on all 3 push routes |
| T-20-02: Tampering subscription body | Input validation (endpoint, keys.p256dh, keys.auth presence check) + UNIQUE constraint |
| T-20-03: VAPID_PRIVATE_KEY disclosure | Never returned by API; only VAPID_PUBLIC_KEY exposed via GET endpoint |
| T-20-05: notificationclick elevation | Handler only navigates to /tickets/:id from server payload — no arbitrary URL execution |

## Self-Check: PASSED

Files exist:
- [x] server/src/lib/push.ts — FOUND
- [x] server/src/routes/push.ts — FOUND
- [x] src/sw.ts — FOUND

Commits exist:
- [x] f22641b — FOUND (feat(20-01): backend push infrastructure)
- [x] dafa296 — FOUND (feat(20-01): custom service worker + injectManifest switch)
