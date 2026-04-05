# Phase 20: PWA Push Notifications - Research

**Researched:** 2026-04-05
**Domain:** Web Push API (VAPID), vite-plugin-pwa injectManifest, service worker TypeScript, Node.js web-push library
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Service Worker Strategy**
- D-01: Switch from `generateSW` to `injectManifest` in vite-plugin-pwa. Custom `src/sw.ts` imports `precacheAndRoute(self.__WB_MANIFEST)` and adds `push` + `notificationclick` event handlers.
- D-02: Install `workbox-precaching` as dev dependency. Add `WebWorker` to tsconfig `lib` array for service worker types.
- D-03: Config shape: `strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts'` in `vite.config.ts`.

**Backend Push Infrastructure**
- D-04: Install `web-push` + `@types/web-push` on the server. CJS library, works with ESM via `esModuleInterop`.
- D-05: New `push_subscriptions` table: `id`, `endpoint` (unique), `p256dh`, `auth`, `created_at`. Single-user system so typically 1-2 subscriptions (one per device/browser).
- D-06: New routes: `POST /api/push/subscribe`, `DELETE /api/push/unsubscribe`, `GET /api/push/vapid-public-key`.
- D-07: VAPID keys generated via `npx web-push generate-vapid-keys --json`, stored in `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Startup guard logs warning if keys missing (push disabled, not crash).

**Scheduler Integration**
- D-08: Reminder push (PUSH-02): Add push notification sending inside existing `reminderScheduler.ts` alongside email. Decouple scheduler startup from SMTP guard — scheduler always starts, conditionally sends email and/or push based on available config.
- D-09: Aging ticket push (PUSH-03): Add a daily check (new function or separate interval) that queries tickets with `status != 'closed'` and `updated_at` older than N days. N configurable via env var (default: 7 days). Push one notification per aging ticket.
- D-10: Push payload includes `{ type, ticketId, title, body }` — the `notificationclick` handler in the SW reads `ticketId` and navigates to `/tickets/:id` (PUSH-04).

**Settings UI**
- D-11: New "Notifikationer" section in Settings page with a toggle switch. On enable: request browser `Notification.permission`, then call `PushManager.subscribe()` with VAPID public key, then POST subscription to backend. On disable: call `PushManager.getSubscription().unsubscribe()` and DELETE from backend.
- D-12: Permission prompt only on explicit user action (toggle click) — never on page load.
- D-13: Show current permission state: "Aktiverade" / "Blockerade i webbläsaren" / "Avaktiverade". If browser has blocked, show instruction to unblock in browser settings.

**CSP and Nginx**
- D-14: Update Helmet CSP `connectSrc` to include push service endpoints (wildcard or specific push service domains — or `'self' https:`).
- D-15: Add nginx location block for `/sw.js` with `no-store, no-cache` headers. Exclude from the immutable 1-year JS cache rule.

### Claude's Discretion
- Exact notification icon and badge
- Notification body text formatting for reminders vs aging tickets
- Whether aging check runs on its own interval or piggybacks on existing scheduler
- Toast feedback copy when enabling/disabling push

### Deferred Ideas (OUT OF SCOPE)
None — analysis stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PUSH-01 | User can enable/disable push notifications from settings | D-11, D-12, D-13: Settings toggle section with permission state management |
| PUSH-02 | User receives push notification when a reminder triggers | D-08: extend reminderScheduler.ts to send push alongside email |
| PUSH-03 | User receives push notification when a ticket has had no activity in N days | D-09: new aging-ticket push check using updated_at query pattern from autoCloseScheduler.ts |
| PUSH-04 | User can click a push notification to navigate to the relevant ticket | D-10: notificationclick handler reads ticketId from payload, calls clients.openWindow() |
</phase_requirements>

---

## Summary

Phase 20 adds OS-level push notifications to the PWA using the Web Push API with VAPID authentication — no Firebase/FCM. The implementation has three coordinated layers: (1) converting the service worker from `generateSW` to `injectManifest` so custom `push` and `notificationclick` handlers can be added, (2) a Node.js backend using the `web-push` library to store subscriptions and send notifications from the reminder and aging-ticket schedulers, and (3) a Settings UI toggle that manages browser permission state and subscribes/unsubscribes the device.

The existing codebase provides strong foundations: `reminderScheduler.ts` already handles the cron loop and email delivery — push is additive. `autoCloseScheduler.ts` demonstrates the exact `updated_at <= cutoff` SQLite query pattern needed for the aging ticket check. The `initializeDatabase()` chain in `connection.ts` has a well-established `tableExists` guard pattern for adding `push_subscriptions`. The Settings page already uses card sections and the shadcn/ui Switch component (imported at line 44).

One critical sequence dependency: VAPID keys must be generated and stored in `.env` before any push code runs. The `injectManifest` switch must be tested in a Docker/nginx production build to verify the offline precache does not regress. These are the two highest-risk items in the phase.

**Primary recommendation:** Implement in wave order — (1) VAPID key generation + DB table + backend routes, (2) SW switch to injectManifest + push/notificationclick handlers, (3) Settings toggle UI, (4) scheduler integration with reminder push, (5) aging-ticket push. Test the SW switch in Docker before wiring up scheduler sends.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `web-push` | 3.6.7 | Send VAPID push notifications from Node.js server | De-facto Node.js VAPID library; handles RFC 8291 encryption |
| `@types/web-push` | bundled with web-push | TypeScript types | Required for typed usage in TypeScript server |
| `workbox-precaching` | 7.4.0 | Precache manifest injection in custom service worker | Required by injectManifest strategy to call `precacheAndRoute(self.__WB_MANIFEST)` |

[VERIFIED: npmjs.com search results — web-push 3.6.7 last published ~2 years ago; workbox-precaching 7.4.0 last published 3 months ago]

### Supporting (already in project)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vite-plugin-pwa` | 0.20.5 | PWA + SW compilation | Already installed — switch config to injectManifest |
| `workbox-window` | 7.0.0 | Register and update SW from app | Already installed — no change needed |
| `node-cron` | 3.0.3 (server) | Cron scheduling for aging ticket check | Already used in all schedulers |

[VERIFIED: project package.json]

### Installation Commands

```bash
# Server dependencies
cd server && npm install web-push && npm install --save-dev @types/web-push

# Client dev dependency (for sw.ts precaching types)
cd .. && npm install --save-dev workbox-precaching
```

---

## Architecture Patterns

### Additions-Only Project Structure

```
src/
└── sw.ts                             # New: custom service worker (replaces generateSW output)

server/src/
├── routes/
│   └── push.ts                       # New: subscribe, unsubscribe, vapid-public-key endpoints
├── lib/
│   ├── push.ts                       # New: initWebPush(), sendPushToAllSubscriptions()
│   ├── reminderScheduler.ts          # Modified: decouple SMTP guard, add push send
│   └── pushScheduler.ts              # New: aging-ticket daily push check (09:00 daily)
└── db/
    └── connection.ts                 # Modified: ensurePushSubscriptionsTable() + VALID_TABLE_NAMES
```

### Pattern 1: injectManifest Service Worker (src/sw.ts)

**What:** Custom service worker that precaches the app AND handles push events.
**When to use:** Required whenever push events need custom handling — generateSW cannot include custom listeners.

```typescript
// src/sw.ts
// Source: https://vite-pwa-org.netlify.app/guide/inject-manifest.html
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

// Required: placeholder replaced by vite-plugin-pwa with actual precache manifest at build time
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json() as {
    type: string; ticketId: string; title: string; body: string;
  };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      data: { ticketId: data.ticketId, url: `/tickets/${data.ticketId}` },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
```

[CITED: https://vite-pwa-org.netlify.app/guide/inject-manifest.html — structure and WebWorker typing requirement]

### Pattern 2: vite.config.ts — switch to injectManifest

**What:** Replace the `workbox:` key with `injectManifest:` and add `strategies: 'injectManifest'`.

The key change: `workbox:` becomes `injectManifest:` — these keys are mutually exclusive. Runtime caching config (the existing NetworkFirst for `/api`) moves into `sw.ts` if still desired, or can be omitted (the app requires LAN access).

```typescript
VitePWA({
  registerType: 'autoUpdate',
  strategies: 'injectManifest',    // NEW — was implicit generateSW
  srcDir: 'src',                   // NEW — where sw.ts lives
  filename: 'sw.ts',               // NEW — TypeScript source
  includeAssets: ['favicon.png', 'robots.txt', 'icons/*.png'],
  manifest: {
    // ... keep existing manifest block unchanged ...
  },
  injectManifest: {                // NEW — replaces workbox: {}
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  },
})
```

[CITED: https://vite-pwa-org.netlify.app/guide/inject-manifest.html]

### Pattern 3: tsconfig.app.json — add WebWorker lib

```json
{
  "compilerOptions": {
    "lib": ["ES2020", "DOM", "DOM.Iterable", "WebWorker"]
  }
}
```

`WebWorker` provides `ServiceWorkerGlobalScope`, `PushEvent`, `NotificationEvent`, `PushManager` types for `sw.ts`.

[CITED: https://vite-pwa-org.netlify.app/guide/inject-manifest.html]

### Pattern 4: VAPID key generation (one-time manual setup)

Run once on any machine with node, save output to `.env`:

```
VAPID_PUBLIC_KEY=BExxxxxxxx...
VAPID_PRIVATE_KEY=xxxxx...
VAPID_SUBJECT=mailto:anton@prefabmastarna.se
```

The command is: `npx web-push generate-vapid-keys --json`

Keys must exist in `.env` before Docker build. The startup guard in `server/src/index.ts` logs a warning and skips push init if keys are absent — push is disabled gracefully, not a crash.

[CITED: https://github.com/web-push-libs/web-push README]

### Pattern 5: Backend push utility (server/src/lib/push.ts)

```typescript
// server/src/lib/push.ts
import webpush from 'web-push';
import { db } from '../db/connection.js';

export function initWebPush(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@prefabmastarna.se';
  if (!publicKey || !privateKey) {
    console.warn('Push notifications disabled (VAPID keys not configured)');
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

interface PushPayload {
  type: string;
  ticketId: string;
  title: string;
  body: string;
}

export async function sendPushToAllSubscriptions(payload: PushPayload): Promise<void> {
  const subs = db.prepare('SELECT * FROM push_subscriptions').all() as
    { endpoint: string; p256dh: string; auth: string }[];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (err: any) {
      // 410 Gone or 404 = subscription expired, remove it
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
        console.log(`Removed expired push subscription: ${sub.endpoint}`);
      } else {
        console.error('Push send error:', err.message);
      }
    }
  }
}
```

Server `esModuleInterop: true` (confirmed in `server/tsconfig.json` line 6) means `import webpush from 'web-push'` works despite web-push being a CJS module.

[VERIFIED: server/tsconfig.json]

### Pattern 6: Frontend — PushManager.subscribe with urlBase64ToUint8Array

The VAPID public key arrives as a URL-safe base64 string. `PushManager.subscribe()` requires an ArrayBuffer (`Uint8Array`). The conversion helper is 5 lines and is the established industry standard:

```typescript
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

// Usage in Settings toggle handler:
const reg = await navigator.serviceWorker.ready;
const { vapidPublicKey } = await apiClient.get('/api/push/vapid-public-key');
const subscription = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
});
await apiClient.post('/api/push/subscribe', subscription.toJSON());
```

[CITED: MDN PushManager.subscribe() + web-push-libs/web-push issue #558]

### Pattern 7: DB migration — push_subscriptions table

```typescript
// Add to connection.ts — ensurePushSubscriptionsTable()
const ensurePushSubscriptionsTable = () => {
  if (tableExists('push_subscriptions')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
  `);
  console.log('Created missing table: push_subscriptions');
};
```

Also add `'push_subscriptions'` to the `VALID_TABLE_NAMES` Set at line 33 of `connection.ts`.

### Pattern 8: nginx — SW cache-control block

Add ABOVE the general `.js` regex location block:

```nginx
location = /sw.js {
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
    expires off;
    try_files $uri =404;
}
```

The `=` (exact match) takes priority over the `~*` regex block. The SW must never be cached — the browser relies on HTTP cache to detect SW updates and 24h stale SW causes PWA update failures.

[CITED: h5bp/server-configs-nginx#158 + nginx location priority docs]

### Pattern 9: Backend push route (server/src/routes/push.ts)

```typescript
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { db } from '../db/connection.js';
import { randomUUID } from 'crypto';

const router = Router();

router.get('/vapid-public-key', authenticateToken, (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ vapidPublicKey: key });
});

router.post('/subscribe', authenticateToken, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth)
    return res.status(400).json({ error: 'Invalid subscription' });
  db.prepare(`
    INSERT INTO push_subscriptions (id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
  `).run(randomUUID(), endpoint, keys.p256dh, keys.auth);
  res.status(201).json({ ok: true });
});

router.delete('/unsubscribe', authenticateToken, (req, res) => {
  const { endpoint } = req.body;
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  res.json({ ok: true });
});

export default router;
```

### Anti-Patterns to Avoid

- **Requesting permission on page load:** Browser auto-denies prompts not triggered by user gesture. Always gate behind the toggle click action. [D-12, VERIFIED: browser standards]
- **Storing PushSubscription as a single JSON blob column:** Store `endpoint`, `p256dh`, `auth` as separate columns — unique constraint on `endpoint` works cleanly, individual fields can be updated on conflict.
- **Keeping `workbox:` key in config when using injectManifest:** The keys are mutually exclusive — `workbox:` only applies to generateSW. Remove it entirely.
- **Missing `userVisibleOnly: true` in PushManager.subscribe:** All current browsers reject subscriptions without this flag.
- **VAPID subject pointing to localhost URI:** Safari's push endpoint rejects subscriptions where the VAPID subject is an `https://localhost` URI with `BadJwtToken`. Always use `mailto:` or production domain.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VAPID key generation | Custom ECDH P-256 crypto | `npx web-push generate-vapid-keys` | One wrong bit breaks all subscriptions |
| Push payload encryption | Custom AES-GCM + ECDH | `webpush.sendNotification()` | RFC 8291 encryption is complex and browser-specific |
| Base64url key decoding | Custom btoa/atob logic | `urlBase64ToUint8Array()` helper | Easy to get URL-safe padding wrong |
| Subscription deduplication | Custom INSERT logic | `UNIQUE` on `endpoint` column + `ON CONFLICT DO UPDATE` | DB enforces it — no race conditions |

---

## Common Pitfalls

### Pitfall 1: injectManifest drops runtime caching silently

**What goes wrong:** The existing `workbox.runtimeCaching` block (API NetworkFirst) disappears silently when switching to injectManifest. Vite does not warn about the unused key.

**Why it happens:** The `workbox:` config key only applies to generateSW. injectManifest ignores it entirely.

**How to avoid:** Decide explicitly whether to port the runtime cache to `sw.ts` (via workbox-routing + workbox-strategies imports) or omit it. For this project (LAN-only), omitting is the right call.

**Warning signs:** Build succeeds, no error, but DevTools Application > Cache Storage shows no API cache entries.

### Pitfall 2: SW filename is always .js at registration time

**What goes wrong:** Developer expects the SW to be registered as `sw.ts` but it is actually registered as `sw.js` (compiled by Vite).

**Why it happens:** Vite compiles TypeScript to JavaScript during build. vite-plugin-pwa registers the compiled output.

**How to avoid:** nginx `location = /sw.js` exact match. Confirm in DevTools Application > Service Workers tab after build.

### Pitfall 3: Stale subscriptions after browser data clear

**What goes wrong:** User clears browser storage — subscription is gone from browser but remains in `push_subscriptions` table. `webpush.sendNotification()` returns HTTP 410 Gone. All future pushes to that endpoint silently fail.

**Why it happens:** Push subscriptions are stored in browser-side storage, scoped to the browser profile. Clearing data invalidates them without notifying the server.

**How to avoid:** Catch 410 and 404 from `webpush.sendNotification()` and delete the subscription from the DB immediately (implemented in Pattern 5 above).

**Warning signs:** 410 errors in server logs; user receives no notifications after clearing browser data.

### Pitfall 4: reminderScheduler SMTP guard blocks push

**What goes wrong:** Current `server/src/index.ts` (lines 47-52) only starts the reminder scheduler if `SMTP_HOST && EMAIL_FROM` are configured. If SMTP is not set up, push reminders also never fire.

**Why it happens:** The scheduler startup is gated entirely on email config. Push was not anticipated when this gate was written.

**How to avoid:** Per D-08 — start `reminderScheduler` unconditionally. Inside `checkAndSendReminders()`, conditionally call email (if SMTP configured) and push (if VAPID configured). Both are optional.

**Warning signs:** VAPID keys are configured but push reminder notifications never arrive, because SMTP is absent.

### Pitfall 5: iOS push requires installed PWA

**What goes wrong:** Push notifications do not arrive on iOS when the app is open as a browser tab. They only work when the PWA is installed to home screen (Add to Home Screen).

**Why it happens:** iOS 16.4+ supports Web Push only for installed PWAs — not for browser sessions.

**How to avoid:** This is a platform limitation. In the Settings toggle, detect iOS non-standalone mode via `window.matchMedia('(display-mode: standalone)').matches` and show a note prompting installation.

[CITED: Apple Developer Forums, Progressier documentation]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| generateSW (automatic) | injectManifest (custom sw.ts) | Required for push handlers | Must migrate — no custom listeners possible in auto-generated SW |
| FCM/GCM API key | VAPID (RFC 8292) | 2017 standard, universal by 2020 | No Firebase account needed; browser-native |
| `workbox: {}` in vite config | `injectManifest: {}` | Same vite-plugin-pwa, different strategy | Different key name; runtime caching moves to sw.ts |
| GCM registration_id | PushSubscription.endpoint | — | web-push handles both; endpoint is the correct abstraction |

**Deprecated/outdated:**
- `generateSW` for push: Not supported — use injectManifest for any custom SW logic
- GCM API key: Replaced by VAPID universally; `web-push` still accepts it but modern browsers require VAPID
- `applicationServerKey` as plain base64 string: Chrome requires `Uint8Array` — `urlBase64ToUint8Array()` conversion is mandatory

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Runtime caching (API NetworkFirst) can be safely omitted since the app requires LAN access | Architecture Pattern 2 | If offline API caching is actually needed, must add workbox-routing + workbox-strategies to sw.ts |
| A2 | `web-push` 3.6.7 is the only current stable release (no newer version) | Standard Stack | If a newer version has been released it may have different API or fix important bugs |

---

## Open Questions

1. **Runtime caching in custom SW**
   - What we know: Existing generateSW config has `runtimeCaching` for `/api` (NetworkFirst, 24h). This is lost on injectManifest switch.
   - What's unclear: Is this API cache actually providing value? The app requires LAN Docker access anyway — offline use is not a supported scenario.
   - Recommendation: Omit from sw.ts. The app is not offline-capable by design. Add a comment in sw.ts noting the omission.

2. **Aging-ticket check timing**
   - What we know: D-09 says to add a daily check. autoCloseScheduler runs at 02:30. Claude has discretion over interval vs piggyback.
   - What's unclear: Best time of day. Aging notifications at 02:30 will wake up nobody useful.
   - Recommendation: Add `pushScheduler.ts` with `cron.schedule('0 9 * * *', ...)` — 09:00 daily, when the user is likely to be at their desk.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `web-push` npm | Backend push sends | Not yet — install step | 3.6.7 | — |
| `workbox-precaching` npm | sw.ts precacheAndRoute | Not yet — install step | 7.4.0 | — |
| Docker/nginx (production) | SW cache-control headers | Present on server | nginx | — |
| Browser Push API | PUSH-01 through PUSH-04 | Chrome/Firefox: yes; iOS 16.4+ with installed PWA: yes | — | Show "not supported" toggle state |
| VAPID keys in .env | All push functionality | Not yet — manual generation step | — | Graceful disabled state |

**Missing dependencies with no fallback:**
- VAPID keys must be generated and added to `.env` before any push functionality can be tested. This is a manual one-time step that blocks all push testing.

**Missing dependencies with fallback:**
- iOS non-PWA mode: show install prompt instead of toggle
- Browser push not supported (old browser): toggle shows "not supported" state

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `authenticateToken` middleware on all three push routes |
| V3 Session Management | no | — |
| V4 Access Control | yes | Push routes behind auth; single-user system |
| V5 Input Validation | yes | Validate `endpoint`, `p256dh`, `auth` shape on POST /api/push/subscribe |
| V6 Cryptography | yes | web-push library handles RFC 8291 AES-GCM encryption — do not hand-roll |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Rogue subscription injection (attacker posts endpoint) | Spoofing | `authenticateToken` on all push endpoints |
| VAPID private key exposure | Information Disclosure | Store in `.env` only; never log, never return in API response |
| Notification spam from scheduler | Denial of Service | Single-user; bounded by ticket count and daily cron frequency |

**CSP update required (D-14):** Current Helmet `connectSrc` is `["'self'"]` (server/src/index.ts line 79). Push service endpoints vary by browser (Mozilla: `https://*.push.services.mozilla.com`, Chrome: `https://fcm.googleapis.com`, Safari: `https://api.push.apple.com`). Recommended value: `["'self'", "https:"]` — allows any HTTPS, avoids maintaining a browser-specific allowlist that changes as browsers evolve.

---

## Sources

### Primary (HIGH confidence)
- [vite-pwa-org.netlify.app/guide/inject-manifest.html](https://vite-pwa-org.netlify.app/guide/inject-manifest.html) — injectManifest config, TypeScript SW, WebWorker lib requirement
- [github.com/web-push-libs/web-push README](https://github.com/web-push-libs/web-push/blob/master/README.md) — VAPID setup, setVapidDetails, sendNotification, key generation
- Project codebase: `vite.config.ts`, `server/src/index.ts`, `server/tsconfig.json`, `server/src/lib/reminderScheduler.ts`, `server/src/lib/autoCloseScheduler.ts`, `server/src/db/connection.ts`, `server/package.json`, `package.json`, `tsconfig.app.json`, `nginx.conf`

### Secondary (MEDIUM confidence)
- [npmjs.com/package/web-push](https://www.npmjs.com/package/web-push) — version 3.6.7 confirmed
- [npmjs.com/package/workbox-precaching](https://www.npmjs.com/package/workbox-precaching) — version 7.4.0 confirmed
- [MDN PushManager.subscribe()](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe) — applicationServerKey as ArrayBuffer requirement
- [web-push-libs/web-push issue #558](https://github.com/web-push-libs/web-push/issues/558) — urlBase64ToUint8Array requirement confirmed

### Tertiary (LOW confidence)
- Apple Developer Forums, Progressier documentation — iOS PWA push requiring installed (standalone) PWA

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — web-push and workbox-precaching are the only options; versions verified via registry
- Architecture: HIGH — all patterns verified against official vite-plugin-pwa docs and existing codebase code inspection
- Pitfalls: HIGH — all except iOS note verified against official sources or direct codebase code reading

**Research date:** 2026-04-05
**Valid until:** 2026-07-05 (stable APIs — web-push has been at 3.6.7 for ~2 years; vite-plugin-pwa 0.20.x is current)
