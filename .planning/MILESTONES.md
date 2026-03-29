# Milestones

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
