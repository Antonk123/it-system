# Roadmap: IT Ticket System

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-03-22)
- ✅ **v1.1 Quality & Automation** — Phases 4-6 (shipped 2026-03-29)
- ✅ **v1.2 Knowledge Base Expansion** — Phases 7-9 (shipped 2026-03-29)
- ✅ **v1.3 Streamline & Declutter** — Phases 10-12 (shipped 2026-03-30)
- ✅ **v1.4 Dashboard, Search & Polish** — Phases 13-16 (shipped 2026-04-05)
- 🚧 **v1.5 Productivity & Insights** — Phases 17-20 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) — SHIPPED 2026-03-22</summary>

- [x] Phase 1: Reports Fix & Improvements (4/4 plans) — completed 2026-03-22
- [x] Phase 2: Knowledge Base Rework (3/3 plans) — completed 2026-03-22
- [x] Phase 3: Archive Enhancement (2/2 plans) — completed 2026-03-22

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v1.1 Quality & Automation (Phases 4-6) — SHIPPED 2026-03-29</summary>

- [x] Phase 4: Filter Consolidation & Archive Parity (2/2 plans) — completed 2026-03-29
- [x] Phase 5: Automation — Recurring & Queues (3/3 plans) — completed 2026-03-29
- [x] Phase 6: Reports Cleanup (2/2 plans) — completed 2026-03-29

Full details: `.planning/milestones/v1.1-ROADMAP.md`

</details>

<details>
<summary>✅ v1.2 Knowledge Base Expansion (Phases 7-9) — SHIPPED 2026-03-29</summary>

- [x] Phase 7: KB Foundations — Tags, Status, View Count & Quick Wins (2/2 plans) — completed 2026-03-29
- [x] Phase 8: Content Quality — ToC, Templates & Staleness (2/2 plans) — completed 2026-03-29
- [x] Phase 9: Discoverability & Workflow — Cross-refs, Popular, Shortcuts (2/2 plans) — completed 2026-03-29

Full details: `.planning/milestones/v1.2-ROADMAP.md`

</details>

<details>
<summary>✅ v1.3 Streamline & Declutter (Phases 10-12) — SHIPPED 2026-03-30</summary>

- [x] Phase 10: KB Cleanup (2/2 plans) — completed 2026-03-29
- [x] Phase 11: Form Simplification (2/2 plans) — completed 2026-03-30
- [x] Phase 12: Quick Capture (2/2 plans) — completed 2026-03-30

Full details: `.planning/milestones/v1.3-ROADMAP.md`

</details>

<details>
<summary>✅ v1.4 Dashboard, Search & Polish (Phases 13-16) — SHIPPED 2026-04-05</summary>

- [x] Phase 13: Dark Mode Foundation (2/2 plans) — completed 2026-03-31
- [x] Phase 14: Dashboard Overview (2/2 plans) — completed 2026-03-31
- [x] Phase 15: Command Palette (2/2 plans) — completed 2026-03-31
- [x] Phase 16: Responsive & Animation Polish (2/2 plans) — completed 2026-04-04

Full details: `.planning/milestones/v1.4-ROADMAP.md`

</details>

### v1.5 Productivity & Insights (In Progress)

**Milestone Goal:** Ge insikt i tidsatgang, proaktiva notifieringar, datasakerhet via backup, och snabbare kunskapsatkomst under arendearbete.

- [x] **Phase 17: KB Sidebar Search** - Search and link KB articles directly from ticket detail (completed 2026-04-05)
- [x] **Phase 18: Time Tracking** - Log time on tickets with per-ticket summary and Reports analytics (completed 2026-04-05)
- [x] **Phase 19: Backup & Export** - Download database and uploaded files as a ZIP from Settings (completed 2026-04-05)
- [ ] **Phase 20: PWA Push Notifications** - Browser push notifications for reminders and aging tickets

## Phase Details

### Phase 17: KB Sidebar Search
**Goal**: Users can search and link KB articles without leaving the ticket detail view
**Depends on**: Phase 16
**Requirements**: KBSB-01, KBSB-02, KBSB-03
**Success Criteria** (what must be TRUE):
  1. User can open a KB search panel from ticket detail and search articles by keyword using FTS5
  2. User can link a KB article to the ticket directly from a search result in the panel
  3. User can see already-linked KB articles listed in the sidebar panel before typing a query
**Plans:** 1/1 plans complete
Plans:
- [x] 17-01-PLAN.md — Refactor KBLinksSection: React Query + FTS5 search + linked articles display
**UI hint**: yes

### Phase 18: Time Tracking
**Goal**: Users can log time spent on tickets and see time analytics in Reports
**Depends on**: Phase 17
**Requirements**: TIME-01, TIME-02, TIME-03, TIME-04, TIME-05, TIME-06
**Success Criteria** (what must be TRUE):
  1. User can log a time entry on a ticket (duration in minutes with an optional note)
  2. User can see a list of time logs on a ticket, each showing duration, date, and note
  3. User can delete a time log entry from the ticket detail
  4. User can see the total time spent on a ticket summarised in the ticket detail
  5. User can view a "Tid" tab in Reports showing time breakdown by category and top tickets by time spent
**Plans:** 3/3 plans complete
Plans:
- [x] 18-01-PLAN.md — Backend foundation: DB table, CRUD routes, reports endpoint, types, API client, duration parser, React Query hook
- [x] 18-02-PLAN.md — TimeSection sidebar component + TicketDetail integration
- [x] 18-03-PLAN.md — Reports Tid tab: TimeSummaryTab component with bar chart and top tickets table
**UI hint**: yes

### Phase 19: Backup & Export
**Goal**: Users can download a safe, complete backup of the system from the Settings page
**Depends on**: Phase 18
**Requirements**: BKUP-01, BKUP-02
**Success Criteria** (what must be TRUE):
  1. User can click a backup button in Settings and receive a ZIP file containing the SQLite database and all uploaded files
  2. The downloaded database file is a WAL-consistent snapshot (not a raw file copy) that can be opened safely in SQLite tools
**Plans:** 1/1 plans executed
Plans:
- [x] 19-01-PLAN.md — Backend backup endpoint (WAL-safe SQLite snapshot + uploads ZIP) and Settings UI section

### Phase 20: PWA Push Notifications
**Goal**: Users receive OS-level push notifications for reminders and aging tickets
**Depends on**: Phase 19
**Requirements**: PUSH-01, PUSH-02, PUSH-03, PUSH-04
**Success Criteria** (what must be TRUE):
  1. User can enable or disable push notifications from the Settings page (browser permission prompt triggered by explicit user action)
  2. User receives a push notification in the OS notification center when a reminder triggers
  3. User receives a push notification when a ticket has had no activity in N days
  4. User can click a push notification and be navigated directly to the relevant ticket in the app
**Plans:** 2 plans
Plans:
- [ ] 20-01-PLAN.md — Backend push infrastructure + custom service worker + injectManifest switch + nginx
- [ ] 20-02-PLAN.md — Scheduler integration (reminder push + aging push) + Settings UI toggle

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Reports Fix & Improvements | v1.0 | 4/4 | Complete | 2026-03-22 |
| 2. Knowledge Base Rework | v1.0 | 3/3 | Complete | 2026-03-22 |
| 3. Archive Enhancement | v1.0 | 2/2 | Complete | 2026-03-22 |
| 4. Filter Consolidation & Archive Parity | v1.1 | 2/2 | Complete | 2026-03-29 |
| 5. Automation — Recurring & Queues | v1.1 | 3/3 | Complete | 2026-03-29 |
| 6. Reports Cleanup | v1.1 | 2/2 | Complete | 2026-03-29 |
| 7. KB Foundations — Tags, Status, View Count & Quick Wins | v1.2 | 2/2 | Complete | 2026-03-29 |
| 8. Content Quality — ToC, Templates & Staleness | v1.2 | 2/2 | Complete | 2026-03-29 |
| 9. Discoverability & Workflow — Cross-refs, Popular, Shortcuts | v1.2 | 2/2 | Complete | 2026-03-29 |
| 10. KB Cleanup | v1.3 | 2/2 | Complete | 2026-03-29 |
| 11. Form Simplification | v1.3 | 2/2 | Complete | 2026-03-30 |
| 12. Quick Capture | v1.3 | 2/2 | Complete | 2026-03-30 |
| 13. Dark Mode Foundation | v1.4 | 2/2 | Complete | 2026-03-31 |
| 14. Dashboard Overview | v1.4 | 2/2 | Complete | 2026-03-31 |
| 15. Command Palette | v1.4 | 2/2 | Complete | 2026-03-31 |
| 16. Responsive & Animation Polish | v1.4 | 2/2 | Complete | 2026-04-04 |
| 17. KB Sidebar Search | v1.5 | 1/1 | Complete    | 2026-04-05 |
| 18. Time Tracking | v1.5 | 3/3 | Complete    | 2026-04-05 |
| 19. Backup & Export | v1.5 | 1/1 | Complete    | 2026-04-05 |
| 20. PWA Push Notifications | v1.5 | 0/? | Not started | - |
