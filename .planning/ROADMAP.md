# Roadmap: IT Ticket System

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-03-22)
- ✅ **v1.1 Quality & Automation** — Phases 4-6 (shipped 2026-03-29)
- 🔵 **v1.2 Knowledge Base Expansion** — Phases 7-9

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

### v1.2 Knowledge Base Expansion

#### Phase 7: KB Foundations — Tags, Status, View Count & Quick Wins

**Goal:** Add the foundational data model changes (tags, draft status, view count) and quick UX wins (print, recently updated) that later phases depend on.

**Requirements:** ORG-01, ORG-02, ORG-03, QUAL-01, DISC-01, WF-01

**Plans:** 2/2 plans complete

Plans:
- [x] 07-01-PLAN.md — Backend foundation: schema migration + route updates for tags, status, view_count
- [x] 07-02-PLAN.md — Frontend: tag input/filter, status toggle, recently updated, print button, view count display

**Scope:**
- `kb_article_tags` join table + tag input in article form + tag filter on KB list
- `status` column (draft/published) with list/FTS filtering
- `view_count` column with increment on article view
- "Senast uppdaterade" section on KB home page
- Print button on article detail (reuse existing `@media print` pattern)

**Why this grouping:** All schema changes in one migration. Quick wins (print, recently updated) ship immediately. View count and draft status are dependencies for Phase 8-9 features.

---

#### Phase 8: Content Quality — ToC, Templates & Staleness

**Goal:** Make the KB a trustworthy reference with structured content, templates for consistency, and staleness detection.

**Requirements:** QUAL-02, QUAL-03, TMPL-01, TMPL-02, TOC-01, TOC-02

**Scope:**
- Table of contents: parse headings from article HTML, render as sticky sidebar/inline ToC with anchor links
- Article templates: 2-3 hard-coded templates (Solution, How-to, Troubleshooting) with picker on new article
- Staleness detection: `last_reviewed_at` column, "Markera som granskad" button, stale filter on KB list

**Why this grouping:** All content quality features. ToC is pure frontend. Templates and staleness are low-medium complexity with minimal schema changes.

---

#### Phase 9: Discoverability & Workflow — Cross-refs, Popular, Shortcuts

**Goal:** Elevate the KB from a document store to a connected, navigable system with power-user shortcuts.

**Requirements:** DISC-02, DISC-03, DISC-04, WF-02, WF-03

**Scope:**
- Popular articles section on KB home (uses view_count from Phase 7)
- "Se även" cross-references: `kb_article_links` join table, link picker on article edit, panel on article detail
- Keyboard shortcut `/` to focus KB search
- "Skapa KB-artikel" button on ticket detail that pre-fills title and type

**Why this grouping:** All features that connect content and speed up workflows. Depends on Phase 7 (view_count) and Phase 8 (content is structured). The cross-references table is the main schema addition.

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Reports Fix & Improvements | v1.0 | 4/4 | Complete | 2026-03-22 |
| 2. Knowledge Base Rework | v1.0 | 3/3 | Complete | 2026-03-22 |
| 3. Archive Enhancement | v1.0 | 2/2 | Complete | 2026-03-22 |
| 4. Filter Consolidation & Archive Parity | v1.1 | 2/2 | Complete | 2026-03-29 |
| 5. Automation — Recurring & Queues | v1.1 | 3/3 | Complete | 2026-03-29 |
| 6. Reports Cleanup | v1.1 | 2/2 | Complete | 2026-03-29 |
| 7. KB Foundations — Tags, Status, View Count & Quick Wins | v1.2 | 1/2 | In Progress | — |
| 8. Content Quality — ToC, Templates & Staleness | v1.2 | 0/? | Pending | — |
| 9. Discoverability & Workflow — Cross-refs, Popular, Shortcuts | v1.2 | 0/? | Pending | — |
