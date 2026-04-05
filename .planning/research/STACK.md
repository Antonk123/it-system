# Technology Stack — Productivity & Insights (v1.5)

**Project:** IT Ticket System
**Milestone scope:** Time tracking per ticket, PWA push notifications, database backup/export as zip, KB article search sidebar in ticket detail view
**Researched:** 2026-04-05
**Overall confidence:** HIGH (package.json verified; web-push/archiver versions confirmed via npm registry search)

---

## Existing Stack (do not change)

React 18.3.1 + Vite 7 + Express 4.21.2 + better-sqlite3 11.7.0 + TypeScript 5.8.3 + Tiptap 3.20.x + shadcn/Radix UI + Tailwind CSS 3.4.17 + Framer Motion 12.38.0 + recharts 2.15.4 + vite-plugin-pwa 0.20.5 + workbox-window 7.0.0 + node-cron (3.0.3 server / 4.2.1 frontend).

All new libraries must slot into this stack without replacing anything already installed.

---

## Feature Coverage Map

| Feature | New Backend Dep | New Frontend Dep | Schema/Config Change |
|---------|----------------|------------------|---------------------|
| Time tracking per ticket | none | none | New `time_entries` table; new `/api/tickets/:id/time` routes |
| PWA push notifications | **`web-push ^3.6.7`** | none (service worker already in place) | New `push_subscriptions` table; VAPID key env vars; sw.ts push handler |
| Backup & export as zip | **`archiver ^7.0.1`** + **`@types/archiver ^6.0.3`** | none | New `/api/admin/backup` route |
| KB sidebar in ticket detail | none | none | Reuse existing `/api/kb/articles` FTS5 search endpoint |

**Total new npm packages: 3** (2 server + 1 server dev types)

---

## New Backend Dependencies

### 1. web-push ^3.6.7

**Purpose:** Generates VAPID key pairs, encrypts payloads, and delivers push notifications to browser push services (Chrome, Firefox, Edge, Safari 16.4+). The server sends notifications; the browser's push service delivers them.

**Why web-push:** It is the canonical Node.js VAPID/Web Push library (web-push-libs org, used by MDN examples and Google web.dev docs). No viable maintained alternative exists for self-hosted push without a cloud intermediary. The library is stable at 3.6.7 — last published ~2 years ago but the Web Push protocol is a finalized RFC (RFC 8030 + RFC 8291 + RFC 8292); no protocol changes are pending.

**Integration points:**
- Call `webpush.generateVAPIDKeys()` once to generate key pair; store in `.env` as `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
- Call `webpush.setVapidDetails('mailto:admin@prefabmastarna.se', publicKey, privateKey)` at server startup
- Store push subscriptions (endpoint + keys) in a new `push_subscriptions` SQLite table
- Trigger `webpush.sendNotification(subscription, JSON.stringify(payload))` from the existing node-cron scheduler (reminders, aging tickets)
- Expose `GET /api/push/vapid-public-key` (returns public key for client subscription) and `POST /api/push/subscribe` (saves subscription)

**TypeScript:** `@types/web-push ^3.6.4` available on npm. Install alongside.

**Confidence:** HIGH — npm registry confirmed version 3.6.7; web.dev official docs verified API pattern; RFC-stable protocol.

---

### 2. archiver ^7.0.1

**Purpose:** Streams a ZIP archive of the SQLite database file + uploads directory to the HTTP response without buffering the entire archive in memory. The `archiver` package is the standard streaming zip library for Node.js.

**Why archiver:** 6,274+ downstream projects on npm, maintained under the archiverjs org, Express streaming pattern is well-documented. The alternative (`jszip`) buffers the entire archive in memory — unsuitable for potentially large uploads directories. `archiver` pipes directly to `res`, keeping memory usage flat regardless of archive size.

**Integration points:**
- New route `GET /api/admin/backup` (protected by JWT middleware)
- Use `better-sqlite3`'s built-in `.backup(destPath)` async method to write a point-in-time snapshot to a temp file, then add that temp file to the archive (avoids file locking issues with the live DB file)
- Pipe uploads directory (`/data/uploads`) and the DB snapshot file into the archive
- Set response headers: `Content-Disposition: attachment; filename="backup-YYYY-MM-DD.zip"`, `Content-Type: application/zip`
- Clean up temp DB snapshot after archive finalizes

```typescript
// Sketch — actual implementation in phase plan
const archive = archiver('zip', { zlib: { level: 6 } });
res.attachment(`backup-${date}.zip`);
archive.pipe(res);
archive.file(dbSnapshotPath, { name: 'tickets.db' });
archive.directory(uploadsDir, 'uploads');
await archive.finalize();
```

**TypeScript:** `@types/archiver ^6.0.3` covers the 7.x API. Install as devDependency.

**Confidence:** HIGH — npm registry confirmed version 7.0.1; streaming Express pattern verified from multiple sources.

---

## New Frontend Dependencies

### None Required

| Capability | Library | Status |
|-----------|---------|--------|
| KB search in ticket detail | Existing `/api/kb/articles?search=` FTS5 endpoint | Already works |
| Inline KB panel UI | shadcn `<Sheet>` or `<Popover>` component | Already available via shadcn |
| Push subscription (client) | Browser `PushManager` API (native) | No npm package needed |
| Push permission UI | shadcn `<Button>` + `<Alert>` | Already available |
| Time entry UI | shadcn `<Dialog>`, `<Input>`, `<Table>` | Already available |
| Time entry duration display | `date-fns ^3.6.0` | Already installed |

**Confidence:** HIGH — verified from package.json + browser Web Push API is native with no npm wrapper needed.

---

## Service Worker Changes (not an npm install)

The existing vite-plugin-pwa is configured with `strategies: 'generateSW'` (assumed from the existing setup). Push notification handling requires custom service worker code, which means switching to `strategies: 'injectManifest'` or using the `workbox.importScripts` option.

**Recommended approach: switch to `injectManifest`** so `src/sw.ts` can be written in TypeScript with full control over the `push` event listener.

**TypeScript configuration required** (add to `tsconfig.json`):
```json
{
  "lib": ["ES2020", "WebWorker"]
}
```

**sw.ts additions needed:**
```typescript
declare let self: ServiceWorkerGlobalScope;

self.addEventListener('push', (event) => {
  const data = event.data?.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      data: { url: data.url }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

**Confidence:** MEDIUM — vite-plugin-pwa injectManifest docs verified; push event pattern is standard Web Push API (MDN).

---

## New DB Schema

### time_entries table

```sql
CREATE TABLE IF NOT EXISTS time_entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,          -- ISO-8601 UTC
  ended_at   TEXT,                   -- NULL = timer still running
  duration_seconds INTEGER,          -- computed on stop; allows manual entry without start/stop
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_time_entries_ticket ON time_entries(ticket_id);
```

**Reasoning:** `duration_seconds` stored explicitly (not derived) so manual entries (e.g. "I spent 2 hours yesterday") work without requiring start/end times. `started_at` + `ended_at` support a live timer. ISO-8601 text is consistent with the rest of the schema.

### push_subscriptions table

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint  TEXT NOT NULL UNIQUE,
  p256dh    TEXT NOT NULL,
  auth      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Reasoning:** `endpoint` is the unique identifier for a browser's push subscription. At single-user scale, this table will have at most 2-3 rows (one per device/browser). The endpoint + p256dh + auth triple is exactly what `web-push` requires to encrypt and deliver.

---

## New API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/push/vapid-public-key` | Returns VAPID public key for client to subscribe |
| POST | `/api/push/subscribe` | Save or update push subscription from browser |
| DELETE | `/api/push/subscribe` | Remove subscription (unsubscribe) |
| GET | `/api/tickets/:id/time` | List time entries for a ticket |
| POST | `/api/tickets/:id/time` | Create time entry (manual or start timer) |
| PATCH | `/api/tickets/:id/time/:entryId` | Update entry (stop timer, edit notes/duration) |
| DELETE | `/api/tickets/:id/time/:entryId` | Delete time entry |
| GET | `/api/admin/backup` | Stream ZIP backup of DB + uploads |

---

## Installation

```bash
# Server — new runtime dependencies
cd server
npm install web-push@^3.6.7
npm install -D @types/web-push@^3.6.4 @types/archiver@^6.0.3
npm install archiver@^7.0.1
```

```bash
# VAPID key generation (run once, store in .env)
node -e "const wp = require('web-push'); console.log(wp.generateVAPIDKeys())"
```

Add to `server/.env`:
```
VAPID_PUBLIC_KEY=<generated>
VAPID_PRIVATE_KEY=<generated>
VAPID_SUBJECT=mailto:admin@prefabmastarna.se
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Push notifications | `web-push` (self-hosted VAPID) | Firebase FCM / OneSignal | External dependency, requires cloud account, overkill for single-user internal tool |
| Push notifications | `web-push` | `ntfy` (self-hosted push server) | Additional Docker container; web-push integrates directly into Express; no extra ops |
| Zip generation | `archiver` (streaming) | `jszip` | jszip buffers entire archive in memory; unsuitable for large uploads dirs |
| Zip generation | `archiver` | `adm-zip` | adm-zip also memory-based; archiver streams |
| DB backup | `better-sqlite3 .backup()` + archiver | `sqlite3` CLI via `child_process` | better-sqlite3's built-in async backup API is already available; no shell exec needed |
| Time tracking state | Local `useState` timer | Server-side timer | Single-user; browser timer is simpler; duration is committed to DB on stop |
| KB sidebar UI | shadcn `<Sheet>` (slide-in panel) | Inline expand below ticket fields | Sheet keeps ticket fields visible; standard pattern for contextual panels |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Firebase FCM | Cloud dependency, account required, overkill for single-user | `web-push` with VAPID |
| `push.js` | Unmaintained wrapper over Notification API; doesn't handle service worker push | Native `PushManager` API + `web-push` on server |
| `jszip` | Buffers entire ZIP in memory | `archiver` with streaming |
| `adm-zip` | Also memory-based, no streaming support | `archiver` |
| `multer` additions | Backup endpoint reads files from filesystem, not uploading | Use `fs` + `archiver` directly |
| `react-stopwatch` / timer libraries | Single start/stop timer per ticket — trivial with `useState` + `setInterval` + `date-fns` | Implement inline in component |
| `workbox-recipes` | New workbox package | Use `workbox-window` (already installed) for client-side SW registration |
| `socket.io` | Real-time timer sync — single-user, single tab assumed | Not needed |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `web-push ^3.6.7` | Node.js 14+ | Works with TypeScript via `@types/web-push ^3.6.4` |
| `archiver ^7.0.1` | Node.js 14+ | `@types/archiver ^6.0.3` covers the 7.x API |
| `better-sqlite3 ^11.7.0 .backup()` | Existing version | `.backup()` is a built-in method — no version change needed |
| `vite-plugin-pwa ^0.20.5` | injectManifest strategy | Switch from generateSW; requires `src/sw.ts` custom service worker file |
| `workbox-window ^7.0.0` | Already installed | Used by vite-plugin-pwa for SW registration; no change |

---

## Sources

- `package.json` — confirmed existing frontend packages (HIGH confidence, direct file read)
- `server/package.json` — confirmed existing backend packages (HIGH confidence, direct file read)
- npm registry search — `web-push` 3.6.7 latest stable (HIGH confidence, WebSearch + npm registry)
- npm registry search — `archiver` 7.0.1 latest stable (HIGH confidence, WebSearch + npm registry)
- [web-push GitHub (web-push-libs)](https://github.com/web-push-libs/web-push) — API surface: `generateVAPIDKeys`, `setVapidDetails`, `sendNotification` (HIGH confidence, WebFetch)
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — `.backup(destination)` returns Promise, live backup without connection close (HIGH confidence, WebFetch)
- [vite-pwa injectManifest guide](https://vite-pwa-org.netlify.app/guide/inject-manifest.html) — `strategies: 'injectManifest'` + `WebWorker` lib in tsconfig (MEDIUM confidence, WebFetch)
- [web.dev push notifications guide](https://web.dev/articles/codelab-notifications-push-server) — subscription storage pattern; `push` event handler (HIGH confidence)
- [Pushpad — PushSubscription storage](https://pushpad.xyz/blog/web-push-notifications-store-the-subscription-in-the-backend-database) — `endpoint`, `p256dh`, `auth` schema (MEDIUM confidence, WebSearch)
- archiver Express streaming pattern — `archive.pipe(res)` + `archive.directory()` + `archive.finalize()` (HIGH confidence, multiple sources)

---

*Stack research for: IT Ticket System v1.5 Productivity & Insights*
*Researched: 2026-04-05*
