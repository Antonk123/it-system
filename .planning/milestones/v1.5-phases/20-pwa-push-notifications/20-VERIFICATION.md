---
phase: 20-pwa-push-notifications
verified: 2026-04-05T22:00:00Z
status: human_needed
score: 11/11 must-haves verified
human_verification:
  - test: "Enable push notifications via Settings toggle"
    expected: "Browser shows OS permission prompt on first toggle click. After granting, toggle shows 'Aktiverade' and a success toast appears."
    why_human: "Requires live browser + service worker registration + OS permission UI — not testable via file inspection."
  - test: "Create a reminder on a ticket due in 1-2 minutes, wait for it to trigger"
    expected: "OS-level push notification appears with ticket title in the notification body. Clicking the notification navigates to /tickets/:id."
    why_human: "End-to-end flow requires running server with VAPID keys configured, registered browser subscription, and waiting for cron to fire."
  - test: "Verify precache still works (offline regression check)"
    expected: "DevTools > Application > Cache Storage shows app assets in precache list. App loads when network is disabled."
    why_human: "Requires browser + running the Vite build with injectManifest strategy to confirm __WB_MANIFEST injection succeeded."
  - test: "Verify aging-ticket push fires at 09:00 for inactive tickets"
    expected: "Server logs show 'Push aging check' at 09:00. OS notification appears for any ticket with updated_at older than PUSH_AGING_DAYS (default 7 days)."
    why_human: "Requires waiting until 09:00 server time with VAPID configured and a qualifying ticket in DB."
---

# Phase 20: PWA Push Notifications Verification Report

**Phase Goal:** Users receive OS-level push notifications for reminders and aging tickets
**Verified:** 2026-04-05T22:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Backend can store and remove push subscriptions in the database | VERIFIED | `push_subscriptions` table in VALID_TABLE_NAMES (connection.ts:41), `ensurePushSubscriptionsTable()` called in `initializeDatabase()` (connection.ts:588), CRUD in routes/push.ts |
| 2 | Backend can send push notifications to all stored subscriptions | VERIFIED | `sendPushToAllSubscriptions()` in push.ts:30 — queries all subs, calls `webpush.sendNotification`, auto-deletes on 410/404 |
| 3 | Service worker intercepts push events and shows OS notifications | VERIFIED | `self.addEventListener('push', ...)` in sw.ts:12 calls `self.registration.showNotification()` with title, body, icon |
| 4 | Clicking a notification navigates to the correct ticket URL | VERIFIED | `notificationclick` handler in sw.ts:30 calls `self.clients.openWindow(url)` where url = `/tickets/${data.ticketId}` |
| 5 | Precache still works after injectManifest switch (no offline regression) | VERIFIED (code) | `precacheAndRoute(self.__WB_MANIFEST)` in sw.ts:6; vite.config.ts uses `strategies: 'injectManifest'` with `injectManifest.globPatterns` — requires human confirmation of built output |
| 6 | sw.js is served with no-cache headers by nginx | VERIFIED | nginx.conf:39-43 has exact-match `location = /sw.js` block before the `~*` regex, with `Cache-Control: no-store, no-cache, must-revalidate...` |
| 7 | User can toggle push notifications on/off from Settings page | VERIFIED | Settings.tsx has `Notifikationer` collapsible section with `Switch` wired to `handlePushToggle`, shows Aktiverade/Blockerade/Avaktiverade state |
| 8 | Permission prompt only fires on explicit toggle click, never on page load | VERIFIED | `useEffect` reads `Notification.permission` only (no requestPermission); `requestPermission()` called only inside `checked=true` branch of `handlePushToggle` |
| 9 | Reminder scheduler sends push notification alongside email when reminder triggers | VERIFIED | reminderScheduler.ts:91 calls `sendPushToAllSubscriptions()` after conditional SMTP block; email wrapped in `if (process.env.SMTP_HOST && process.env.EMAIL_FROM)` at line 74 |
| 10 | Aging tickets with no activity in N days trigger a daily push notification | VERIFIED | pushScheduler.ts: `cron.schedule('0 9 * * *', ...)` queries tickets with `updated_at <= cutoff` and `status NOT IN ('closed', 'resolved')`, calls `sendPushToAllSubscriptions` per ticket |
| 11 | Settings toggle shows loading state during subscribe/unsubscribe flow | VERIFIED | Settings.tsx:244 `pushLoading` state, Switch `disabled={pushLoading || ...}` at line 1286, Loader2 spinner at line 1281 |

**Score:** 11/11 truths verified (code-level)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/src/lib/push.ts` | VAPID init + send push utility | VERIFIED | Exports `initWebPush`, `isPushEnabled`, `sendPushToAllSubscriptions` |
| `server/src/routes/push.ts` | Push subscription CRUD endpoints | VERIFIED | 3 routes (GET vapid-public-key, POST subscribe, DELETE unsubscribe), all protected by `authenticate` |
| `server/src/lib/pushScheduler.ts` | Daily aging-ticket push check at 09:00 | VERIFIED | Exports `startPushScheduler`, cron `0 9 * * *`, `isPushEnabled()` guard |
| `src/sw.ts` | Custom service worker with push + notificationclick handlers | VERIFIED | Contains `precacheAndRoute`, `push` event, `notificationclick` event |
| `src/pages/Settings.tsx` | Notifikationer collapsible section with toggle | VERIFIED | Bell icon, sectionsOpen.notifications, full subscribe/unsubscribe flow |
| `src/lib/api.ts` | Push API client methods | VERIFIED | `getPushVapidKey`, `subscribePush`, `unsubscribePush` at lines 1003-1013 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `server/src/index.ts` | `server/src/routes/push.ts` | `app.use('/api/push', pushRoutes)` | WIRED | index.ts:199 |
| `server/src/index.ts` | `server/src/lib/push.ts` | `initWebPush()` call at startup | WIRED | index.ts:50, import at line 11 |
| `src/sw.ts` | `/tickets/:id` | `clients.openWindow(url)` | WIRED | sw.ts:41, url set as `/tickets/${data.ticketId}` |
| `server/src/lib/reminderScheduler.ts` | `server/src/lib/push.ts` | `sendPushToAllSubscriptions` call | WIRED | reminderScheduler.ts:4 (import), line 91 (call) |
| `server/src/lib/pushScheduler.ts` | `server/src/lib/push.ts` | `sendPushToAllSubscriptions` call | WIRED | pushScheduler.ts:3 (import), line 33 (call) |
| `src/pages/Settings.tsx` | `/api/push/subscribe` | `api.subscribePush()` in handlePushToggle | WIRED | Settings.tsx:341 |
| `src/pages/Settings.tsx` | `/api/push/unsubscribe` | `api.unsubscribePush()` in handlePushToggle | WIRED | Settings.tsx:351 |
| `server/src/index.ts` | `server/src/lib/pushScheduler.ts` | `startPushScheduler()` inside pushReady guard | WIRED | index.ts:53, import at line 12 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/sw.ts` | `event.data` (push payload) | `webpush.sendNotification()` in server/src/lib/push.ts — DB query for active subscriptions | Yes — DB-sourced subscriptions, server-constructed payload | FLOWING |
| `server/src/lib/pushScheduler.ts` | `tickets` | `db.prepare(...).all(cutoffIso)` — real DB query on tickets table | Yes — live DB query with date cutoff | FLOWING |
| `server/src/lib/reminderScheduler.ts` | `dueReminders` | `db.prepare(...).all(now)` — live query on ticket_reminders JOIN tickets JOIN users | Yes — real DB query | FLOWING |
| `src/pages/Settings.tsx` (push state) | `pushEnabled` | `reg.pushManager.getSubscription()` on mount | Yes — reads real browser PushManager state | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED for server-side schedulers (require running server with VAPID env vars). No compiled output available for spot-check. TypeScript source verification confirms logic is complete and wired.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| PUSH-01 | 20-02-PLAN.md | User can enable/disable push notifications from settings | SATISFIED | Settings.tsx Notifikationer section with Switch, full subscribe/unsubscribe flow wired to backend |
| PUSH-02 | 20-02-PLAN.md | User receives push notification when a reminder triggers | SATISFIED | reminderScheduler.ts calls `sendPushToAllSubscriptions` for every due reminder |
| PUSH-03 | 20-02-PLAN.md | User receives push notification when a ticket has had no activity in N days | SATISFIED | pushScheduler.ts: daily cron, DB query for inactive tickets, push per ticket |
| PUSH-04 | 20-01-PLAN.md | User can click a push notification to navigate to the relevant ticket | SATISFIED | sw.ts `notificationclick` handler calls `clients.openWindow(url)` with `/tickets/:id` |

All 4 requirements from REQUIREMENTS.md are claimed by plans and have implementation evidence. No orphaned requirements.

### Anti-Patterns Found

No anti-patterns detected in phase files. Scanned: push.ts, routes/push.ts, pushScheduler.ts, reminderScheduler.ts, sw.ts, Settings.tsx (push sections).

The SUMMARY noted pre-existing TypeScript errors in kb.ts (server) and KanbanView/TemplateEditorModal/TicketTagSelector (frontend). These are out-of-scope for this phase — not introduced by phase 20 changes.

### Human Verification Required

#### 1. Push Notification Subscribe Flow

**Test:** Open Settings page in a browser (Chrome/Edge/Firefox). Expand "Notifikationer" section. Toggle "Push-notiser" ON.
**Expected:** Browser shows OS permission prompt. After granting, toggle shows "Aktiverade" and toast displays "Push-notiser aktiverade". Toggle OFF shows "Avaktiverade".
**Why human:** Requires live browser + service worker + OS permission API — not testable via static code analysis.

#### 2. Reminder Push Notification End-to-End

**Test:** With VAPID keys configured in server .env, create a ticket reminder 1-2 minutes in the future. Wait for reminder scheduler to fire.
**Expected:** OS-level push notification appears with the ticket title. Clicking the notification opens the browser and navigates to `/tickets/:id`.
**Why human:** Requires live server, registered browser subscription, and time-based cron execution.

#### 3. Precache Regression Check (offline)

**Test:** Build the frontend (`npm run build`). Open DevTools > Application > Service Workers — confirm sw.js is registered. Check Cache Storage for precache entries (app JS/CSS/HTML assets). Disable network and reload — app should load from cache.
**Expected:** injectManifest strategy produces a compiled sw.js with __WB_MANIFEST replaced by real asset list. Precache contains app shell assets.
**Why human:** Requires running Vite build to confirm vite-plugin-pwa injects the manifest correctly into sw.ts at build time.

#### 4. Aging-Ticket Daily Push

**Test:** Configure a ticket with `updated_at` older than 7 days and status not 'closed'/'resolved'. Set server time to 09:00 or temporarily lower PUSH_AGING_DAYS to trigger soon. Confirm OS notification appears.
**Expected:** Push notification shows "Inaktivt ärende: [title]" with days-since body text. Server logs show "Push aging check: N ticket(s) inactive >N days".
**Why human:** Requires time manipulation or waiting, plus VAPID configuration and active browser subscription.

### Gaps Summary

No code-level gaps found. All 11 observable truths are verified through source code inspection. All 4 requirements have complete implementations wired end-to-end. No stubs, orphaned artifacts, or missing links detected.

The 4 human verification items are behavioral confirmations that require a running environment with VAPID keys. They verify that the correct code produces correct runtime behavior — the code itself is complete and properly wired.

---

_Verified: 2026-04-05T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
