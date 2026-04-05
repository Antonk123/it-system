# Phase 20: PWA Push Notifications - Context

**Gathered:** 2026-04-05 (assumptions mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Users receive OS-level push notifications for reminders and aging tickets. Enable/disable from Settings page. Click notification to navigate to the relevant ticket. No Firebase/FCM — VAPID standard only. No push scheduling UI.

</domain>

<decisions>
## Implementation Decisions

### Service Worker Strategy
- **D-01:** Switch from `generateSW` to `injectManifest` in vite-plugin-pwa. Custom `src/sw.ts` imports `precacheAndRoute(self.__WB_MANIFEST)` and adds `push` + `notificationclick` event handlers.
- **D-02:** Install `workbox-precaching` as dev dependency. Add `WebWorker` to tsconfig `lib` array for service worker types.
- **D-03:** Config shape: `strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts'` in `vite.config.ts`.

### Backend Push Infrastructure
- **D-04:** Install `web-push` + `@types/web-push` on the server. CJS library, works with ESM via `esModuleInterop`.
- **D-05:** New `push_subscriptions` table: `id`, `endpoint` (unique), `p256dh`, `auth`, `created_at`. Single-user system so typically 1-2 subscriptions (one per device/browser).
- **D-06:** New routes: `POST /api/push/subscribe`, `DELETE /api/push/unsubscribe`, `GET /api/push/vapid-public-key`.
- **D-07:** VAPID keys generated via `npx web-push generate-vapid-keys --json`, stored in `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Startup guard logs warning if keys missing (push disabled, not crash).

### Scheduler Integration
- **D-08:** Reminder push (PUSH-02): Add push notification sending inside existing `reminderScheduler.ts` alongside email. Decouple scheduler startup from SMTP guard — scheduler always starts, conditionally sends email and/or push based on available config.
- **D-09:** Aging ticket push (PUSH-03): Add a daily check (new function or separate interval) that queries tickets with `status != 'closed'` and `updated_at` older than N days. N configurable via env var (default: 7 days). Push one notification per aging ticket.
- **D-10:** Push payload includes `{ type, ticketId, title, body }` — the `notificationclick` handler in the SW reads `ticketId` and navigates to `/tickets/:id` (PUSH-04).

### Settings UI
- **D-11:** New "Notifikationer" section in Settings page with a toggle switch. On enable: request browser `Notification.permission`, then call `PushManager.subscribe()` with VAPID public key, then POST subscription to backend. On disable: call `PushManager.getSubscription().unsubscribe()` and DELETE from backend.
- **D-12:** Permission prompt only on explicit user action (toggle click) — never on page load (per prior research flag).
- **D-13:** Show current permission state: "Aktiverade" / "Blockerade i webbläsaren" / "Avaktiverade". If browser has blocked, show instruction to unblock in browser settings.

### CSP & Nginx
- **D-14:** Update Helmet CSP `connectSrc` to include push service endpoints (wildcard or `https://*.push.services.mozilla.com`, `https://fcm.googleapis.com` etc. — or `'self' https:`).
- **D-15:** Add nginx location block for `/sw.js` with `no-store, no-cache` headers. Exclude from the immutable 1-year JS cache rule.

### Claude's Discretion
- Exact notification icon and badge
- Notification body text formatting for reminders vs aging tickets
- Whether aging check runs on its own interval or piggybacks on existing scheduler
- Toast feedback copy when enabling/disabling push

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### PWA Configuration
- `vite.config.ts` — Current generateSW PWA config (lines 22-69), must be converted to injectManifest
- `nginx.conf` — JS caching rules (lines 38-41), needs SW exception

### Schedulers
- `server/src/lib/reminderScheduler.ts` — Reminder cron loop, email sending, SMTP guard dependency
- `server/src/lib/autoCloseScheduler.ts` — Aging ticket query pattern (`updated_at` comparison)

### Backend Infrastructure
- `server/src/db/schema.sql` — Database schema, needs new `push_subscriptions` table
- `server/src/db/connection.ts` — DB connection setup, migration pattern
- `server/src/index.ts` — Route mounting, scheduler startup, Helmet CSP config

### Frontend
- `src/pages/Settings.tsx` — Settings page where notification toggle section will be added
- `server/src/middleware/auth.ts` — `authenticateToken` middleware for protecting push routes

### Requirements
- `.planning/REQUIREMENTS.md` §Push-notiser — PUSH-01 through PUSH-04 acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/src/lib/reminderScheduler.ts` — Cron loop pattern, reminder query logic, email sending (extend with push)
- `server/src/lib/autoCloseScheduler.ts` — Aging ticket query by `updated_at` (reuse for PUSH-03)
- `server/src/middleware/auth.ts` — `authenticateToken` for protecting push subscription routes
- `src/pages/Settings.tsx` — Settings page layout, section patterns (backup section from Phase 19 as template)
- `server/src/db/initializeDatabase.ts` — Migration pattern with `tableExists` guard for new tables

### Established Patterns
- Express routes in `server/src/routes/` follow domain-based grouping (e.g., `push.ts`)
- Database migrations added to `initializeDatabase()` chain with idempotent `tableExists` guard
- Frontend uses React Query hooks + api client from `src/lib/api.ts`
- Toast notifications via shadcn/ui toast system for feedback
- Settings page uses card-based sections

### Integration Points
- New route file: `server/src/routes/push.ts` — subscribe/unsubscribe/vapid-key endpoints
- Mount in `server/src/index.ts` alongside existing routes
- New scheduler function in `reminderScheduler.ts` or separate `pushScheduler.ts`
- Custom service worker: `src/sw.ts` — compiled by vite-plugin-pwa
- Settings page: new "Notifikationer" section component

</code_context>

<specifics>
## Specific Ideas

- Permission prompt triggered only by explicit user toggle in Settings — never on page load (research flag from prior sessions)
- VAPID keys must exist in `.env` before any push code runs — startup guard pattern
- Test injectManifest switch in Docker/nginx production build to verify offline cache doesn't regress (research flag)
- Single-user system — no need for per-user subscription filtering, just push to all stored subscriptions

</specifics>

<deferred>
## Deferred Ideas

None — analysis stayed within phase scope

</deferred>

---

*Phase: 20-pwa-push-notifications*
*Context gathered: 2026-04-05*
