# Architecture Research

**Domain:** IT Ticket System — v1.5 Productivity & Insights
**Researched:** 2026-04-05
**Confidence:** HIGH (direct codebase analysis + verified library documentation)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  React 18 Frontend (nginx/Vite)                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ TicketDetail │  │   Reports    │  │   Settings   │               │
│  │  + TimeLog   │  │  + TimeTab   │  │  + Backup UI │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                  │                       │
│  ┌──────┴─────────────────┴──────────────────┴──────────────────┐   │
│  │  api.ts (ApiClient)  ·  React Query hooks  ·  usePushNotif   │   │
│  └──────────────────────────────────┬─────────────────────────── ┘  │
│  Service Worker (Workbox +                                           │
│  custom push handler)               │                               │
└────────────────────────────────────┼────────────────────────────────┘
                                      │  HTTP / Fetch
┌─────────────────────────────────────┼────────────────────────────────┐
│  Express Backend (Node.js)          │                                 │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────┐  ┌──────────┐ │
│  │ /api/time-   │  │  /api/push    │  │  /api/      │  │ /api/kb  │ │
│  │  logs        │  │  (sub/send)   │  │  backup     │  │  (exist) │ │
│  └──────┬───────┘  └───────┬───────┘  └──────┬──────┘  └──────────┘ │
│         │                  │                  │                       │
│  ┌──────┴──────────────────┴──────────────────┴──────────────────┐   │
│  │  better-sqlite3 (WAL mode)  ·  node-cron scheduler            │   │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  /data/database.sqlite   /data/uploads/                               │
└────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New or Modified |
|-----------|----------------|-----------------|
| `ticket_time_logs` table | Store start/stop time entries per ticket | NEW |
| `push_subscriptions` table | Store browser push subscription objects | NEW |
| `/api/time-logs` routes | CRUD for time entries | NEW |
| `/api/push` routes | Subscribe/unsubscribe/send | NEW |
| `/api/backup` route | Stream zip of DB + uploads | NEW |
| `TimeLogSection.tsx` | Log/display time on ticket detail | NEW |
| `KBSidebarSearch.tsx` | Inline KB search panel in ticket detail | NEW |
| `usePushNotifications.ts` | Register SW push, manage permission | NEW |
| `useTimeLogs.ts` | React Query CRUD for time entries | NEW |
| Service worker (`sw.ts`) | Handle `push` event, show notification | MODIFIED |
| `vite.config.ts` | Switch to `injectManifest` strategy | MODIFIED |
| `TicketDetail.tsx` | Mount TimeLogSection + KBSidebarSearch | MODIFIED |
| `Reports.tsx` | Add time analytics tab | MODIFIED |
| `connection.ts` | Add new table migrations | MODIFIED |
| `reminderScheduler.ts` | Trigger push in addition to email | MODIFIED |

---

## Recommended Project Structure

```
server/src/
├── routes/
│   ├── time-logs.ts        # NEW — time tracking CRUD
│   └── push.ts             # NEW — push subscription management + send
├── lib/
│   ├── pushNotifications.ts  # NEW — web-push wrapper, sendPushToAll()
│   └── reminderScheduler.ts  # MODIFIED — call pushNotifications after email

src/
├── components/
│   ├── TimeLogSection.tsx  # NEW — time entry log on ticket detail
│   └── KBSidebarSearch.tsx # NEW — inline KB search panel (replaces/extends KBLinksSection)
├── hooks/
│   ├── useTimeLogs.ts      # NEW — React Query wrapper for /api/time-logs
│   └── usePushNotifications.ts  # NEW — permission, subscribe, unsubscribe
├── pages/
│   └── Settings.tsx        # MODIFIED — add Backup section + Push notification opt-in
└── sw.ts                   # NEW (custom service worker, replaces generated SW)
```

---

## Architectural Patterns

### Pattern 1: Time Tracking — Log-Entry Model

**What:** Each time entry is a discrete row with `started_at` and optionally `stopped_at`. Duration is computed as `(stopped_at - started_at)` in seconds. A `NULL` `stopped_at` means a timer is currently running.

**When to use:** Simpler than storing a running timer in application state — the database is the source of truth for active timers. Survives page reloads and multiple sessions.

**Trade-offs:** Requires one extra query to detect "active timer" for a ticket (WHERE stopped_at IS NULL). Suits single-user: no locking concerns.

**Schema:**
```sql
CREATE TABLE ticket_time_logs (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  started_at  TEXT NOT NULL,           -- ISO-8601 UTC
  stopped_at  TEXT,                    -- NULL = timer running
  note        TEXT,                    -- optional label
  duration_s  INTEGER GENERATED ALWAYS AS (
    CASE WHEN stopped_at IS NOT NULL
    THEN CAST((julianday(stopped_at) - julianday(started_at)) * 86400 AS INTEGER)
    ELSE NULL END
  ) VIRTUAL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_time_logs_ticket ON ticket_time_logs(ticket_id);
CREATE INDEX idx_time_logs_started ON ticket_time_logs(started_at);
```

Note: SQLite generated columns (VIRTUAL) require SQLite 3.31+. The Docker base image ships a recent enough SQLite. If unsure, compute duration in the SELECT query instead — `CAST((julianday(stopped_at) - julianday(started_at)) * 86400 AS INTEGER) as duration_s` — and omit the GENERATED ALWAYS clause entirely. This is safer and is the recommended approach.

**API endpoints:**
```
POST   /api/time-logs          — start timer { ticket_id, note? }
PATCH  /api/time-logs/:id/stop — stop timer (sets stopped_at = now)
PATCH  /api/time-logs/:id      — edit note
DELETE /api/time-logs/:id      — delete entry
GET    /api/tickets/:id/time-logs — all entries for a ticket
GET    /api/time-logs/summary  — aggregate per ticket (for Reports tab)
```

**Frontend hook:**
```typescript
// useTimeLogs.ts
const { logs, totalSeconds, isRunning, start, stop, deleteLog } = useTimeLogs(ticketId);
```

`isRunning` = `logs.some(l => l.stopped_at === null)`. The active entry's `id` is known so `stop()` can PATCH it directly.

### Pattern 2: PWA Push Notifications — VAPID + Custom Service Worker

**What:** The browser Push API requires a service worker to handle push events. `vite-plugin-pwa` with `generateSW` strategy does not support custom push handlers. Switch to `injectManifest` strategy to use a hand-written `sw.ts` that handles both Workbox precaching and push events.

**When to use:** Any time the backend needs to proactively alert the user about reminders or aging tickets — even when the app tab is not in focus.

**Trade-offs:** `injectManifest` requires maintaining a custom SW file. More setup than `generateSW`, but only ~30 lines extra for the push handler. No ongoing complexity.

**Two-table approach — single subscriber model:**

Since this is a single-user system, one push subscription is expected at a time. Store the browser's `PushSubscription` JSON in a table:

```sql
CREATE TABLE push_subscriptions (
  id           TEXT PRIMARY KEY,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
```

VAPID keys are stored as environment variables (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) and generated once at setup.

**Backend send helper (`lib/pushNotifications.ts`):**
```typescript
import webpush from 'web-push';

webpush.setVapidDetails(
  'mailto:' + process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function sendPushToAll(payload: { title: string; body: string; url?: string }) {
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  for (const sub of subs) {
    const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    await webpush.sendNotification(subscription, JSON.stringify(payload))
      .catch(err => {
        if (err.statusCode === 410) {
          // Subscription expired — remove it
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
        }
      });
  }
}
```

**Custom service worker (`src/sw.ts`):**
```typescript
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// Workbox injects the manifest here at build time
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'IT-Ticket', {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      data: { url: data.url ?? '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

**vite.config.ts change:**
```typescript
VitePWA({
  strategies: 'injectManifest',  // was: not set (defaults to generateSW)
  srcDir: 'src',
  filename: 'sw.ts',
  // rest of manifest/workbox config unchanged
})
```

**Frontend hook (`usePushNotifications.ts`):**
```typescript
// Calls Notification.requestPermission(), subscribes via pushManager.subscribe()
// POSTs subscription to /api/push/subscribe
// Stores "subscribed" state in localStorage so the UI reflects current state
```

**Triggering push from scheduler:** In `reminderScheduler.ts`, after sending email (or instead of it when SMTP is not configured), call `sendPushToAll()` with the reminder's ticket title. Same for aging-ticket alerts — add a new daily cron check.

**API endpoints:**
```
GET    /api/push/vapid-public-key   — returns VAPID_PUBLIC_KEY for subscription
POST   /api/push/subscribe          — saves PushSubscription to DB
DELETE /api/push/unsubscribe        — removes subscription by endpoint
POST   /api/push/test               — sends a test notification (dev/settings use)
```

### Pattern 3: Backup & Export — Streaming Zip

**What:** On demand, the backend creates a zip containing:
1. The SQLite database file (using `db.backup()` to a temp path, then add to zip)
2. The uploads directory

Stream the zip directly in the HTTP response. No temp file needed for the zip — `archiver` pipes to `res`.

**When to use:** Simple, zero-dependency on external services. SQLite's `backup()` API creates a consistent snapshot even while the DB is being written.

**Trade-offs:** Blocking for the duration of the backup copy. On a small DB (< 50MB) this is under a second. No restore UI needed for v1.5 — download only.

**better-sqlite3 backup API:**
```typescript
// db.backup(destPath) returns a Promise
// The same connection can still handle queries during backup
await db.backup(tmpDbPath);
```

This produces a clean, consistent DB file (WAL checkpointed into the backup) even during live writes.

**Implementation (`routes/backup.ts`):**
```typescript
import archiver from 'archiver';
import { db } from '../db/connection.js';

router.get('/download', authenticate, async (req, res) => {
  const tmpDbPath = `/tmp/backup-${Date.now()}.sqlite`;
  await db.backup(tmpDbPath);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="it-ticket-backup-${dateStr}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);
  archive.file(tmpDbPath, { name: 'database.sqlite' });
  archive.directory(UPLOAD_DIR, 'uploads');
  await archive.finalize();

  // Cleanup tmp file after stream ends
  res.on('finish', () => fs.unlink(tmpDbPath, () => {}));
});
```

**Frontend:** A single Button in Settings that calls `window.location.href = '/api/backup/download'` (or uses a fetch with blob download). No React Query cache needed — it is a file download, not a data query.

**Install:** `npm install archiver` + `npm install -D @types/archiver` on the server.

### Pattern 4: KB Sidebar Search from Ticket View

**What:** An enhanced version of the existing `KBLinksSection` component that adds FTS5-powered live search within the ticket detail panel. Currently `KBLinksSection` fetches all articles on popover open and filters client-side. The upgrade adds a debounced call to `/api/kb/articles?search=` (already wired for FTS5) for better relevance.

**When to use:** The existing `KBLinksSection` component already handles article linking. No new backend work is needed — FTS5 search already exists at `GET /api/kb/articles?search=`. The change is purely frontend: upgrade the search input in `KBLinksSection` to call the API rather than filtering the in-memory article list.

**Trade-offs:** Small migration — the existing component structure is reused. The popover becomes API-driven rather than loading all articles upfront, which is better for large KB collections.

**What changes in `KBLinksSection.tsx`:**
```typescript
// Current: load all articles on open, filter client-side
// New: debounced fetch to /api/kb/articles?search=<query>&status=published&limit=20
// on each keystroke in the CommandInput

const { data: searchResults, isLoading } = useQuery({
  queryKey: ['kb-search', searchQuery],
  queryFn: () => api.getKbArticles({ search: searchQuery, status: 'published', limit: 20 }),
  enabled: searchQuery.length > 0,
  staleTime: 30_000,
});
```

The "already linked" filter still runs client-side: `searchResults?.filter(a => !linked.some(l => l.id === a.id))`.

An idle state (empty query) shows a brief prompt: "Sök KB-artiklar..." with no results list, reducing the perceived latency vs. the current "load all" approach.

---

## Data Flow

### Time Tracking: Start/Stop Timer

```
User clicks "Starta timer" in TimeLogSection
  → POST /api/time-logs { ticket_id }
  → INSERT ticket_time_logs (started_at = now, stopped_at = NULL)
  → React Query invalidates ['time-logs', ticketId]
  → TimeLogSection re-renders with active entry shown

User clicks "Stoppa"
  → PATCH /api/time-logs/:id/stop
  → UPDATE ticket_time_logs SET stopped_at = now WHERE id = ?
  → React Query invalidates
  → Entry shows elapsed time
```

### Push Notification: Reminder Fires

```
reminderScheduler cron (every minute)
  → Finds due reminders (sent = 0, reminder_time <= now)
  → For each: sendEmail() (if SMTP configured)
            + sendPushToAll({ title, body, url: /tickets/:id })
  → Marks reminder sent = 1
  → Browser receives push even if app tab is closed
  → SW shows OS notification
  → User clicks → app opens at /tickets/:id
```

### Backup Download

```
User clicks "Ladda ner backup" in Settings
  → GET /api/backup/download (streaming response)
  → db.backup('/tmp/backup-XXX.sqlite')  [async, non-blocking for other queries]
  → archiver streams zip: database.sqlite + uploads/
  → Browser receives zip download
  → tmp file cleaned up
```

### KB Sidebar Search

```
User types in KB search in TicketDetail sidebar
  → 300ms debounce fires
  → GET /api/kb/articles?search=<query>&status=published&limit=20
  → FTS5 returns ranked results with <mark> snippets
  → Results shown in popover (minus already-linked articles)
  → User selects → POST to /api/tickets/:id/kb-links (existing endpoint)
```

---

## Scaling Considerations

This is a single-user system. Scaling is not a concern. The table below documents "what breaks if load unexpectedly increases" for reference only.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 user (current) | Everything in single process is fine |
| 10 concurrent users | WAL mode handles concurrent reads; backup endpoint needs timeout guard |
| 100+ users | Move backup to background job, store subscriptions per-user, web-push batching |

---

## Anti-Patterns

### Anti-Pattern 1: Using generateSW Strategy for Push Notifications

**What people do:** Try to add a `customSW` option to the `generateSW` config, or inject push handlers via `additionalManifestEntries`.

**Why it's wrong:** `generateSW` generates the entire service worker — you cannot add arbitrary event listeners. The only supported way to add `push` event handlers is `injectManifest` with your own `sw.ts`.

**Do this instead:** Switch `strategies: 'injectManifest'`, create `src/sw.ts` with `precacheAndRoute(self.__WB_MANIFEST)` at the top, then add push handlers below it.

### Anti-Pattern 2: Computing Duration Client-Side

**What people do:** Store only `started_at`, compute elapsed time in React with `setInterval` updating state every second.

**Why it's wrong:** Creates a "timer that disappears on page reload." The single-user app may be refreshed while a timer runs. The DB-as-source-of-truth approach (NULL stopped_at = running) survives any client reset.

**Do this instead:** The timer display can use client-side `Date.now() - started_at` for the UI counter — that is fine. But `started_at` must be persisted immediately on start, not held in component state.

### Anti-Pattern 3: Zipping the Live SQLite File Directly

**What people do:** Add `database.sqlite` to the archiver directly by path while the DB is in use.

**Why it's wrong:** With WAL mode, the live `.sqlite` file may be in an inconsistent state mid-write. WAL journal is not included in the zip.

**Do this instead:** Always call `db.backup(tmpPath)` first. `better-sqlite3`'s backup API performs an online backup that checkpoints WAL and produces a clean, self-contained file.

### Anti-Pattern 4: Fetching All KB Articles for the Sidebar

**What people do:** Keep the current `api.getKbArticles()` call (no search param) when the popover opens, then filter client-side.

**Why it's wrong:** As the KB grows, this loads hundreds of articles on every popover open. FTS5 search with a 20-result limit is faster and produces ranked, relevant results.

**Do this instead:** Only call `getKbArticles({ search: query })` when the user has typed at least 1 character. Show an empty/prompt state when idle.

### Anti-Pattern 5: Storing VAPID Keys in the DB

**What people do:** Generate VAPID keys at first run and store them in a settings table.

**Why it's wrong:** VAPID keys must survive DB restores. A backup restore would wipe the keys, invalidating all existing push subscriptions permanently.

**Do this instead:** Store VAPID keys as Docker environment variables (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`). Generate them once via `npx web-push generate-vapid-keys` and document them in the deployment guide. They persist across DB restores because they live in environment config, not the database.

---

## Integration Points

### New vs Modified — Explicit List

| Item | Status | Why |
|------|--------|-----|
| `ticket_time_logs` table | NEW | New domain — no existing schema |
| `push_subscriptions` table | NEW | Stores browser PushSubscription |
| `server/src/routes/time-logs.ts` | NEW | CRUD for time entries |
| `server/src/routes/push.ts` | NEW | Push subscription management |
| `server/src/routes/backup.ts` | NEW | Zip download endpoint |
| `server/src/lib/pushNotifications.ts` | NEW | web-push wrapper |
| `src/components/TimeLogSection.tsx` | NEW | Timer UI in ticket detail |
| `src/components/KBSidebarSearch.tsx` | NEW or `KBLinksSection` refactor | API-driven search |
| `src/hooks/useTimeLogs.ts` | NEW | React Query for time entries |
| `src/hooks/usePushNotifications.ts` | NEW | Push registration |
| `src/sw.ts` | NEW | Custom SW with push handler |
| `vite.config.ts` | MODIFIED — strategy only | `injectManifest` switch |
| `server/src/index.ts` | MODIFIED | Register new routes |
| `server/src/db/connection.ts` | MODIFIED | New `ensure*` migrations |
| `server/src/lib/reminderScheduler.ts` | MODIFIED | Add push call after email |
| `src/pages/TicketDetail.tsx` | MODIFIED | Add TimeLogSection, upgrade KB panel |
| `src/pages/Reports.tsx` | MODIFIED | Add time analytics tab |
| `src/pages/Settings.tsx` | MODIFIED | Push opt-in UI + backup button |
| `src/lib/api.ts` | MODIFIED | New methods for time-logs, push, backup |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `reminderScheduler` → `pushNotifications` | Direct function call | Same process, no IPC needed |
| Frontend SW ↔ Backend | Push API via browser's push service (e.g., FCM) | VAPID signed, not direct HTTP |
| `backup.ts` → `archiver` → `res` | Node.js stream pipe | No buffering in memory |
| `KBLinksSection` → `/api/kb/articles` | Existing HTTP endpoint | No backend changes needed |

---

## Build Order

Dependencies drive this order. Each feature is independently buildable with no cross-dependencies except that push notifications require the `sw.ts` change to `vite.config.ts` to land first.

### Phase 1 — Time Tracking (DB + backend + UI)

1. Add migration in `connection.ts` — create `ticket_time_logs` table
2. Create `server/src/routes/time-logs.ts` — start, stop, list, delete, summary endpoints
3. Register route in `server/src/index.ts`
4. Create `src/hooks/useTimeLogs.ts`
5. Create `src/components/TimeLogSection.tsx`
6. Mount `TimeLogSection` in `TicketDetail.tsx`
7. Add time analytics tab to `Reports.tsx` using `/api/time-logs/summary`

**Why first:** Self-contained, no dependency on other v1.5 features. Validates the new pattern before touching the service worker.

### Phase 2 — Backup & Export (backend only + one Settings button)

1. Install `archiver` on backend
2. Create `server/src/routes/backup.ts`
3. Register route in `server/src/index.ts`
4. Add backup section to `Settings.tsx` (button + last-backup note)

**Why second:** Purely backend + one UI button. Zero risk to frontend architecture. Short phase.

### Phase 3 — KB Sidebar Search (frontend only)

1. Refactor `KBLinksSection.tsx` — replace bulk-fetch with debounced API search
2. Add `api.searchKbArticles()` method to `api.ts` if not already parameterized correctly
3. Verify `GET /api/kb/articles?search=&status=published` returns FTS5 results (already works)

**Why third:** No backend changes needed. Isolated to one component file.

### Phase 4 — PWA Push Notifications (SW + backend + frontend)

1. Create `src/sw.ts` with `precacheAndRoute` + push handler
2. Switch `vite.config.ts` to `strategies: 'injectManifest'` — test that offline caching still works
3. Install `web-push` on backend, generate VAPID keys, add to env
4. Add migration for `push_subscriptions` table
5. Create `server/src/routes/push.ts`
6. Create `server/src/lib/pushNotifications.ts`
7. Modify `reminderScheduler.ts` to call `sendPushToAll()`
8. Create `src/hooks/usePushNotifications.ts`
9. Add push opt-in section to `Settings.tsx` (request permission, show status)
10. Register push route in `server/src/index.ts`

**Why last:** Most cross-cutting change (SW, vite config, backend lib, scheduler). Best done after simpler features are proven. Switching the SW strategy has the highest risk of disrupting existing offline behavior — doing it last limits blast radius.

---

## Sources

- Direct analysis of `server/src/db/connection.ts` — migration pattern for new tables (HIGH confidence)
- Direct analysis of `server/src/index.ts` — route registration pattern (HIGH confidence)
- Direct analysis of `server/src/lib/reminderScheduler.ts` — scheduler pattern for push trigger (HIGH confidence)
- Direct analysis of `src/components/KBLinksSection.tsx` — existing KB search pattern to upgrade (HIGH confidence)
- Direct analysis of `vite.config.ts` — current `generateSW` strategy confirmed (HIGH confidence)
- Direct analysis of `server/src/db/schema.sql` — existing table conventions (HIGH confidence)
- [better-sqlite3 backup() API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — confirmed async backup with WAL safety (HIGH confidence)
- [web-push npm](https://github.com/web-push-libs/web-push) — VAPID key generation, subscription schema, sendNotification API (HIGH confidence)
- [vite-plugin-pwa injectManifest](https://vite-pwa-org.netlify.app/guide/) — confirmed `strategies: 'injectManifest'` required for custom push handler (MEDIUM confidence — GitHub issue discussion, not official docs)
- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/js13kGames/Re-engageable_Notifications_Push) — PushSubscription object structure, push event handler (HIGH confidence)

---

*Architecture research for: IT Ticket System v1.5 — Time Tracking, Push Notifications, Backup, KB Search*
*Researched: 2026-04-05*
