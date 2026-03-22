# Roadmap: IT Ticket System — Reports, Archive & KB Milestone

## Overview

This milestone closes three capability gaps in an otherwise feature-complete single-user IT ticket system. Reports analytics are currently computed on paginated data, producing silently wrong charts — fixing this is the priority that unlocks all other chart work. The Knowledge Base gains proper full-text search, two-way ticket links, and article type classification. The Archive gains a closed-date range filter for period-based audits. All three areas have a working core; this milestone delivers targeted, well-defined additions.

## Phases

- [x] **Phase 1: Reports Fix & Improvements** - Fix analytics to run on full dataset; add category breakdown, open/closed trend, and print-to-PDF (gap closure in progress) (completed 2026-03-22)
- [ ] **Phase 2: Knowledge Base Rework** - FTS5 full-text search, reverse KB-to-ticket links, article type field
- [ ] **Phase 3: Archive Enhancement** - Closed date range filter with supporting database index

## Phase Details

### Phase 1: Reports Fix & Improvements
**Goal**: Reports show accurate data computed from the full ticket dataset, with a category breakdown chart, open/closed trend overlay, and clean print output
**Depends on**: Nothing (first phase)
**Requirements**: RPT-01, RPT-02, RPT-03, RPT-04
**Success Criteria** (what must be TRUE):
  1. The reports page charts reflect the total number of tickets in the database, not just the current paginated page
  2. A category breakdown chart is visible showing ticket counts per category
  3. The timeline chart shows both open and closed ticket counts as an overlaid trend
  4. Triggering browser print (or clicking the print button) produces a clean, chart-visible PDF with no navigation chrome
**Plans**: 4 plans

Plans:
- [x] 01-01: Backend reports summary endpoint (`GET /api/reports/summary`) with SQL GROUP BY aggregation
- [x] 01-02: Wire Reports.tsx to new endpoint; add category breakdown chart and open/closed trend overlay
- [x] 01-03: Print-optimized `@media print` CSS and print button
- [x] 01-04: Gap closure — fix paginated-data bug for secondary charts (byPriority endpoint, useTickets limit)

### Phase 2: Knowledge Base Rework
**Goal**: KB search uses full-text indexing with highlighted snippets, articles link back to the tickets that reference them, and articles carry an optional type classification
**Depends on**: Phase 1
**Requirements**: KB-01, KB-02, KB-03, KB-04, KB-05
**Success Criteria** (what must be TRUE):
  1. Searching the KB returns ranked results with the matching term highlighted in the snippet
  2. Searching for a word that appears inside an HTML tag (e.g., a CSS class name) does not appear as a false match
  3. A KB article detail page shows a "Linked Tickets" panel listing all tickets that reference that article, with links to each ticket
  4. KB articles can be tagged as "how-to" or "solution"; the type badge is visible in the article list and filterable
  5. Existing articles without a type set show no badge and continue to function normally
**Plans**: 3 plans

Plans:
- [ ] 02-01: FTS5 migration — virtual table, sync triggers, HTML-stripped initial population, rowid join pattern
- [ ] 02-02: `GET /api/kb/articles/:id/tickets` endpoint and "Linked Tickets" panel in KBArticleDetail
- [ ] 02-03: `article_type` column migration, type selector in KB article form, type badge and filter in KB list

### Phase 3: Archive Enhancement
**Goal**: The archive can be filtered by the date a ticket was closed, backed by a database index for fast queries
**Depends on**: Phase 2
**Requirements**: ARCH-01, ARCH-02
**Success Criteria** (what must be TRUE):
  1. The archive filter bar contains "from" and "to" date pickers that filter tickets by their `closed_at` date
  2. Selecting a date range and clearing it both produce correct filtered results with no stale data shown
  3. Archive queries against large datasets remain fast due to the composite index on `(status, closed_at)`
**Plans**: 3 plans

Plans:
- [ ] 03-01: Composite index `idx_tickets_closed_at ON tickets(status, closed_at DESC)` and `dateFrom`/`dateTo` query params on the archive endpoint
- [ ] 03-02: Date range inputs in Archive.tsx filter bar with React Query cache invalidation

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Reports Fix & Improvements | 4/4 | Complete   | 2026-03-22 |
| 2. Knowledge Base Rework | 0/3 | Not started | - |
| 3. Archive Enhancement | 0/2 | Not started | - |

---
*Roadmap created: 2026-03-22*
*Coverage: 11/11 v1 requirements mapped*
