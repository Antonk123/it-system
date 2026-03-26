# Roadmap: IT Ticket System

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-03-22)
- 🚧 **v1.1 Quality & Automation** — Phases 4-6 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) — SHIPPED 2026-03-22</summary>

- [x] Phase 1: Reports Fix & Improvements (4/4 plans) — completed 2026-03-22
- [x] Phase 2: Knowledge Base Rework (3/3 plans) — completed 2026-03-22
- [x] Phase 3: Archive Enhancement (2/2 plans) — completed 2026-03-22

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### 🚧 v1.1 Quality & Automation (In Progress)

**Milestone Goal:** Consolidate filter UX, bring Archive to parity with the ticket list, add recurring tickets and dashboard queues, and clean up Reports.

- [ ] **Phase 4: Filter Consolidation & Archive Parity** - Single filter row across all views; Archive gains full filter and bulk-action support
- [ ] **Phase 5: Automation — Recurring Tickets & Dashboard Queues** - Auto-create tickets on schedule; smart queues on the Dashboard
- [ ] **Phase 6: Reports Cleanup** - Remove redundant modules, fix tag bug, strip customization overhead

## Phase Details

### Phase 4: Filter Consolidation & Archive Parity
**Goal**: Users have a single coherent filter experience across all ticket views, with Archive fully matching the ticket list's capabilities
**Depends on**: Phase 3
**Requirements**: FILT-01, FILT-02, FILT-03, FILT-04, FILT-05
**Success Criteria** (what must be TRUE):
  1. The ticket list has exactly one filter row containing all controls — no separate quick-filter bar or date row exists
  2. Active filters display as removable chips inline in the filter row
  3. Saved filter presets can be applied on both the ticket list page and the Archive page
  4. The Archive page offers the same filter options as the ticket list (priority, checklist completion, date range)
  5. The Archive page supports bulk operations: select multiple tickets and change status or priority
**Plans**: 2 plans
Plans:
- [ ] 04-01-PLAN.md — Build shared filter components (UnifiedFilterBar, ActiveFilterChips, DateRangePopover) and extend filter preset system
- [ ] 04-02-PLAN.md — Wire components into TicketList and Archive, add bulk operations and backend bulk-delete endpoint
**UI hint**: yes

### Phase 5: Automation — Recurring Tickets & Dashboard Queues
**Goal**: Users can automate ticket creation on a schedule and see smart queues on the Dashboard without manual searching
**Depends on**: Phase 4
**Requirements**: RECUR-01, RECUR-02, RECUR-03, RECUR-04, DASH-01, DASH-02, DASH-03
**Success Criteria** (what must be TRUE):
  1. User can create a recurring ticket template with a schedule (daily / weekly / monthly / custom cron) and tickets are auto-created in the background on that schedule
  2. User can pause, edit, and delete recurring schedules from a management view
  3. User can see the history of tickets created by each recurring schedule
  4. Dashboard displays saved queues (e.g. "Pending", "No activity 7+ days", "Critical") each showing a live ticket count, clickable to the filtered ticket list
  5. User can create, edit, and delete dashboard queues
**Plans**: TBD
**UI hint**: yes

### Phase 6: Reports Cleanup
**Goal**: Reports is a clean, focused analytics page — no redundant modules, correct tag data, and no customization overhead
**Depends on**: Phase 5
**Requirements**: RPT-01, RPT-02, RPT-03, RPT-04
**Success Criteria** (what must be TRUE):
  1. Activity Heatmap and Radial Progress Rings are absent from the Reports page
  2. The tag analytics section lists every tag that appears on any ticket — no entries missing
  3. The Reports layout is visually consistent with no overlapping or duplicated modules
  4. The show/hide module customization UI is removed — all remaining modules are always visible
**Plans**: TBD

## Progress

**Execution Order:** 4 → 5 → 6

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Reports Fix & Improvements | v1.0 | 4/4 | Complete | 2026-03-22 |
| 2. Knowledge Base Rework | v1.0 | 3/3 | Complete | 2026-03-22 |
| 3. Archive Enhancement | v1.0 | 2/2 | Complete | 2026-03-22 |
| 4. Filter Consolidation & Archive Parity | v1.1 | 0/2 | Planning | - |
| 5. Automation — Recurring & Queues | v1.1 | 0/? | Not started | - |
| 6. Reports Cleanup | v1.1 | 0/? | Not started | - |
