# Pitfalls Research

**Domain:** Time tracking, PWA push notifications, SQLite backup/export, KB sidebar search — added to existing Express + SQLite (better-sqlite3) + React PWA IT ticket system.
**Researched:** 2026-04-05
**Confidence:** HIGH for codebase-specific analysis (direct inspection). HIGH for SQLite backup (official docs + better-sqlite3 docs). MEDIUM for push notifications (WebSearch + official MDN + web-push npm). MEDIUM for time tracking schema (WebSearch + domain knowledge).

---

## Critical Pitfalls

### Pitfall 1: Push Notifications Require `injectManifest` Strategy — the Current `generateSW` Config Cannot Handle Custom Push Events

**What goes wrong:**
The current `vite.config.ts` uses `VitePWA({ registerType: 'autoUpdate' })` with the default `generateSW` strategy. Workbox auto-generates the service worker and controls it entirely. The `push` event listener (required to receive and display push notifications) CANNOT be added to a `generateSW`-managed service worker without switching to `injectManifest`. If a developer tries to add a `public/sw.js` alongside the generated service worker, the browser registers two service workers for the same scope, causing conflicts and unpredictable cache behavior.

**Why it happens:**
The existing PWA setup works for offline caching and auto-update, which `generateSW` handles well. Developers extend it for push by adding a custom file, not realising the strategy must change.

**Consequences:**
- Two service worker files registered — one wins, the push handler in the other is never called
- `self.addEventListener('push', ...)` silently does nothing because it is in the ignored worker
- Debugging is opaque: notifications appear to be sent but never arrive

**How to avoid:**
Switch `vite.config.ts` to `strategies: 'injectManifest'` and point `srcDir` + `filename` at a custom service worker file (e.g. `src/sw.ts`). The custom file must call `precacheAndRoute(self.__WB_MANIFEST)` to keep the pre-cache manifest Workbox injects. Push event handling is added to this same file. The existing `workbox.runtimeCaching` config moves into the custom file as `registerRoute(...)` calls.

```typescript
// vite.config.ts
VitePWA({
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
  // ... rest of config
})
```

**Warning signs:**
- `service-worker.js` (auto-generated) and a separate `sw.js` both appear in DevTools > Application > Service Workers
- Push messages sent from backend return 201 but no notification appears in browser
- DevTools console shows: `importScripts` error or two active service worker registrations

**Phase to address:** PWA push notifications phase — before writing any push subscription code, switch strategy first.

---

### Pitfall 2: Push Subscriptions Are Lost on Server Restart if Stored in Memory

**What goes wrong:**
The push subscription object (`endpoint`, `p256dh`, `auth`) returned by `pushManager.subscribe()` on the client must be stored persistently on the server. If it is stored in a module-level variable (e.g., `let subscription = null` in the route handler file), it disappears on every Docker container restart. The client's service worker still holds the subscription, but the server has lost the endpoint — push messages can never be sent until the client re-subscribes. Since the app is single-user and the subscription is only created when the user clicks "Enable notifications", a lost subscription means silently broken push until the user manually re-enables.

**Why it happens:**
In demo tutorials, subscriptions are stored in memory to keep the example simple. This pattern gets copy-pasted into production code.

**Consequences:**
- Notifications stop working after every Docker rebuild or container restart
- No error — the server simply has no endpoint to send to
- The user does not know they need to re-subscribe

**How to avoid:**
Store the subscription in SQLite immediately when received. A simple table is sufficient:

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

On subscribe: upsert by endpoint. On unsubscribe (410 from push service): delete by endpoint. On server startup: read all stored subscriptions and use them for sending.

**Warning signs:**
- Notifications work immediately after enabling but stop after the next `docker restart`
- No `push_subscriptions` table in the database schema
- Push endpoint stored in `process.env` or a module-level variable

**Phase to address:** PWA push notifications phase — storage must be designed before the subscribe endpoint is implemented.

---

### Pitfall 3: VAPID Private Key Regenerated on Every Startup Invalidates All Existing Subscriptions

**What goes wrong:**
VAPID keys (`publicKey` + `privateKey`) must remain constant for the lifetime of the application. A browser subscription is bound to the VAPID public key. If the private key changes (e.g., because it is generated in code at startup with `webpush.generateVAPIDKeys()` instead of being loaded from an environment variable), all existing subscriptions become invalid. The push service returns `410 Gone` for every delivery attempt, and the server silently fails to notify. Users must re-subscribe.

**Why it happens:**
Tutorials generate keys for demonstration. Developers run the generation code in the app startup path instead of a one-time setup script.

**Consequences:**
- All subscriptions invalidated on every server restart
- 410 errors from the push service for every stored endpoint
- Silent failure — no notification, no error shown to the user

**How to avoid:**
Generate VAPID keys once using `npx web-push generate-vapid-keys`. Store them in the `.env` file as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Load them at startup via `process.env`. Never generate them in running application code. Add a startup check that throws if either variable is missing:

```typescript
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  throw new Error('VAPID keys not configured — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env');
}
```

**Warning signs:**
- VAPID keys generated inside `index.ts` or any route file
- `webpush.generateVAPIDKeys()` called anywhere other than a standalone setup script
- Push worked once, then stopped after a rebuild

**Phase to address:** PWA push notifications phase — VAPID key generation must happen before any push code is written.

---

### Pitfall 4: iOS Safari Push Requires the App to Be Installed as a Home Screen PWA

**What goes wrong:**
Web push on iOS (Safari) only works when the user has explicitly "Add to Home Screen". Push permission cannot be requested in a browser tab on iOS — `Notification.requestPermission()` returns "denied" without prompting. If the permission UI is shown unconditionally (on any browser), it will silently fail or error on iOS in a tab context, and the user has no way to fix it without knowing they must install the PWA first.

**Why it happens:**
The developer tests on desktop Chrome/Firefox where push works in any tab, then assumes it works universally. The system is single-user, and the user likely accesses the app from a desktop anyway — but the pitfall is in assuming the code path is safe on all browsers.

**Consequences:**
- "Enable notifications" button shows on iOS Safari tab but the permission request fails silently
- User believes notifications are enabled but they are not
- No error message, just a broken state

**How to avoid:**
Check `window.navigator.standalone` (or the `display-mode: standalone` media query) before showing the notification permission UI. On iOS in a browser tab (non-standalone), show a message instead: "Install this app to your Home Screen to enable notifications." On all other browsers, proceed normally. Additionally check `'Notification' in window` and `'PushManager' in window` as capability guards.

```typescript
const isPWAInstalled = window.matchMedia('(display-mode: standalone)').matches
  || (navigator as any).standalone === true;
const pushSupported = 'PushManager' in window && 'Notification' in window;
```

**Warning signs:**
- No `display-mode` or `standalone` check before calling `Notification.requestPermission()`
- "Enable notifications" is shown on all browsers without a capability guard
- Testing only done on desktop Chrome

**Phase to address:** PWA push notifications phase — browser capability detection before any permission prompt.

---

### Pitfall 5: Permission Denied Is Permanent — Prompting Too Early Blocks Push Forever

**What goes wrong:**
Once a user clicks "Block" on the browser's native notification permission prompt, `Notification.permission` becomes `"denied"`. The browser will never show the prompt again for that origin — `Notification.requestPermission()` returns `"denied"` immediately without displaying any UI. For a single-user system this is especially painful: there is no way to recover programmatically. The user must manually reset the permission in browser settings.

**Why it happens:**
The permission prompt is triggered on page load or on the first visit, before the user understands why notifications are needed. The user dismisses it defensively.

**Consequences:**
- Push notifications permanently disabled for that browser/origin combination
- No programmatic recovery — must guide user to browser settings (`chrome://settings/content/notifications`)
- Single-user system means the admin is the only user: one mis-click breaks the feature entirely

**How to avoid:**
Never call `Notification.requestPermission()` on page load. Show a custom in-app prompt first (a card or banner explaining what notifications are for). Only trigger the native browser permission dialog after the user explicitly clicks "Enable push notifications." Check current permission state before prompting:

```typescript
if (Notification.permission === 'denied') {
  // Show "Notifications are blocked. Reset in browser settings." message
  // Link to settings if possible
  return;
}
if (Notification.permission === 'default') {
  // Show custom pre-prompt UI
}
```

**Warning signs:**
- `Notification.requestPermission()` called in a `useEffect` on component mount
- No check of `Notification.permission` before requesting
- No "you've blocked notifications" recovery message

**Phase to address:** PWA push notifications phase — UX flow designed before implementation.

---

### Pitfall 6: SQLite Backup via `cp` or `fs.copyFile` Is Not Transactionally Safe in WAL Mode

**What goes wrong:**
Copying the SQLite database file (`database.sqlite`) with `fs.copyFile()` while the server is running produces a corrupt or inconsistent backup. In WAL mode (which this codebase uses: `db.pragma('journal_mode = WAL')`), writes go to `database.sqlite-wal` first. A raw file copy may capture the main file in one state and miss the WAL file changes, or capture both files in a state where the WAL has been partially checkpointed — producing a backup that is internally inconsistent.

**Why it happens:**
`fs.copyFile` is the obvious first approach. SQLite WAL mode makes this dangerous in a way that is not immediately obvious — the backup may appear to work (file is created, size looks right) but can fail to open or return corrupted data on restore.

**Consequences:**
- Backup appears successful but is corrupt
- Restore from backup produces SQLite error: "file is not a database" or "disk image is malformed"
- Data loss on restore attempt after production incident

**How to avoid:**
Use `better-sqlite3`'s built-in `.backup()` method, which wraps the SQLite Online Backup API. This is transactionally safe with a live WAL-mode database:

```typescript
await db.backup('/path/to/backup.sqlite');
```

Alternatively, use `VACUUM INTO '/path/to/backup.sqlite'` which creates a compact, consistent snapshot from a single transaction. For the zip export feature, use `.backup()` to write a temp file, then add the temp file to the zip archive, then delete the temp file.

**Warning signs:**
- Backup code uses `fs.copyFile`, `fs.createReadStream`, or shell `cp` on the `.sqlite` file
- No use of `db.backup()` or `VACUUM INTO` in the backup route
- WAL mode is enabled (it is in this codebase) but backup does not use the backup API

**Phase to address:** Backup & export phase — must be the first design decision made for that feature.

---

### Pitfall 7: Zip Archive Built In-Memory for Large Attachment Directories Causes Node OOM

**What goes wrong:**
The backup feature needs to zip the SQLite database file plus all uploaded attachments (stored in `data/uploads/`). If the archiver builds the entire zip in memory before streaming it to the response, and if the uploads directory contains many large files (images, documents), Node.js runs out of heap memory. The `archiver` npm library supports streaming but requires explicit use of `pipe()` to the Express response — if `archive.finalize()` is called and then `archive.toBuffer()` is awaited, the entire zip is buffered.

**Why it happens:**
Tutorial code for `archiver` shows `archive.pipe(outputStream)` but developers targeting a download response sometimes buffer first to set `Content-Length` header, accidentally loading the entire archive into memory.

**Consequences:**
- `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`
- Server process crashes inside Docker container; Portainer shows the container restarting
- The single backend instance serves all routes — a crash affects the entire system

**How to avoid:**
Stream the archive directly to the Express response without buffering. Skip `Content-Length` (use `Transfer-Encoding: chunked` instead):

```typescript
res.setHeader('Content-Type', 'application/zip');
res.setHeader('Content-Disposition', `attachment; filename="backup-${Date.now()}.zip"`);
const archive = archiver('zip', { zlib: { level: 6 } });
archive.pipe(res);
archive.file('/path/to/backup.sqlite', { name: 'database.sqlite' });
archive.directory('/path/to/uploads/', 'uploads');
archive.finalize();
```

Never call `archive.toBuffer()` or accumulate the output before sending.

**Warning signs:**
- `archive.toBuffer()` or similar buffering methods in the backup route
- Memory usage spikes to several GB when downloading backup
- `Content-Length` header is set on the backup response (requires full buffer to compute)

**Phase to address:** Backup & export phase.

---

### Pitfall 8: Time Tracking Timer State Not Closed When Ticket Is Resolved or Closed

**What goes wrong:**
A time tracking entry stores a `started_at` timestamp. When the user forgets to stop the timer and closes or resolves the ticket, the entry remains open (`stopped_at IS NULL`). If the reports aggregate `SUM(COALESCE(stopped_at, CURRENT_TIMESTAMP) - started_at)` to estimate running timers, a session that was started months ago and never stopped inflates the time total by an enormous amount. This produces reports showing "2,340 hours on one ticket."

**Why it happens:**
The "stop timer on ticket close" side effect is easy to forget when closing tickets via API calls. The ticket close endpoint does not know about time tracking; the time tracking module does not know about ticket state changes.

**Consequences:**
- Wildly inflated time totals in reports
- Single report query returns incorrect aggregates that look plausible but aren't
- No error — the data is valid SQL; only the business logic is wrong

**How to avoid:**
In the ticket update endpoint (where status changes to `resolved` or `closed`), add logic to close any open time tracking sessions for that ticket:

```typescript
// When ticket status changes to resolved or closed:
db.prepare(`
  UPDATE time_entries
  SET stopped_at = CURRENT_TIMESTAMP
  WHERE ticket_id = ? AND stopped_at IS NULL
`).run(ticketId);
```

Make this part of the same database transaction as the ticket status update.

**Warning signs:**
- Ticket close/resolve endpoint does not reference `time_entries` table
- Reports show implausible time values (hundreds of hours on a single ticket)
- `stopped_at IS NULL` rows exist in `time_entries` for closed tickets

**Phase to address:** Time tracking phase — handle in the ticket update route, not just the time tracking route.

---

### Pitfall 9: Time Tracking Report Aggregation Double-Counts Open Sessions

**What goes wrong:**
A common pattern for reporting "total time spent" on a ticket is:

```sql
SELECT SUM(
  CAST((julianday(COALESCE(stopped_at, datetime('now'))) - julianday(started_at)) * 86400 AS INTEGER)
) AS total_seconds
FROM time_entries WHERE ticket_id = ?
```

This correctly handles both completed and open sessions. However, if the same ticket has two open sessions (e.g., the user navigated away while one was running and started another), the COALESCE substitution counts both open sessions from their respective start times, double-counting the overlapping time. Reported total appears larger than actual time spent.

**Why it happens:**
The UI allows starting a timer on a ticket. If the user opens the ticket on two browser tabs (or if the "start timer" button fires twice due to double-click), two open sessions are created. The backend does not enforce a "one open session per ticket" constraint.

**Consequences:**
- Time report shows more time than was actually spent
- No error or warning — the SQL is valid

**How to avoid:**
Enforce at the database level: only one open session per ticket is allowed at a time. Before inserting a new time entry, close any existing open session for that ticket, OR add a partial unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_open
ON time_entries(ticket_id)
WHERE stopped_at IS NULL;
```

This makes it a constraint error to have two open sessions for the same ticket — the backend returns a 409 and the client handles it gracefully.

**Warning signs:**
- No unique constraint on `(ticket_id) WHERE stopped_at IS NULL`
- "Start timer" button has no loading state, allowing double-clicks
- Report totals are inconsistent when checked manually

**Phase to address:** Time tracking phase — schema design before building the start/stop API.

---

## Moderate Pitfalls

### Pitfall 10: KB Sidebar Search in Ticket Detail Re-fetches on Every Keystroke Without Debounce

**What goes wrong:**
The existing KB search on the Knowledge Base page (`/api/kb/articles?search=`) uses FTS5. Adding the same search to a sidebar panel in the ticket detail view (`TicketDetail.tsx`) requires a debounced input. Without debounce, every keystroke fires a separate API call. With fast typing, multiple requests are in-flight simultaneously; the older responses can arrive after newer ones, causing the displayed results to flicker between stale and current results (classic race condition).

**Why it happens:**
The KB search is already implemented and working. Adding it to the sidebar feels like a simple `<input onChange=...>` that calls `fetch`. The debounce step is skipped because it "works" in testing.

**Consequences:**
- API called on every keystroke (10+ calls for a short search term)
- Results flicker — a 3-letter query result briefly replaces a 5-letter query result
- FTS5 query for each keystroke adds minor but real DB load for every key press

**How to avoid:**
Use the existing `useCommandPaletteSearch` hook pattern as a reference — it already has debounce wired up. For the KB sidebar, add a `useKBSearch` hook with 300ms debounce and React Query caching. Keep the query key stable so repeated identical searches hit the cache.

**Phase to address:** KB sidebar search phase.

---

### Pitfall 11: KB Article Link Created From Sidebar Does Not Update the "Linked Articles" Section Without a Refetch

**What goes wrong:**
The ticket detail view has a "linked articles" panel (or will, after the KB sidebar feature). When the user selects a KB article from the sidebar search and clicks "link to ticket", the backend creates the association. But the ticket detail's linked articles section is controlled by a separate React Query cache entry — it does not automatically refetch after the sidebar mutation succeeds. The user sees the sidebar confirm the link, but the linked articles panel still shows the old list until a page refresh.

**Why it happens:**
Two separate queries are on the same page. Mutations in one part of the component tree need to invalidate the cache entry used by another part. Without explicit `queryClient.invalidateQueries(...)` after the link mutation, the stale data persists.

**Consequences:**
- UX appears broken: "I just linked this article but it's not showing"
- User refreshes the page, sees it correctly — assumes it was a transient bug

**How to avoid:**
After a successful link mutation, call `queryClient.invalidateQueries({ queryKey: ['ticket', ticketId, 'kb-links'] })` (or whatever key the linked articles panel uses). Pattern is already established in the codebase via `useTicketLinks.ts`.

**Phase to address:** KB sidebar search phase — check existing invalidation patterns before building.

---

### Pitfall 12: Backup Route Has No Auth Guard, Exposing Database Download to Unauthenticated Requests

**What goes wrong:**
A new `/api/backup/download` route that streams the SQLite database and uploads as a zip is a sensitive endpoint. If the `authenticate` middleware is not applied (easy to miss when adding a new route file and forgetting to import + apply middleware), the endpoint is publicly accessible. Anyone who knows the URL can download the entire database, including all tickets, contacts, KB articles, and JWT secrets.

**Why it happens:**
New route files are wired up in `server/src/index.ts`. The pattern requires importing the route file and calling `app.use('/api/backup', backupRoutes)`. The `authenticate` middleware must be applied inside the route file or at registration. If it is missing from the route file and the developer does not notice, the endpoint is open.

**Consequences:**
- Full database download accessible without authentication
- Contacts, tickets, KB content, and (if stored) SMTP credentials leaked

**How to avoid:**
Apply `authenticate` as the first middleware on all backup routes. Use the existing pattern from `routes/tickets.ts` — `router.get('/', authenticate, handler)`. Add a note in the route file header: `// ALL routes in this file require authentication`.

Also: never store VAPID private key, SMTP password, or JWT secret in the database — keep them in environment variables only.

**Warning signs:**
- `curl http://localhost:3001/api/backup/download` returns a zip without requiring a JWT token
- Route file imports `Router` but not `authenticate`
- No `authenticate` in the router method calls

**Phase to address:** Backup & export phase — auth must be verified before the endpoint is wired.

---

### Pitfall 13: Push Notification Fired for Already-Dismissed Reminders

**What goes wrong:**
The reminder scheduler already runs every minute via node-cron, checking `ticket_reminders` for entries where `sent = 0 AND reminder_time <= NOW()`. It marks them `sent = 1` and sends an email. Adding push notifications to the same scheduler path is straightforward — but if the push send fails (subscriber expired, 410 response) and the `sent = 1` update is not committed transactionally with the push attempt, the reminder can fire again on the next cron tick. Alternatively, if the email sends but push throws an exception that is uncaught, subsequent cron runs skip the `sent = 1` update and send both email and push repeatedly.

**Why it happens:**
Error handling in cron schedulers is often incomplete. A thrown exception inside the scheduler body stops the current cron tick but does not prevent the next one from seeing the same unprocessed row.

**Consequences:**
- User receives multiple email + push notifications for the same reminder
- Annoying in practice since this is a single-user system and the user is also the developer

**How to avoid:**
Mark `sent = 1` before attempting to send, inside a transaction. If the send fails, log the error but do not revert — accept the "at most once" delivery semantics rather than "at least once" spam:

```typescript
const markSent = db.prepare('UPDATE ticket_reminders SET sent = 1, sent_at = CURRENT_TIMESTAMP WHERE id = ?');
// Mark first, then attempt delivery
markSent.run(reminder.id);
try {
  await sendPushNotification(reminder);
} catch (err) {
  console.error('Push failed for reminder', reminder.id, err);
  // Already marked sent — will not retry
}
```

**Phase to address:** PWA push notifications phase — when integrating push into the existing reminder scheduler.

---

### Pitfall 14: Time Entry `started_at` / `stopped_at` Stored as TEXT Causes Subtle Sort and Duration Bugs

**What goes wrong:**
The existing schema stores all timestamps as `TEXT DEFAULT CURRENT_TIMESTAMP` (ISO 8601 strings, e.g. `"2026-04-05T10:23:00.000Z"`). SQLite's `julianday()` and `strftime()` functions work correctly with ISO 8601 strings. However, if timestamps are stored with inconsistent timezone offset strings (some with `+00:00`, some with `Z`, some without timezone), duration calculations produce wrong results. `julianday('2026-04-05T10:23:00Z')` differs from `julianday('2026-04-05T10:23:00')` by 0 seconds, but `julianday('2026-04-05T12:23:00+02:00')` introduces an offset.

**Why it happens:**
The frontend sends timestamps from `new Date().toISOString()` (always UTC `Z` format). The backend may use `CURRENT_TIMESTAMP` (which is UTC without `Z`). If both sources write to `time_entries`, the mix of formats can cause 0.something second errors or hour-level errors in duration reports.

**How to avoid:**
Use `datetime('now')` on the backend for all server-written timestamps (consistent with existing schema). For client-sent timestamps (e.g. "timer started at this moment on the client"), always convert to UTC and strip timezone offset before storing: `new Date(clientTimestamp).toISOString()`.

Audit: the existing schema uses `TEXT DEFAULT CURRENT_TIMESTAMP` everywhere. Match this convention for `time_entries` — do not use `REAL` or `INTEGER` epoch seconds, which would be a new convention in an otherwise consistent codebase.

**Phase to address:** Time tracking phase — schema review before creating the migration.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store push subscriptions in memory | Simpler code, no DB migration | Lost on every restart, silently broken push | Never |
| Generate VAPID keys in startup code | No manual setup step | All subscriptions invalidated on every restart | Never |
| Skip `injectManifest` strategy change | Faster to implement push | Push event listener never fires; broken feature | Never |
| Use `fs.copyFile` for SQLite backup | Simple one-liner | Corrupt backup in WAL mode, no warning | Never |
| No "close open timer on ticket close" side effect | Simpler close endpoint | Inflated time reports with no data to fix them | Never |
| Skip debounce on KB sidebar search | Faster to code | Race conditions in result display, extra DB load | Never for live search |
| Buffer entire zip in memory for backup | Simpler streaming code | OOM crash on large upload directories | Never in Docker with limited heap |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `vite-plugin-pwa` + push events | Adding push listener to `generateSW` worker or a separate `public/sw.js` | Switch to `injectManifest` strategy; push listener lives in the single injected SW file |
| `web-push` npm + VAPID | Calling `generateVAPIDKeys()` in app startup | Generate once with `npx web-push generate-vapid-keys`, store in `.env`, load via `process.env` |
| Push + existing reminder scheduler | Sending push in cron without error boundary | Mark `sent=1` before sending; catch push errors without reverting sent flag |
| `better-sqlite3` `.backup()` + archiver | Backing up live `.sqlite` file directly into zip | Use `db.backup(tmpFile)` to get a safe snapshot, then add tmpFile to archive, then delete tmpFile |
| archiver + Express response | Buffering archive before sending (`toBuffer()`) | Pipe archive directly to `res` stream; omit `Content-Length` |
| KB sidebar search + React Query | Linking KB article does not refresh linked articles panel | Call `queryClient.invalidateQueries` on the ticket's KB links query key after link mutation |
| Time tracking + ticket status update | Timer left open when ticket closes | Add `UPDATE time_entries SET stopped_at = NOW() WHERE ticket_id = ? AND stopped_at IS NULL` inside ticket close transaction |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| KB sidebar search fires on every keystroke | 10+ API calls per search, flickering results | 300ms debounce on search input | Immediately in fast typing |
| Backup zip buffered in memory | Memory spike, possible OOM crash | Stream archiver directly to Express response | When uploads directory exceeds ~500 MB |
| Time report aggregates all entries without index | Slow report query as entry count grows | Index `time_entries(ticket_id)` and `time_entries(started_at)` | Thousands of entries |
| Push to stale subscriptions (410) not cleaned up | Growing table of dead endpoints, failed pushes logged on every notification | Handle 410 response: delete subscription from DB | After browser reinstall, PWA uninstall |
| SQLite backup blocks writes | `db.backup()` can pause writes briefly on a hot database | Run backup during low-activity periods or use async backup API | During heavy use (unlikely for single-user) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Backup endpoint without `authenticate` middleware | Full DB download by anyone with the URL | Apply `authenticate` as first middleware on all backup routes |
| VAPID private key in source code or Docker image | Key can be extracted from image; all subscriptions can be spoofed | Store in `.env` only, never commit, add to `.gitignore` |
| Push payload contains full ticket content | Sensitive ticket data in notification payload (visible in notification center) | Send only ticket ID + title in push payload; load full content when user taps notification |
| Backup zip includes `.env` file | Credentials in backup download | Explicitly include only `database.sqlite` and `uploads/` in archive; never include the server source directory |
| Time entries accessible without auth | Time data leaked | Apply `authenticate` to all time tracking routes |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Push permission requested on page load | User clicks "Block" defensively; notifications permanently disabled | Show custom pre-prompt explaining what notifications do; only call `requestPermission()` on explicit user action |
| No "notifications are blocked" recovery message | User thinks they enabled notifications but nothing happens | Check `Notification.permission === 'denied'` and show a message with browser settings link |
| KB sidebar search replaces ticket detail content | Confusing context switch — user loses place in ticket | Sidebar panel floats alongside ticket content; does not replace it |
| Timer running indicator not visible | User forgets timer is running; it runs for days | Show persistent "timer running" badge on ticket list row and ticket detail header |
| Backup download has no progress indicator | Large zip takes time; user thinks nothing happened | Show "Preparing backup..." loading state; disable button while in progress |
| Time entry manual input without bounds checking | User enters "99999 hours" manually, corrupting reports | Validate duration: max 24h per entry; negative durations rejected |

---

## "Looks Done But Isn't" Checklist

- [ ] **Push — strategy:** `vite.config.ts` uses `strategies: 'injectManifest'`, not `generateSW`, and a custom SW file exists
- [ ] **Push — VAPID:** Keys loaded from `process.env`, not generated in code; startup throws if missing
- [ ] **Push — subscriptions:** `push_subscriptions` table exists in DB schema; subscriptions survive container restart
- [ ] **Push — 410 cleanup:** Push route handles 410/404 responses from push service by deleting the stale subscription
- [ ] **Push — iOS guard:** Permission UI checks `Notification.permission !== 'denied'` and `'PushManager' in window` before showing
- [ ] **Push — permission timing:** `Notification.requestPermission()` only called after explicit user action, not on mount
- [ ] **Backup — method:** Backup uses `db.backup(tmpFile)` or `VACUUM INTO`, not `fs.copyFile`
- [ ] **Backup — streaming:** Zip archive is piped directly to `res`; no `.toBuffer()` call
- [ ] **Backup — auth:** `GET /api/backup/download` returns 401 without a valid JWT token
- [ ] **Backup — contents:** Zip includes only `database.sqlite` + `uploads/`; no `.env`, no source files
- [ ] **Time tracking — open timer:** Closing/resolving a ticket closes any open time entries for that ticket
- [ ] **Time tracking — constraint:** DB has a partial unique index preventing two open sessions per ticket
- [ ] **Time tracking — reports:** No row with `stopped_at IS NULL` on a closed ticket inflates report totals
- [ ] **KB sidebar — debounce:** Search input has 300ms debounce before firing API call
- [ ] **KB sidebar — invalidation:** Linking an article from the sidebar triggers refetch of the linked articles panel

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Push subscriptions lost (in-memory) | LOW | Add `push_subscriptions` table; user re-enables notifications once |
| VAPID keys changed, all subscriptions invalid | LOW | Regenerate keys into `.env`; all users re-subscribe (single user: one re-enable click) |
| Corrupt backup from `fs.copyFile` | HIGH | No recovery from the backup; migrate to `db.backup()` immediately; rely on Docker volume as primary data store |
| OOM crash during backup streaming | LOW | Switch to streaming pipe; no data loss (backup route only reads) |
| Inflated time totals from open sessions on closed tickets | MEDIUM | SQL cleanup: `UPDATE time_entries SET stopped_at = closed_at FROM tickets WHERE ticket_id = tickets.id AND stopped_at IS NULL AND tickets.status IN ('closed','resolved')`; add the side effect going forward |
| Push notifications spam from cron re-firing | LOW | Mark `sent = 1` before send; existing duplicate rows: manually update `sent = 1` via DB |
| KB sidebar race condition (stale results) | LOW | Add debounce + React Query; stale results self-correct on next stable input |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Wrong PWA strategy (`generateSW` vs `injectManifest`) | PWA push notifications — first task | DevTools > Application > Service Workers shows one registered SW |
| Push subscription not persisted | PWA push notifications — subscription storage | `push_subscriptions` table exists; restart container, verify push still works |
| VAPID key regeneration | PWA push notifications — VAPID setup | `process.env.VAPID_PUBLIC_KEY` loaded; no `generateVAPIDKeys()` in app code |
| iOS Safari push without Home Screen install | PWA push notifications — capability detection | On iOS Safari tab: "Install to Home Screen" message shown instead of permission prompt |
| Notification permission denied permanently | PWA push notifications — UX flow | No `requestPermission()` on page load; custom pre-prompt shown first |
| Corrupt backup via `fs.copyFile` | Backup & export — backup method selection | Restore the backup into a fresh DB; verify row counts match original |
| OOM crash from buffered zip | Backup & export — streaming implementation | Download backup with 50 MB uploads; memory usage stays flat |
| Unauthenticated backup endpoint | Backup & export — auth guard | `curl` without token returns 401 |
| Open timer on closed ticket | Time tracking — status change side effect | Close a ticket with running timer; verify `stopped_at` is set on the entry |
| Overlapping open sessions | Time tracking — schema design | Attempting to start a second timer on same ticket returns error |
| KB search race condition | KB sidebar search — debounce implementation | Type quickly; only results for the final input state are shown |
| Stale linked articles after sidebar link | KB sidebar search — cache invalidation | Link article from sidebar; linked articles panel updates without page refresh |
| Push spam from cron re-fire | PWA push notifications — scheduler integration | Trigger reminder twice; only one notification received |

---

## Sources

- [Demystifying Web Push Notifications](https://pqvst.com/2023/11/21/web-push-notifications/) — VAPID requirements, service worker debugging, subscription persistence (MEDIUM confidence)
- [Push Notifications in Safari iOS Progressive Web Apps](https://iwritecodesometimes.net/2024/04/23/push-notifications-in-safari-progressive-web-apps/) — iOS Home Screen requirement (MEDIUM confidence)
- [vite-plugin-pwa: Advanced (injectManifest)](https://vite-pwa-org.netlify.app/guide/inject-manifest) — strategy switch requirement (HIGH confidence)
- [web-push npm](https://github.com/web-push-libs/web-push) — VAPID setup, subscription object structure (HIGH confidence)
- [Notification.requestPermission() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static) — permission state permanence (HIGH confidence)
- [SQLite Backup API](https://sqlite.org/backup.html) — online backup safety with WAL mode (HIGH confidence)
- [Backup strategies for SQLite in production](https://oldmoe.blog/2024/04/30/backup-strategies-for-sqlite-in-production/) — VACUUM INTO vs cp pitfalls (MEDIUM confidence)
- [better-sqlite3 `.backup()`](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise) — async backup API (HIGH confidence — official docs)
- [archiver memory issues](https://github.com/archiverjs/node-archiver/issues/422) — memory usage with large file sets (MEDIUM confidence)
- [Web Push Store subscription in backend](https://pushpad.xyz/blog/web-push-notifications-store-the-subscription-in-the-backend-database) — subscription persistence pattern (MEDIUM confidence)
- Codebase inspection: `vite.config.ts` (current `generateSW` strategy), `server/src/db/connection.ts` (WAL mode enabled), `server/src/lib/reminderScheduler.ts` (existing scheduler pattern), `server/src/routes/kb.ts` (FTS5 search implementation), `server/src/db/schema.sql` (ticket table structure)

---
*Pitfalls research for: Time tracking, PWA push notifications, backup/export, KB sidebar search — v1.5 features on existing Express + SQLite + React system*
*Researched: 2026-04-05*
