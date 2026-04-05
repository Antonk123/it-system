# Project Research Summary

**Project:** IT-Ticket System — v1.5 Productivity & Insights
**Domain:** Single-user internal IT helpdesk — time tracking, PWA push notifications, backup/export, KB sidebar search
**Researched:** 2026-04-05
**Confidence:** HIGH

---

## Executive Summary

IT-Ticket v1.5 extends a mature, stable React + Express + SQLite + PWA stack with four distinct productivity features. The existing codebase provides strong foundations: FTS5 KB search, a node-cron reminder scheduler, an active PWA service worker, and a `better-sqlite3` connection with WAL mode already enabled. Each v1.5 feature slots cleanly into this foundation with minimal new dependencies — only `web-push` and `archiver` need to be added server-side; all frontend capabilities are satisfied by the existing stack.

The recommended build order — time tracking first, then backup, then KB sidebar, then push notifications — is a risk-ranking strategy. Time tracking and backup are self-contained and validate the new patterns (schema migrations, route registration, React Query hooks) without touching the service worker. KB sidebar is purely frontend and can be built in isolation. Push notifications are deliberately last because they require the most cross-cutting change: switching `vite-plugin-pwa` from `generateSW` to `injectManifest` strategy, which carries the highest risk of disrupting existing offline caching if done carelessly.

The single highest-risk item across all research is the PWA service worker strategy switch. If `vite.config.ts` is not switched to `injectManifest` before any push code is written, the push event listener will never fire — silently. Additionally, VAPID keys must be generated once and stored in environment variables before any push code lands; keys generated at runtime invalidate all subscriptions on every server restart. These two items are non-negotiable prerequisites for the push phase and must be treated as phase preconditions, not implementation steps.

---

## Key Findings

### Recommended Stack

The existing stack requires only two new runtime server packages to cover all v1.5 features. No frontend packages are needed — all UI components, the date library, and PWA service worker infrastructure are already installed and verified in `package.json`.

**New dependencies (server only):**
- `web-push ^3.6.7`: VAPID key generation, payload encryption, push delivery — canonical RFC-compliant Node.js library; no cloud intermediary required; stable protocol (RFC 8030/8291/8292)
- `archiver ^7.0.1`: Streaming ZIP archive piped directly to Express response; avoids memory buffering; supports SQLite snapshot + uploads directory in one archive
- `@types/web-push ^3.6.4` + `@types/archiver ^6.0.3`: TypeScript types (devDependencies only)

**Service worker change (not an npm install):** `vite.config.ts` must switch from default `generateSW` to `strategies: 'injectManifest'` with a custom `src/sw.ts`. This is mandatory for push — `generateSW` does not support custom event listeners.

**New DB tables:** `ticket_time_logs` (time entries per ticket with start/stop timestamps) and `push_subscriptions` (browser push subscription endpoint + keys). Both follow existing schema conventions (ISO-8601 TEXT timestamps, integer PKs, CASCADE deletes on ticket deletion).

See `.planning/research/STACK.md` for full version compatibility matrix, DB schema DDL, and installation commands.

### Expected Features

**Must have (table stakes) — v1.5 core scope:**
- Manual time entry on ticket (log hours + optional note)
- Total time summary on ticket detail (client-side sum)
- Time log list with delete on ticket detail
- Time analytics tab in Reports (GROUP BY category/week, recharts bar chart)
- Browser push notification delivery via VAPID (OS notification center, desktop Chrome/Firefox/Edge)
- Notification permission opt-in UI in Settings (user-gesture triggered — never on page load)
- Reminder cron dispatches push notification (extends existing `checkReminders` scheduler)
- Backup download button (streams DB + uploads as ZIP from Settings page)
- Backup includes file attachments from `/app/data/uploads/`
- KB search panel in ticket detail (collapsible sidebar, FTS5, existing API reused)
- Link KB article to ticket from sidebar (existing `POST /api/tickets/:id/kb-links` reused)

**Should have (v1.5 stretch or immediate follow-on):**
- Timer start/stop widget on ticket (client-side; persists `started_at` to DB on Start, writes full entry on Stop)
- Aging ticket push notifications (extends existing cron — alerts on tickets with no update in N days)
- Notification click navigates directly to relevant ticket URL (SW `notificationclick` handler)
- KB sidebar shows already-linked articles above search box (existing GET endpoint)
- Quick time entry chip buttons (15m, 30m, 1h, 2h — pure frontend)

**Defer (out of scope — v2+ or never):**
- Restore from backup via UI — too risky with a live SQLite connection; document manual procedure instead
- Billable/non-billable time — no client billing use case in single-user IT tool
- Third-party push services (Firebase FCM, OneSignal) — VAPID self-hosted is sufficient
- Live timer state persisted to backend — client-side timer with DB write on start is sufficient
- Scheduled automatic cloud backup — VM-level snapshots cover disaster recovery

See `.planning/research/FEATURES.md` for full dependency tree, prioritization matrix, and anti-features.

### Architecture Approach

The architecture follows an additive pattern — new features extend the existing Express/SQLite/React foundation without replacing anything. Each feature maps to a small cluster of new files (one route file, one hook, one component) plus targeted modifications to existing files (scheduler, ticket detail page, settings page, vite config). The most significant structural change is the service worker strategy switch, which affects the entire PWA offline experience and must be validated in isolation before push features layer on top.

**Major new components:**
1. `server/src/routes/time-logs.ts` — CRUD for time entries; start/stop timer; summary aggregation for reports
2. `server/src/routes/backup.ts` — streams ZIP of DB snapshot + uploads; `authenticate` middleware required
3. `server/src/routes/push.ts` + `server/src/lib/pushNotifications.ts` — VAPID push subscription management and `sendPushToAll()` helper
4. `src/components/TimeLogSection.tsx` — timer widget + time log list in ticket detail
5. `src/components/KBSidebarSearch.tsx` — debounced FTS5 search panel in ticket detail (refactors existing `KBLinksSection`)
6. `src/sw.ts` — custom service worker replacing Workbox auto-generated SW; handles precache + push events

**Key patterns to follow:**
- Time tracking uses a log-entry model: `started_at` persisted immediately on Start; `stopped_at` written on Stop; `NULL stopped_at` = running. A partial unique index `ON ticket_time_logs(ticket_id) WHERE stopped_at IS NULL` enforces one active timer per ticket.
- Push subscriptions are upserted by `endpoint`; 410 responses from the push service trigger automatic deletion.
- Backup uses `db.backup(tmpFile)` (SQLite Online Backup API) to produce a WAL-consistent snapshot, then streams via `archiver` — never a direct `fs.copyFile` of the live DB file.
- KB sidebar upgrades the existing `KBLinksSection` from bulk-fetch-then-filter to debounced API-driven FTS5 search with a 300ms debounce.

See `.planning/research/ARCHITECTURE.md` for full component inventory, data flow diagrams, code sketches, and anti-patterns.

### Critical Pitfalls

1. **`generateSW` cannot handle push events — service worker strategy switch is mandatory.** Switch `vite.config.ts` to `strategies: 'injectManifest'` as the very first task of the push phase. Create `src/sw.ts` with `precacheAndRoute(self.__WB_MANIFEST)` + push handlers. Verify offline caching still works before adding any push subscription code. Doing this last (after push code) means two service workers fighting for scope.

2. **VAPID keys generated at runtime invalidate all subscriptions on every restart.** Generate once with `npx web-push generate-vapid-keys`; store in `.env` as `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. Add a startup guard that throws if either variable is missing. Never call `generateVAPIDKeys()` in application code.

3. **Push subscriptions stored in memory are lost on container restart.** All `PushSubscription` objects must be upserted into the `push_subscriptions` SQLite table immediately on receipt. Upsert by endpoint; delete on 410 from push service.

4. **`fs.copyFile` on a live WAL-mode SQLite database produces corrupt backups.** Always use `db.backup(tmpPath)` (better-sqlite3's built-in Online Backup API). The live `.sqlite` file may be mid-write at copy time; WAL journal state is not captured.

5. **Open timer left running when a ticket is closed inflates time reports.** The ticket update endpoint (status → resolved/closed) must close open time entries for that ticket inside the same transaction: `UPDATE time_entries SET stopped_at = CURRENT_TIMESTAMP WHERE ticket_id = ? AND stopped_at IS NULL`.

6. **Notification permission prompt on page load gets permanently blocked.** Never call `Notification.requestPermission()` on mount. Show a custom in-app pre-prompt in Settings first. Check `Notification.permission` state; if `'denied'`, show recovery instructions (link to browser settings).

7. **Backup route without auth guard exposes full DB download publicly.** Apply `authenticate` middleware as the first handler on all backup routes. Verify with unauthenticated `curl` (expect 401) before marking the phase complete.

See `.planning/research/PITFALLS.md` for full checklist, recovery strategies, and phase-to-pitfall mapping.

---

## Implications for Roadmap

Based on combined research, the recommended phase structure follows dependency-first, risk-last ordering. Each phase is independently deployable and testable in production.

### Phase 1: Time Tracking

**Rationale:** Fully self-contained — new DB table, new API routes, new React components. No service worker changes, no new environment variables, no external libraries required. Validates the schema migration pattern, React Query hook pattern, and ticket detail extension before any riskier changes.

**Delivers:** Manual time entry form, start/stop timer widget, time log list with delete, total time summary on ticket detail, time analytics tab in Reports with recharts bar chart.

**Features addressed:** Manual time entry (P1), total time summary (P1), time log list + delete (P1), time reports tab (P2), timer start/stop widget (P2), quick chip buttons (P3).

**Pitfalls to avoid:**
- Partial unique index on `(ticket_id) WHERE stopped_at IS NULL` — prevents double-timer and corrupted aggregates
- `stopped_at` auto-closed on ticket resolve/close — prevents inflated report totals
- All timestamps use `datetime('now')` convention — consistent with existing schema
- Time entry bounds validation (max 24h per entry) — prevents garbage data

**Research flag:** Standard patterns — no deeper research needed.

---

### Phase 2: Backup & Export

**Rationale:** Purely backend (one new route file) + one Settings UI button. Zero frontend architecture risk. Short phase delivering high user value (data ownership) with minimal blast radius.

**Delivers:** `GET /api/backup/download` streaming ZIP (DB snapshot + uploads), Settings page backup button with loading state and progress indication.

**Features addressed:** Backup download button (P1), backup includes attachments (P1).

**Pitfalls to avoid:**
- `db.backup(tmpFile)` not `fs.copyFile` — WAL-safe snapshot mandatory
- `archiver.pipe(res)` not `archive.toBuffer()` — streaming to avoid OOM
- `authenticate` middleware on all backup routes — verify with unauthenticated curl
- ZIP contains only `database.sqlite` + `uploads/` — never include `.env` or source files

**Research flag:** Standard patterns — no deeper research needed.

---

### Phase 3: KB Sidebar Search

**Rationale:** Purely frontend change to a single component (`KBLinksSection.tsx` refactor to API-driven search). Reuses three existing backend APIs with zero backend changes. Can be built and shipped in isolation with no risk to server, scheduler, or service worker.

**Delivers:** Debounced FTS5 search panel in ticket detail sidebar, linked articles section above search, "Link article" action from results, idle state showing pre-linked articles.

**Features addressed:** KB search in ticket detail (P1), link KB article from sidebar (P1), KB sidebar shows linked articles (P1).

**Pitfalls to avoid:**
- 300ms debounce before firing API call — prevents keystroke-per-request and race condition in results
- `queryClient.invalidateQueries` after link mutation — linked articles panel updates without page refresh
- Show `title + excerpt` only (not full Tiptap render) — prevents narrow-sidebar readability issues
- Only call API when query length > 0 — avoids loading entire KB on every open

**Research flag:** Standard patterns — no deeper research needed.

---

### Phase 4: PWA Push Notifications

**Rationale:** Most cross-cutting change in v1.5. Requires modifying `vite.config.ts` (service worker strategy), creating a custom `src/sw.ts`, installing a new backend library, adding environment variables, a new DB table, and modifying the existing reminder scheduler. Done last so all simpler features are stable in production before the PWA infrastructure is touched.

**Delivers:** VAPID-based push notifications to OS notification center (desktop Chrome/Firefox/Edge; iOS requires PWA home screen install); push fires from existing reminder scheduler; push opt-in/opt-out in Settings; aging-ticket notifications (extends same cron).

**Features addressed:** Push notification delivery (P1), permission opt-in UI (P1), reminder fires push (P1), notification click navigates to ticket (P2), aging ticket alerts (P2).

**Pitfalls to avoid (treat as phase preconditions — do before writing any push code):**
- Switch `vite.config.ts` to `injectManifest` FIRST; verify offline caching regression before adding push handler
- Generate VAPID keys once via CLI; store in `.env`; add startup guard for missing keys
- Upsert `push_subscriptions` to SQLite immediately on subscribe; handle 410 by deleting stale row
- iOS capability guard — show "Install to Home Screen" message instead of permission prompt in a browser tab
- Permission prompt only on explicit user action in Settings — check `Notification.permission` state first
- Mark reminder `sent = 1` before attempting push (not after) — prevents re-fire on cron error

**Research flag:** Needs a focused validation step — the `injectManifest` strategy switch must be tested in the actual Docker production build (nginx serving the `dist/`) before push subscription code lands. Workbox precache manifest injection behaves differently in production vs. Vite dev server. Verify offline caching still works after the switch.

---

### Phase Ordering Rationale

- **Time tracking first:** No external dependencies, no SW changes. Establishes the migration + route + hook patterns used in subsequent phases. Independently releasable.
- **Backup second:** Adds the only other non-push backend dependency (`archiver`). Short, isolated, high value. Can be released to production independently.
- **KB sidebar third:** Zero backend risk. Purely a UX improvement to one component. Can be validated in production before the push phase begins.
- **Push last:** Highest risk due to SW strategy change. All other features are in production and stable before this change lands. If the SW switch causes a regression, the scope of impact is limited to push/PWA — time tracking, backup, and KB sidebar are unaffected.

### Research Flags

**Needs care during implementation:**
- **Phase 4 (Push Notifications):** `injectManifest` strategy switch must be tested in the Docker/nginx production build, not only local Vite dev server. Verify offline cache after strategy switch before writing push handler code.

**Standard patterns (no additional research needed):**
- **Phase 1 (Time Tracking):** Well-established log-entry model. React Query CRUD pattern already in use throughout codebase.
- **Phase 2 (Backup):** Streaming zip via `archiver` is documented and verified. `better-sqlite3.backup()` is official API.
- **Phase 3 (KB Sidebar):** Refactors existing component with existing APIs. Debounce + cache invalidation patterns already present in codebase.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions confirmed via npm registry; existing stack confirmed via direct `package.json` read; 0 ambiguous dependencies |
| Features | HIGH | UX patterns verified against Freshdesk, Atera, Zendesk, MDN; existing API inventory confirmed in PROJECT.md and codebase inspection |
| Architecture | HIGH | Direct codebase inspection of existing routes, schema, scheduler, vite config, and KBLinksSection component; code sketches verified against actual file patterns |
| Pitfalls | HIGH (codebase-specific) / MEDIUM (push edge cases) | SQLite backup and VAPID pitfalls from official docs; iOS push behavior from Apple Developer Forums; `injectManifest` from vite-plugin-pwa docs (some community discussion) |

**Overall confidence:** HIGH

### Gaps to Address

- **`injectManifest` Docker build behavior:** The strategy switch is documented, but the exact Workbox manifest injection behavior inside the Docker multi-stage build (nginx serving `dist/`) needs a smoke test immediately after the switch in Phase 4. Risk is low but the regression is silent if missed.

- **Upload directory size in production:** The streaming backup pattern handles any size safely. The Docker container's `/tmp` partition must have space for the SQLite snapshot temp file — negligible for this system but worth a one-line log during backup phase implementation.

- **iOS push non-requirement:** The system is accessed primarily from desktop Chrome/Firefox. iOS push (requires Home Screen install) is explicitly a non-requirement for v1.5. The iOS capability guard in the permission UI is still required to avoid silent failures if the user accesses from iOS Safari.

---

## Sources

### Primary (HIGH confidence)
- `package.json` + `server/package.json` — confirmed existing stack versions
- `server/src/db/connection.ts` — WAL mode enabled, migration pattern confirmed
- `server/src/lib/reminderScheduler.ts` — existing cron scheduler pattern for push integration
- `src/components/KBLinksSection.tsx` — existing KB component to refactor for API-driven search
- `vite.config.ts` — confirmed `generateSW` strategy (must change in Phase 4)
- `server/src/db/schema.sql` — timestamp and naming conventions for new tables
- [better-sqlite3 backup() API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — online backup, WAL safety
- [web-push npm (web-push-libs)](https://github.com/web-push-libs/web-push) — VAPID keys, sendNotification API
- [MDN Web Push API](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/js13kGames/Re-engageable_Notifications_Push) — PushSubscription structure, push event handler
- [Notification.requestPermission() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static) — permission state permanence
- [SQLite Backup API](https://sqlite.org/backup.html) — WAL-safe online backup rationale

### Secondary (MEDIUM confidence)
- [vite-plugin-pwa injectManifest guide](https://vite-pwa-org.netlify.app/guide/inject-manifest.html) — strategy switch config and custom SW file requirements
- [web.dev push notifications codelab](https://web.dev/articles/codelab-notifications-push-server) — subscription storage pattern
- [Pushpad — PushSubscription backend storage](https://pushpad.xyz/blog/web-push-notifications-store-the-subscription-in-the-backend-database) — endpoint/p256dh/auth schema rationale
- [Backup strategies for SQLite in production](https://oldmoe.blog/2024/04/30/backup-strategies-for-sqlite-in-production/) — VACUUM INTO vs cp pitfalls
- archiver npm streaming pattern — `archive.pipe(res)` + `archive.finalize()` (multiple sources)
- Freshdesk, Atera time tracking docs — log-entry UX patterns
- MagicBell PWA push guide — subscription lifecycle, iOS limitations
- [iOS PWA limitations (2025/2026)](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) — Home Screen install requirement, EU DMA impact

### Tertiary (LOW confidence — needs validation)
- iOS push EU DMA impact (Apple Developer Forums thread 732594) — relevant only if user accesses from iOS; desktop is primary
- Push notification payload size limits — not researched; title + body + ticket URL is well within standard 4 KB limit

---
*Research completed: 2026-04-05*
*Ready for roadmap: yes*
