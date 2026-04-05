# Milestones

## v1.5 Productivity & Insights (Shipped: 2026-04-05)

**Phases completed:** 4 phases, 7 plans, 8 tasks

**Key accomplishments:**

- KB sidebar search: FTS5-powered KB article search and linking directly from ticket detail view
- Time tracking: duration logging per ticket with Swedish notation support, hover-delete entries, and total time badge
- Time reports: Tid tab in Reports with vertical bar chart per category and clickable top-10 tickets table
- Backup & export: WAL-safe SQLite snapshot + uploads bundled as ZIP download from Settings
- Push infrastructure: VAPID web push backend, custom service worker with injectManifest, graceful degradation
- Push integration: reminder-triggered push, daily aging-ticket alerts, and Settings UI toggle with permission-on-action

---

## v1.4 Dashboard, Search & Polish (Shipped: 2026-04-05)

**Phases completed:** 7 phases, 14 plans, 23 tasks

**Key accomplishments:**

- 4 complete per-theme light token sets in index.css with full coverage (primary, accent, ring, sidebar, chart, shadows, search-glow), FOUC-blocking script in index.html, and reactive useMode hook
- Two Express aggregation routes and two React Query hooks for aging tickets, today counts, and upcoming reminders — the data foundation for Plan 02 panel rendering.
- AgingTicketsPanel and RemindersPanel components with Swedish copy, severity tints, skeleton states, and KPI card idag sub-labels wired to useDashboardOverview and useUpcomingReminders hooks
- CommandDialog modal with debounced ticket+KB search, merged recently-viewed history, navigation group, and quick actions including theme toggle
- One-liner:
- Bottom tab bar with 4 tabs, mobile ticket cards with age display, single-column KB list, and Kanban toggle hidden on mobile
- TicketList.tsx

---

## v1.2 Knowledge Base Expansion (Shipped: 2026-03-29)

**Phases completed:** 3 phases, 6 plans, 7 tasks

**Key accomplishments:**

- KB article tags, draft/published status, view counter, and tag-based filtering — full backend + frontend for Phase 7 foundations
- Staleness detection with `last_reviewed_at`, stale filter, review button, and amber badge for content quality tracking
- Table of contents with scroll-spy anchor links on article detail, plus 3-card Swedish-language template picker
- Cross-reference system with bidirectional "Se även" links, link picker, and REST API
- Popular articles section, `/` keyboard shortcut, and ticket-to-KB article creation with pre-fill

---

## v1.1 Quality & Automation (Shipped: 2026-03-29)

**Phases completed:** 3 phases, 7 plans, 8 tasks

**Key accomplishments:**

- UnifiedFilterBar wired into TicketList (single filter row) and Archive (status hidden, date locked), BulkActionBar with re-open/priority/CSV/permanent-delete, and POST /tickets/bulk-delete backend endpoint
- One-liner:
- One-liner:
- One-liner:
- One-liner:

---

## v1.0 MVP (Shipped: 2026-03-22)

**Phases completed:** 3 phases, 9 plans, 18 tasks

**Key accomplishments:**

- SQL GROUP BY reports endpoint returning full-dataset aggregations (totals, byCategory, trend, avgResolutionDays, agingTickets) with year/month filtering, and a typed React Query hook ready for Reports.tsx consumption
- Reports.tsx wired to useReportsSummary for all KPI/chart data, with horizontal category bar chart in Oversikt tab and ComposedChart trend overlay (created bars + closed line) in Trend tab
- @media print block added to index.css with recharts height fix, nav/tab/filter suppression, and white-background PDF output via window.print() button
- byPriority SQL aggregation added to /api/reports/summary, useTickets limit raised to 10000 so all Reports charts use the full ticket dataset
- SQLite FTS5 virtual table replacing LIKE search: ranked results with `<mark>` snippets, HTML-stripped indexing, article_type column with CHECK constraint wired through all KB CRUD
- Reverse ticket lookup endpoint (GET /api/kb/articles/:id/tickets) and Länkade biljetter panel in KBArticleDetail with status and priority badges
- FTS5 search snippets with `<mark>` highlights, article type badge/filter in KB list, and optional type selector in article form wired end-to-end
- Composite index idx_tickets_closed_at and closed_at date filter field enabling fast archive date-range queries on the tickets endpoint
- Archive page gains Swedish-labeled "Stängd period" date pickers that filter closed tickets by closed_at, with URL persistence, a clear button, and CSV export support

---
