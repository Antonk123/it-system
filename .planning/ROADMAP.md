# Roadmap: IT Ticket System

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-03-22)
- ✅ **v1.1 Quality & Automation** — Phases 4-6 (shipped 2026-03-29)
- ✅ **v1.2 Knowledge Base Expansion** — Phases 7-9 (shipped 2026-03-29)
- ✅ **v1.3 Streamline & Declutter** — Phases 10-12 (shipped 2026-03-30)
- 🚧 **v1.4 Dashboard, Search & Polish** — Phases 13-16 (in progress)

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

### 🚧 v1.4 Dashboard, Search & Polish (In Progress)

**Milestone Goal:** Give the system a complete overview, fast global search with navigation, and a polished experience with dark mode, responsive design, and micro-interactions.

- [x] **Phase 13: Dark Mode Foundation** — Complete CSS token coverage, theme toggle in nav, and FOUC prevention (human-verify pending)
- [x] **Phase 14: Dashboard Overview** — Aging tickets panel, today summary, and upcoming reminders widget (completed 2026-03-31)
- [ ] **Phase 15: Command Palette** — Cmd+K modal with ticket/KB search, navigation shortcuts, and quick actions
- [ ] **Phase 16: Responsive & Animation Polish** — Mobile layout, skeleton loading states, and page-load animations

## Phase Details

### Phase 10: KB Cleanup
**Goal**: The knowledge base is stripped of unused features, reducing code and UI noise before new work begins
**Depends on**: Nothing (independent removals)
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04, CLEAN-05
**Success Criteria** (what must be TRUE):
  1. KB article detail page shows no view count display anywhere
  2. KB home page has no "Senast uppdaterade" section
  3. KB home page has no "Populara artiklar" section
  4. New ticket template picker offers no "Losenordsaterstellning" or "Ny anvandare" templates
  5. Access token silently refreshes via refresh token — user never sees login screen unless inactive for 7+ days
**Plans**: 2 plans

Plans:
- [x] 10-01-PLAN.md — Remove view_count, KB home sections, and unused default templates
- [x] 10-02-PLAN.md — Fix silent token refresh with rolling refresh tokens

### Phase 11: Form Simplification
**Goal**: Ticket create and edit forms are lean — advanced fields hidden by default, all selectors searchable, template selection inline
**Depends on**: Phase 10
**Requirements**: FORM-01, FORM-02, FORM-03, FORM-04
**Success Criteria** (what must be TRUE):
  1. Ticket create form opens with a compact basics section; details and template fields expand on demand
  2. Ticket edit view shows empty optional fields (notes, solution, custom fields) only after the user clicks to reveal them
  3. Template selection on the create form is a single dropdown — no separate template selection step or page
  4. Category, priority, tags, and template dropdowns all accept keyboard search to filter options
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 11-01-PLAN.md — Build CategoryCombobox and TemplateCombobox searchable components
- [x] 11-02-PLAN.md — Restructure TicketForm with collapsible sections, hidden fields, and new comboboxes

### Phase 12: Quick Capture
**Goal**: Users can create a ticket in seconds with just a title, skip name/email on the public form when logged in, and clone past tickets
**Depends on**: Phase 11
**Requirements**: QCAP-01, QCAP-02, QCAP-03
**Success Criteria** (what must be TRUE):
  1. User can submit a new ticket by entering only a title — priority, category, and tags are auto-defaulted without user input
  2. Logged-in user visiting the public form sees no name/email fields and creates the ticket immediately
  3. User can open any existing ticket and clone it as a new ticket with title, description, category, and template fields pre-filled
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 12-01-PLAN.md — QuickCaptureFAB component and public form auth detection
- [x] 12-02-PLAN.md — Ticket cloning from detail page with form pre-fill

### Phase 13: Dark Mode Foundation
**Goal**: The theming system is complete — light mode is fully styled across every component, dark mode toggle is one click away in the nav, and the chosen mode persists without a flash on reload
**Depends on**: Phase 12
**Requirements**: THEME-01, THEME-02, THEME-03
**Success Criteria** (what must be TRUE):
  1. User can toggle between light and dark mode by clicking a button in the nav header
  2. Light mode renders all components correctly — no broken button colors, sidebar states, or gradient backgrounds
  3. Reloading the page in either mode shows the correct theme immediately without any flash of the other mode
  4. Recharts charts update their colors when the mode is switched without requiring a page reload
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 13-01-PLAN.md — Per-theme light CSS token sets, FOUC prevention script, and useMode hook
- [x] 13-02-PLAN.md — Nav toggle button, chart remount, and Daylight theme cleanup

### Phase 14: Dashboard Overview
**Goal**: The dashboard surfaces the information a user needs to understand their current workload — aging open tickets, what happened today, and reminders coming up
**Depends on**: Phase 13
**Requirements**: DASH-01, DASH-02, DASH-03
**Success Criteria** (what must be TRUE):
  1. User sees a panel of open tickets ranked by how long they have been open without an update
  2. User sees today's counts — tickets created, resolved, and closed since midnight — at a glance on the dashboard
  3. User sees upcoming reminders with the ticket title and scheduled time, ordered by proximity
  4. All three panels display skeleton loading states while their data is fetching
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 14-01-PLAN.md — Backend API endpoints and React Query hooks for dashboard data
- [x] 14-02-PLAN.md — Frontend panels, KPI sub-labels, and Dashboard.tsx wiring

### Phase 15: Command Palette
**Goal**: Users can open a Cmd+K modal to search tickets and KB articles, navigate to any page, and run common actions without touching the mouse
**Depends on**: Phase 14
**Requirements**: CMD-01, CMD-02, CMD-03, CMD-04
**Success Criteria** (what must be TRUE):
  1. Pressing Cmd+K (or Ctrl+K) anywhere in the app opens a modal palette that searches tickets and KB articles as the user types
  2. The palette offers navigation items (Dashboard, KB, Archive, etc.) visible in the idle state and reachable by typing
  3. The palette offers quick actions — create ticket and toggle light/dark mode — accessible from the idle state
  4. The palette shows recently visited tickets and KB articles when opened with an empty query
**Plans**: 2 plans

Plans:
- [ ] 15-01-PLAN.md — Build CommandPalette component, search hook, and recently-viewed utility
- [ ] 15-02-PLAN.md — Wire palette into Layout, remove GlobalSearch, add KB recently-viewed tracking
**UI hint**: yes

### Phase 16: Responsive & Animation Polish
**Goal**: The application is usable on mobile and tablet, communicates loading state clearly, and delivers smooth entrance animations that make the UI feel alive
**Depends on**: Phase 15
**Requirements**: RESP-01, RESP-02, ANIM-01, ANIM-02
**Success Criteria** (what must be TRUE):
  1. On a mobile screen, the sidebar collapses and a bottom navigation bar appears — all pages remain reachable
  2. Ticket lists and tables on mobile scroll horizontally or reflow without content being cut off or unreadable
  3. Dashboard panels, ticket list, and KB list all show skeleton placeholders while data loads — no blank or empty states
  4. Dashboard KPI cards and new panels animate in with a staggered entrance on page load
**Plans**: 2 plans

Plans:
- [ ] 15-01-PLAN.md — Build CommandPalette component, search hook, and recently-viewed utility
- [ ] 15-02-PLAN.md — Wire palette into Layout, remove GlobalSearch, add KB recently-viewed tracking
**UI hint**: yes

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
| 13. Dark Mode Foundation | v1.4 | 1/2 | Complete    | 2026-03-31 |
| 14. Dashboard Overview | v1.4 | 2/2 | Complete    | 2026-03-31 |
| 15. Command Palette | v1.4 | 0/? | Not started | - |
| 16. Responsive & Animation Polish | v1.4 | 0/? | Not started | - |
