# Feature Research: v1.5 Productivity & Insights

**Domain:** Internal IT ticket system — single-user, existing React + Express + SQLite + PWA stack
**Researched:** 2026-04-05
**Confidence:** HIGH — domain patterns verified against Freshdesk, Zendesk, Atera, and MDN/web-push-libs documentation

---

## What Already Exists (Baseline — Do Not Rebuild)

| Existing Feature | Relevant to v1.5 |
|-----------------|-----------------|
| Tickets with status, priority, categories, tags, custom fields | Time tracking attaches to tickets |
| KB articles with FTS5 search, `GET /api/kb/articles?search=` endpoint | KB sidebar search reuses this API |
| Command palette (Cmd+K), recently-viewed via localStorage | KB sidebar uses same FTS5 backend |
| Reminders system with node-cron scheduler | Push notifications fire from same triggers |
| Email notifications via nodemailer/SMTP | Push replaces / augments email reminders |
| Reports page with SQL GROUP BY analytics | Time report data feeds existing Reports page |
| SQLite database at `/app/data/database.sqlite` | Backup downloads this file |
| File uploads at `/app/data/uploads/` | Backup zips attachments alongside DB |
| vite-plugin-pwa 0.20.5 with Workbox service worker | Push requires service worker — already registered |
| `node-cron` scheduler already running in-process | Push dispatch runs from same scheduler |

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features expected from mature ticketing tools. Missing = feature feels unfinished or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Manual time entry on ticket** | Every helpdesk with time tracking (Freshdesk, Atera, Jira Service Desk) has a "Log Time" panel on the ticket detail page. Manual entry is the baseline: enter hours + minutes, optional note, save. | MEDIUM | New `time_logs` table (ticket_id, duration_minutes, note, logged_at). New `POST /api/tickets/:id/time-logs` + `GET`. No new schema complexity — straightforward join. |
| **Total time summary on ticket detail** | Once time is logged, the ticket must show a "Total time spent: 2h 30m" summary. Missing this makes logging feel pointless. | LOW | Pure client-side sum of all `time_logs.duration_minutes` for the ticket. Display as formatted "Xh Ym" in ticket metadata row. |
| **Time log list on ticket (who logged, when, note)** | Freshdesk and Atera both show a log list under the ticket. Even for single-user, seeing "Logged 45m on 2026-03-15: Set up printer" is essential for audit trails. | LOW | List from `GET /api/tickets/:id/time-logs`. Render as a card section in ticket detail, below comments. |
| **Delete time log entry** | Users make mistakes. Without delete, incorrect entries pollute the total. Every tool provides delete on log entries. | LOW | `DELETE /api/time-logs/:id`. Soft delete or hard delete — hard delete is sufficient for single-user. |
| **Time summary in Reports** | Time tracking without reporting is useless. Standard pattern: total hours by category, top 5 tickets by time, average resolution time. | MEDIUM | New `/api/reports/time` endpoint with GROUP BY queries. Add a "Tid" tab to existing Reports page (already has 4 tabs). Uses recharts (already installed). |
| **Browser push notification delivery** | Once the user subscribes, push notifications must actually fire and arrive in the OS notification center — on desktop (Chrome/Firefox) and on mobile (iOS 16.4+ via PWA home screen). | HIGH | Requires: VAPID key pair, `push_subscriptions` table in SQLite, `web-push` npm package on backend, service worker `push` event handler. Most complex part of PWA push. |
| **Notification permission opt-in prompt** | Browsers require explicit permission for push. The UI must have a clear "Enable notifications" button that triggers `Notification.requestPermission()` and `pushManager.subscribe()`. | LOW | Settings page already exists. Add a "Notifieringar" section with enable/disable toggle. Must be triggered by user gesture (browser requirement). |
| **Reminder fires push notification** | The existing reminder scheduler (node-cron) must dispatch push notifications when reminders are due. This is the primary use case — being notified of a ticket reminder without the app open. | MEDIUM | Hook into existing `checkReminders()` cron job. When reminder triggers, call `webpush.sendNotification()` to all stored subscriptions. |
| **Backup download button** | Admin tools universally offer a "download backup" button. A single-user self-hosted system that can't be backed up by the user is fragile. Downloadable zip = data ownership. | MEDIUM | `GET /api/admin/backup` endpoint: copy SQLite to temp file (safe read), zip with file uploads directory, stream to browser as `.zip`. Uses `archiver` or `adm-zip` npm package. |
| **Backup includes attachments** | A DB-only backup is incomplete — ticket attachments (files in `/app/data/uploads/`) must be included. Users expect a self-contained archive. | LOW-MEDIUM | Bundle `/app/data/uploads/` into the same zip alongside the SQLite file. Depends on backup endpoint above. |
| **KB search inside ticket detail view** | Zendesk, Freshdesk, and Linear all embed a KB/article search panel in the ticket sidebar. Without it, finding the right KB article requires navigating away, losing ticket context. | MEDIUM | New collapsible sidebar section in `TicketDetail.tsx`. Reuses `GET /api/kb/articles?search=` endpoint. Shows top 5 results with "Link to ticket" action. |
| **Link KB article from ticket detail** | Searching KB is only half the value. The user must be able to link an article to the ticket without leaving the ticket view. The existing `ticket_kb_links` table and link API already exist. | LOW | Reuses `POST /api/tickets/:id/kb-links` (already exists from v1.2 work). In the KB sidebar search results, show a "Link article" button per result. |

---

### Differentiators (Competitive Advantage)

Features beyond the baseline that improve this specific single-user workflow.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Timer (start/stop) on ticket** | Freshdesk and Atera offer a live timer on ticket detail. For an IT technician actively working a ticket, clicking "Start" and "Stop" is faster than mentally tracking time and entering it later. | MEDIUM | Client-side timer using `Date.now()`. On "Stop", open a pre-filled "Log time" dialog with computed duration. No backend timer state — only the final log entry is persisted. |
| **Aging ticket push notifications** | Beyond reminders, proactively notify when a ticket has had no update in N days (configurable threshold). This catches silently-stalled tickets that don't have explicit reminders. | MEDIUM | Add aging push check to existing cron job or a new daily cron. Query tickets where `updated_at < NOW() - interval` and status != closed. Send push per stalled ticket. |
| **Time breakdown chart in Reports** | A bar chart showing hours spent per category or per week gives meaningful insight into where time goes. More actionable than raw total counts. | LOW-MEDIUM | New recharts BarChart in the "Tid" tab. Data from `/api/reports/time`. Already have recharts, chart pattern established in Reports. |
| **Notification click navigates to ticket** | When user clicks the push notification, the PWA should open and navigate directly to the relevant ticket. This requires passing the ticket URL in the notification payload. | LOW | In the service worker `notificationclick` handler, call `clients.openWindow('/tickets/:id')`. Include `ticketId` in the push payload JSON. |
| **KB sidebar shows already-linked articles** | In addition to search results, the KB sidebar should show articles already linked to this ticket — so the user knows what's already documented without re-searching. | LOW | `GET /api/tickets/:id/kb-links` already exists (v1.2). Render linked articles as a separate section above the search box in the sidebar panel. |
| **Quick time entry via chip buttons** | Common time values (15 min, 30 min, 1 hour, 2 hours) as quick-select chips avoid typing duration for common work intervals. | LOW | Pure frontend addition to the time log form. Clicking a chip sets the duration field value. No backend change. |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|-------------|---------------|-----------------|-------------|
| **Live timer persisted to backend** | Feels more "accurate" — timer state survives page refresh | Requires websocket or polling to sync timer state; adds complexity and race conditions for zero gain in single-user context | Client-side timer in React state; show pre-filled duration on Stop |
| **Billable/non-billable time distinction** | Standard in Freshdesk and Harvest for billing clients | This is a single-user internal IT tool, not a client billing system. Billable flag adds a field and UI that has no use case here. | Single duration + optional note field is sufficient |
| **Background sync for offline time logs** | Sounding robust — log time even when offline | Service worker background sync is complex, adds conflict resolution edge cases, and the app requires LAN access to the Docker server anyway | Require connectivity for time log submission |
| **Push notification scheduling UI (full calendar)** | Users want fine-grained control over when notifications arrive | For this system, reminders already have `remind_at` timestamps. A separate notification schedule editor duplicates the reminder system. | Push fires from existing reminder triggers — no new scheduling UI |
| **Third-party push service (Firebase FCM)** | Easier setup tutorial availability | Introduces external dependency, tracking, and potential for service changes. VAPID is the standard, works without any external service, and the `web-push` library handles it fully. | VAPID-only with `web-push` npm package |
| **Scheduled automatic cloud backup** | Feels safer than manual download | Requires external storage integration (S3, SFTP, etc.) — massive scope creep. Single-user tool on a home Proxmox server can use a VM-level backup strategy. | Manual download button is sufficient; OS/VM snapshot for disaster recovery |
| **Restore from backup via UI** | Paired with backup, restore seems natural | Restore on a live running system is dangerous — must stop the container, replace the DB file, restart. Restoring through the UI risks corrupting an in-use SQLite file. | Document: stop container, replace `/app/data/database.sqlite`, restart. Too risky to automate. |
| **Full KB article rendering in ticket sidebar** | Show article content inline without navigating away | Full article rendering duplicates KB detail page in a narrow sidebar, creating readability issues and Tiptap render overhead | Show title + excerpt (first 200 chars) in sidebar; "Öppna artikel" link for full read |

---

## Feature Dependencies

```
Time tracking:
  time_logs table (new)
      └── Manual time entry form (TicketDetail.tsx)
              └── Total time summary (TicketDetail.tsx) — sum from log list
              └── Time log list (TicketDetail.tsx) — GET /api/tickets/:id/time-logs
              └── Delete log entry
      └── Timer widget (client-side only)
              └── Pre-fills manual entry form on Stop
      └── Reports "Tid" tab
              └── /api/reports/time endpoint (new)
              └── recharts BarChart (existing library)

PWA push notifications:
  VAPID key generation (one-time setup)
      └── push_subscriptions table (new: endpoint, p256dh, auth)
      └── /api/push/subscribe endpoint (new: saves subscription)
      └── /api/push/unsubscribe endpoint (new: removes subscription)
      └── web-push npm package (new server dependency)
      └── Service worker push event handler (extends existing sw)
              └── Notification display + click handler
      └── Settings UI opt-in button
      └── Reminder cron dispatch (extends existing checkReminders)
      └── Aging ticket cron dispatch (optional, extends existing cron)

Backup & export:
  GET /api/admin/backup (new endpoint)
      └── better-sqlite3 backup() API (safe copy without locking)
      └── archiver or adm-zip npm package (new dependency)
      └── Streams DB + /app/data/uploads/ as zip
      └── Settings page "Backup" button (new UI section)

KB sidebar in ticket detail:
  GET /api/kb/articles?search= (already exists — reuse)
  GET /api/tickets/:id/kb-links (already exists v1.2 — reuse)
  POST /api/tickets/:id/kb-links (already exists v1.2 — reuse)
      └── New collapsible sidebar panel in TicketDetail.tsx
              └── Linked articles section (from existing API)
              └── Search box → results list → Link button
```

### Dependency Notes

- **Time reports require time_logs data**: No data = charts show empty state. Build time logging before time reports.
- **Push notifications require service worker**: vite-plugin-pwa already registers a Workbox service worker — the push event handler must be added to a custom SW or via Workbox `injectManifest` mode. Verify current SW configuration before assuming it supports custom push handlers (HIGH confidence concern — Workbox's `generateSW` mode does not support custom event listeners).
- **KB sidebar is fully independent**: Reuses three existing APIs, touches only `TicketDetail.tsx`. Zero backend changes needed. Can be built first or last.
- **Backup is fully independent**: New backend endpoint only, new Settings UI button. No schema changes.

---

## MVP Definition for v1.5

### Phase 1 — KB sidebar (independent, low risk)

- [ ] Collapsible KB search panel in ticket detail — reuses existing APIs, no backend changes
- [ ] Linked articles section in same panel — reuses existing `ticket_kb_links` API
- [ ] "Link article" action from search results

### Phase 2 — Time tracking core

- [ ] `time_logs` table migration
- [ ] `POST/GET/DELETE /api/tickets/:id/time-logs` endpoints
- [ ] Manual time entry form in ticket detail
- [ ] Total time summary in ticket metadata
- [ ] Time log list with delete

### Phase 3 — Push notifications

- [ ] VAPID key generation + storage in env
- [ ] `push_subscriptions` table + subscribe/unsubscribe endpoints
- [ ] `web-push` integration in cron reminder dispatch
- [ ] Service worker push + notificationclick handler
- [ ] Settings opt-in toggle

### Phase 4 — Backup + time reports

- [ ] `GET /api/admin/backup` with zip stream
- [ ] Settings backup button with progress indication
- [ ] `/api/reports/time` endpoint
- [ ] "Tid" tab in Reports page with charts

### Add After Validation (post-v1.5)

- [ ] Timer (start/stop) widget on ticket — enhances time tracking after core is validated
- [ ] Aging ticket push notifications — extends push after reminders are proven working
- [ ] Quick time chip buttons — UI polish after data model is confirmed

### Defer (out of scope for v1.5)

- [ ] Restore from backup via UI — too risky to automate
- [ ] Billable/non-billable time — no use case in single-user IT tool
- [ ] Third-party push services — VAPID is sufficient

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| KB sidebar search in ticket detail | HIGH | LOW (reuses existing APIs) | P1 |
| Manual time entry on ticket | HIGH | MEDIUM (new table + API) | P1 |
| Time summary on ticket | HIGH | LOW (client-side sum) | P1 |
| Backup download | HIGH | MEDIUM (zip stream) | P1 |
| Push: reminder dispatch | HIGH | HIGH (VAPID + SW setup) | P1 |
| Push: opt-in settings UI | HIGH | LOW (requires backend first) | P1 |
| Time reports tab | MEDIUM | MEDIUM (new endpoint + chart) | P2 |
| Timer start/stop | MEDIUM | MEDIUM (client-only, UX polish) | P2 |
| Push: aging ticket alert | MEDIUM | LOW (extends existing cron) | P2 |
| Notification click → ticket navigate | LOW | LOW (SW notificationclick) | P2 |
| Quick time chip buttons | LOW | LOW (pure UI) | P3 |
| KB sidebar shows linked articles | MEDIUM | LOW (reuses API) | P1 |

**Priority key:**
- P1: Core v1.5 scope — must ship
- P2: Should ship if time allows, or follow-on phase
- P3: Nice-to-have, defer

---

## Key Implementation Risks

### Risk 1: Workbox service worker and custom push event handlers
**Issue:** `vite-plugin-pwa` in `generateSW` mode generates the service worker automatically and does not allow custom event listeners. Push notification `push` and `notificationclick` events require custom SW code.
**Mitigation:** Switch vite-plugin-pwa to `injectManifest` mode, which merges a custom `sw.ts` with the generated precache manifest. This is a one-time config change but affects the SW build pipeline.
**Confidence:** HIGH — this is a documented vite-plugin-pwa constraint.

### Risk 2: iOS PWA push requires home screen installation
**Issue:** iOS push only works when the PWA is installed via Safari's "Add to Home Screen" AND the user is in the EU (iOS 17.4 DMA change removes standalone PWA support in EU). The system is hosted in Sweden (EU).
**Mitigation:** For this single-user internal tool deployed on a Proxmox LAN server, the user primarily accesses it from a desktop browser (Chrome/Firefox). iOS push is a bonus, not a requirement. Desktop push is unaffected by the iOS limitation.
**Confidence:** HIGH — verified via MDN and Apple Developer Forums.

### Risk 3: SQLite backup while process is live
**Issue:** A naive `fs.copyFile` on an in-use SQLite database can produce a corrupt backup.
**Mitigation:** `better-sqlite3` exposes a `.backup(destPath)` method that uses the SQLite Online Backup API — produces a consistent snapshot without blocking writes. This is the correct approach.
**Confidence:** HIGH — documented in better-sqlite3 README.

### Risk 4: Zip of uploads directory during backup
**Issue:** Large attachments could make the zip operation time out or exhaust memory if done synchronously.
**Mitigation:** Use streaming zip (`archiver` npm package) and pipe directly to the HTTP response. Do not buffer the entire zip in memory. Set a reasonable timeout on the route.
**Confidence:** MEDIUM — pattern is well-established but depends on upload directory size.

---

## Confidence Assessment

| Area | Level | Basis |
|------|-------|-------|
| Time tracking UX patterns | HIGH | Freshdesk, Atera, Jira Service Desk time log UX verified via search + direct documentation reads |
| PWA push implementation | HIGH | MDN Web Push API docs, web-push-libs/web-push GitHub README, MagicBell PWA guide — consistent across sources |
| iOS push limitations | HIGH | Apple Developer Forums + multiple 2025 sources confirm iOS 16.4+ requirement and EU DMA impact |
| Vite-plugin-pwa SW mode requirement | HIGH | Known constraint, multiple community resources confirm generateSW vs injectManifest distinction |
| SQLite backup via better-sqlite3 | HIGH | better-sqlite3 official README documents `.backup()` method |
| Backup zip streaming | MEDIUM | archiver npm pattern well-documented; exact behavior under Docker volume mount not verified |
| KB sidebar UX patterns | HIGH | Zendesk, Freshdesk, Linear sidebar KB integration patterns well-established; existing APIs already match |
| Existing ticket_kb_links API | HIGH | Confirmed in PROJECT.md — v1.2 shipped `POST /api/tickets/:id/kb-links` |

---

## Sources

- Freshdesk time tracking documentation: [Track time spent by agents on tickets](https://www.freshworks.com/freshdesk/helpdesk-management/time-tracking/) — HIGH confidence
- Atera ticket time tracking: [Ticket time tracking – Atera Support](https://support.atera.com/hc/en-us/articles/115000524667-Ticket-time-tracking) — HIGH confidence
- MDN PWA push notifications: [Re-engageable Notifications Push](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Tutorials/js13kGames/Re-engageable_Notifications_Push) — HIGH confidence
- web-push npm library: [web-push on GitHub](https://github.com/web-push-libs/web-push) — HIGH confidence
- MagicBell PWA push guide: [Using Push Notifications in PWAs](https://www.magicbell.com/blog/using-push-notifications-in-pwas) — HIGH confidence
- iOS PWA limitations: [PWA iOS Limitations 2025](https://brainhub.eu/library/pwa-on-ios) and [PWA iOS Limitations Safari Support 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) — HIGH confidence
- iOS push EU DMA impact: [Apple Developer Forums thread 732594](https://developer.apple.com/forums/thread/732594) — HIGH confidence
- Zendesk KB sidebar pattern: [Best Zendesk sidebar app](https://www.eesel.ai/blog/zendesk-sidebar-app) — MEDIUM confidence
- Contextual help UX patterns 2026: [Contextual Help UX – Chameleon](https://www.chameleon.io/blog/contextual-help-ux) — MEDIUM confidence
- SQLite backup strategies: [Backup strategies for SQLite in production](https://oldmoe.blog/2024/04/30/backup-strategies-for-sqlite-in-production/) — MEDIUM confidence
- Project context: `.planning/PROJECT.md`, `.planning/codebase/STACK.md` — HIGH confidence

---

*Feature research for: IT-Ticket v1.5 — Productivity & Insights*
*Researched: 2026-04-05*
