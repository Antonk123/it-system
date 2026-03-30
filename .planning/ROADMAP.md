# Roadmap: IT Ticket System

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-03-22)
- ✅ **v1.1 Quality & Automation** — Phases 4-6 (shipped 2026-03-29)
- ✅ **v1.2 Knowledge Base Expansion** — Phases 7-9 (shipped 2026-03-29)
- 🚧 **v1.3 Streamline & Declutter** — Phases 10-12 (in progress)

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

### 🚧 v1.3 Streamline & Declutter (In Progress)

**Milestone Goal:** Make ticket creation instant, editing lightweight, and the whole UI feel fast by removing noise and simplifying workflows.

- [x] **Phase 10: KB Cleanup** — Remove dead weight from the knowledge base (view counter, unused sections, stale templates) (completed 2026-03-29)
- [x] **Phase 11: Form Simplification** — Rework ticket create/edit forms with collapsible sections, hidden empty fields, and streamlined controls (completed 2026-03-30)
- [x] **Phase 12: Quick Capture** — Minimal ticket creation (title-only), authenticated public form shortcut, and ticket cloning (completed 2026-03-30)

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
| 10. KB Cleanup | v1.3 | 2/2 | Complete    | 2026-03-29 |
| 11. Form Simplification | v1.3 | 2/2 | Complete   | 2026-03-30 |
| 12. Quick Capture | v1.3 | 2/2 | Complete   | 2026-03-30 |
