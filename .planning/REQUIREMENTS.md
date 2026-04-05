# Requirements: IT Ticket System

**Defined:** 2026-04-05
**Core Value:** Every ticket gets tracked, resolved, and documented — nothing falls through the cracks and solutions are reusable.

## v1.5 Requirements

Requirements for milestone v1.5: Productivity & Insights.

### Tidsloggning

- [ ] **TIME-01**: User can log time on a ticket (duration in minutes + optional note)
- [ ] **TIME-02**: User can view list of time logs on a ticket with date and note
- [ ] **TIME-03**: User can delete a time log entry
- [ ] **TIME-04**: User can see total time spent on a ticket in ticket detail
- [ ] **TIME-05**: User can view time breakdown by category in Reports ("Tid" tab)
- [ ] **TIME-06**: User can view top tickets by time spent in Reports

### Push-notiser

- [ ] **PUSH-01**: User can enable/disable push notifications from settings
- [ ] **PUSH-02**: User receives push notification when a reminder triggers
- [ ] **PUSH-03**: User receives push notification when a ticket has had no activity in N days
- [ ] **PUSH-04**: User can click a push notification to navigate to the relevant ticket

### Backup & Export

- [ ] **BKUP-01**: User can download a zip containing the SQLite database and uploaded files
- [ ] **BKUP-02**: Backup uses safe SQLite snapshot (not raw file copy)

### KB från ärendevyn

- [ ] **KBSB-01**: User can search KB articles from a sidebar panel in ticket detail
- [ ] **KBSB-02**: User can link a KB article to the ticket from search results
- [ ] **KBSB-03**: User can see already-linked KB articles in the sidebar panel

## Future Requirements

### Tidsloggning (deferred)

- **TIME-F01**: Live start/stop timer on ticket detail
- **TIME-F02**: Quick-select chip buttons for common durations (15m, 30m, 1h)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Billable/non-billable time distinction | Single-user internal tool, no client billing |
| Live timer persisted to backend | Client-side timer sufficient, avoids websocket complexity |
| Background sync for offline time logs | App requires LAN access to Docker server anyway |
| Push notification scheduling UI | Reminders already have timestamps, no separate schedule needed |
| Firebase/FCM push service | VAPID is the standard, no external dependency needed |
| Scheduled automatic cloud backup | Requires external storage (S3/SFTP) — manual download sufficient |
| Restore from backup via UI | Dangerous on live system — document manual restore process instead |
| Full KB article rendering in sidebar | Show title + excerpt, link to full article — avoids Tiptap overhead |
| E-postintegration | Kräver separat mailbox, vill inte att alla mail blir ärenden |
| SLA/deadline-hantering | Inte motiverat för single-user system |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TIME-01 | Phase 18 | Pending |
| TIME-02 | Phase 18 | Pending |
| TIME-03 | Phase 18 | Pending |
| TIME-04 | Phase 18 | Pending |
| TIME-05 | Phase 18 | Pending |
| TIME-06 | Phase 18 | Pending |
| PUSH-01 | Phase 20 | Pending |
| PUSH-02 | Phase 20 | Pending |
| PUSH-03 | Phase 20 | Pending |
| PUSH-04 | Phase 20 | Pending |
| BKUP-01 | Phase 19 | Pending |
| BKUP-02 | Phase 19 | Pending |
| KBSB-01 | Phase 17 | Pending |
| KBSB-02 | Phase 17 | Pending |
| KBSB-03 | Phase 17 | Pending |

**Coverage:**
- v1.5 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-05*
*Last updated: 2026-04-05 after roadmap creation (v1.5 traceability filled)*
