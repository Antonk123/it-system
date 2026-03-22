# Feature Landscape

**Domain:** Internal single-user IT ticket system
**Milestone scope:** Reports page, Archive view, KB (knowledge base) rework
**Researched:** 2026-03-22
**Confidence:** HIGH — based on direct codebase inspection combined with established patterns from Jira, Linear, Zendesk, Notion, and Freshdesk

---

## Baseline: What Already Exists

Before listing gaps, the codebase audit revealed that more is built than the PROJECT.md "Active" list suggests. This prevents re-implementing things that work.

### Reports (src/pages/Reports.tsx)

Already implemented:
- KPI cards: total tickets, avg resolution time, resolution rate, aging tickets (>7 days open)
- Monthly trend bar chart (tickets created per month by year)
- Yearly overview bar chart (tickets closed per year)
- Status distribution pie chart
- Priority distribution pie chart
- Requester analytics bar chart with per-requester status breakdown, completion rate, avg resolution time
- Activity heatmap (GitHub-style, tickets per day)
- Status flow chart (transitions between statuses)
- Tag analytics panel (tag frequency, trends)
- Module visibility customization (toggle charts on/off, persisted)
- Year + month filter selectors
- CSV export (calls existing `/api/tickets/export`)
- KPI detail modals (click a KPI to see the underlying ticket list)

Genuine gaps in Reports:
- No open vs. closed **trend overlay** (one chart showing both lines together over time — Linear-style "opened vs. closed" pattern)
- No **category breakdown chart** (tickets by category — the tag analytics exist but categories are separate)
- No **PDF export** — only CSV today
- No **date range picker** for arbitrary ranges (e.g. last 30 days vs. month selector) — currently only year/month dropdowns

### Archive (src/pages/Archive.tsx)

Already implemented:
- Separate `/archive` route and page
- Shows only `status = 'closed'` tickets (excluded from main TicketList)
- Search, category filter, tag multi-select, priority quick filters
- Sort by createdAt, priority, category
- Pagination
- Compact view toggle
- CSV export + CSV import (ImportDialog)
- Status change confirmation dialog (can reopen a ticket from archive)
- Scroll-to-top on page change

Genuine gaps in Archive:
- Only shows `closed` tickets — **`resolved` tickets are not shown** (they live in main list), creating ambiguity about the "archive" concept
- No **closed-date filter** (date range for when tickets were closed/resolved — fundamental for "show me what I closed in Q1")
- No **requester filter** in archive (main list has it, archive doesn't)
- No summary stats on the archive page (e.g. "423 tickets closed across 8 categories")

### KB — Knowledge Base

Already implemented:
- Article CRUD with Tiptap rich text editor
- KB categories: create, update, delete, color-coding
- Category filter on KB index
- Search via title+content LIKE query (frontend debounced)
- Ticket→KB linking: backend table (`ticket_kb_links`), API endpoints, TicketDetail UI panel
- Article sharing: public share tokens, unauthenticated `/kb/shared/:token` view
- Article list preview (title, category badge, last-updated, content excerpt)

Genuine gaps in KB:
- **KB→Ticket reverse links**: The article detail page has NO "linked tickets" section. The `ticket_kb_links` table supports it and the API endpoint exists (`GET /api/kb/ticket/:ticketId`), but there is no reverse query (`GET /api/kb/articles/:id/tickets`) and no UI on the article side. This is the core missing piece of "two-way linking."
- **Full-text search**: Current search uses `LIKE '%query%'` on title and content. FTS5 (SQLite's native full-text search extension) would give ranked results, snippet highlighting, and correct word-boundary matching. For a KB that grows to 50+ articles with long HTML content, LIKE becomes slow and imprecise.
- **Article type / article category semantics**: Categories exist and work, but the concept of "how-to guides vs. ticket solutions" isn't enforced. There's no `article_type` enum field, no filtering by type, and no visual distinction between guide-style articles and solution-style articles in the list view.

---

## Feature Landscape by Area

---

## 1. Reports

### Table Stakes

Features users expect in any reporting view for an internal IT tool. Missing any of these makes the page feel half-done.

| Feature | Why Expected | Complexity | Current State |
|---------|--------------|------------|---------------|
| Open vs. closed trend overlay | Jira/Linear staple — lets you see if backlog is growing or shrinking over time | Low | Missing — only "created" bars exist |
| Category breakdown chart | Categories are a core classification axis, users need to see which categories dominate | Low | Missing |
| CSV export of filtered data | Standard for any data page, allows offline analysis | Low | Exists on Archive and Reports (all tickets) |
| Time period filter | Monthly/yearly filter — user needs to scope analysis | Low | Exists (year + month dropdowns) |
| KPI summary row | Total, open, closed, avg resolution time at a glance | Low | Exists |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| PDF export | Users who send summary reports to stakeholders need a printable format | Medium | Requires server-side rendering (html-pdf, puppeteer, or jsPDF in browser) |
| Date range picker | More flexible than month/year dropdowns — "show me the last 90 days" | Low-Med | Replaces or augments current selectors |
| Trend comparison (this period vs. last period) | "Am I doing better than last month?" — instant context without manual math | Medium | Useful but not standard in single-user tools |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| SLA tracking | Requires SLA definitions per category/priority — complex to configure, overkill for single user | Use simple "avg resolution time" per category |
| Assignee workload charts | Irrelevant — single user system, no team | Remove if stubbed in |
| Real-time updates / live charts | Not needed, reports are point-in-time summaries | Stick with React Query cache, manual refresh |
| PDF generated on backend with headless browser | Puppeteer adds 200MB+ to Docker image | Use jsPDF + html2canvas in browser, or use `window.print()` with a print stylesheet |

### Single-User Considerations

The requester analytics section (already built) is more relevant here than "assignee" analytics. The single user is the resolver; requesters are the people submitting tickets. Reports should answer:

1. Which requesters submit the most tickets? (already built)
2. Which categories recur most? (partially built — tags exist, categories missing)
3. Is the backlog growing? (gap — need open vs. closed overlay)
4. How quickly do I resolve things? (built — avg resolution time KPI)

### MVP Recommendation for Reports

Prioritize in this order:
1. Category breakdown bar/pie chart — one chart, connects to existing category data, closes the main gap
2. Open vs. closed trend overlay — single area/line chart replacing or supplementing the existing "created" bar chart
3. CSV export already works; defer PDF to later or implement as browser `window.print()` with a print CSS stylesheet (zero new dependencies)

Defer: Full date range picker — the year/month dropdowns are sufficient for now

---

## 2. Archive

### Table Stakes

| Feature | Why Expected | Complexity | Current State |
|---------|--------------|------------|---------------|
| Separate page from active tickets | Reduces noise in main list — standard pattern (Zendesk, Freshdesk, Jira) | Low | Exists at /archive |
| Includes both "resolved" and "closed" | "Resolved" is a terminal state for most users — it belongs in archive, not main list | Low | Gap — only "closed" is archived |
| Search within archive | Must be able to find old tickets by keyword | Low | Exists |
| Filter by category and tags | Same filtering power as main list | Low | Exists |
| Closed date filter | "Show me tickets closed in Q1 2025" — essential for audits | Low-Med | Gap |
| Link to full ticket detail | Click a row to open the ticket | Low | Exists |
| Reopen ticket from archive | Move closed → open if issue recurs | Low | Exists (status change) |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Closed date range filter | Enables period-based review ("what did I close last month?") | Low | A dateFrom/dateTo pair on closedAt |
| Archive summary stats header | Count of total archived tickets, by category breakdown, avg resolution time — at-a-glance | Low-Med | Adds value, single aggregate query |
| Bulk reopen | Select multiple tickets, reopen all at once | Medium | Rarely needed for single user, defer |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Permanent deletion from archive | Losing historical data defeats the purpose | Keep all tickets, archive is read-oriented |
| Separate archive database / table | Overengineering — status filter is sufficient | Keep using status-based filtering |
| Auto-purge old closed tickets | Loss of historical KPI data | Never delete — compress or export if space matters |

### Single-User Considerations

For a single-user tool, the archive primarily serves as:
- **Historical audit trail** — "what did I close in March?"
- **Pattern recognition** — "do the same network issues keep recurring?"
- **CSV export target** — archive CSV export for reporting to management

The "resolved vs. closed" distinction matters here. The system auto-closes resolved tickets after X days. Users expect both states in the archive, not just `closed`. The fix is changing the Archive page's status filter from `status: 'closed'` to an OR filter `status IN ('resolved', 'closed')`.

### MVP Recommendation for Archive

Prioritize in this order:
1. Include `resolved` tickets in the archive view (one-line filter change, high impact)
2. Add `closedAt` / `resolvedAt` date range filter (dateFrom, dateTo params)
3. Defer bulk operations and summary stats — the page already works well

---

## 3. Knowledge Base

### Table Stakes

| Feature | Why Expected | Complexity | Current State |
|---------|--------------|------------|---------------|
| Full-text search across article content | KB is useless at 30+ articles without real search | Low-Med | Gap — LIKE works but degrades |
| Article categories / organization | Browse by topic, not just search | Low | Exists (categories CRUD with colors) |
| Ticket↔KB two-way linking | From ticket: link to relevant article. From article: see which tickets reference it | Med | Half built — ticket→KB exists, KB→ticket missing |
| Article type distinction (guide vs. solution) | Guides are evergreen how-tos; solutions are specific to a ticket pattern — different read context | Low | Gap — no article_type field |
| Rich text editor with images | KB articles need formatting | Low | Exists (Tiptap with image upload) |
| Public sharing of articles | Send article to requester without them needing login | Low | Exists (share tokens) |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Search result highlighting | Show matching snippets in search results, not just article titles | Low-Med | SQLite FTS5 provides this natively via `snippet()` |
| "Related articles" suggestions | When viewing an article, see topically related ones | Med | Can be simple: same category, or same-ticket co-links |
| Article view count / "usefulness" | Know which articles are actually read and referenced | Low | Increment a `views` counter on GET |
| Inline article creation from ticket | "Convert solution to KB article" button in ticket detail | Med | Very high value for workflow: close ticket → document solution |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Version history / article revisions | Overengineering for single-user internal KB | Simple "last updated" timestamp is sufficient |
| Comments on articles | No audience — single user writes and reads | No implementation needed |
| Article approval workflows | Only one user, no need for draft/published state machine | A simple "published" boolean is sufficient if needed later |
| Tag system separate from ticket tags | Two separate tag taxonomies creates confusion | If tagging articles, reuse the ticket tag concept or skip |

### Full-Text Search: LIKE vs FTS5

The current LIKE implementation works for small article counts (under 20). It degrades with:
- Articles containing long HTML content (FTS5 indexes text, LIKE scans raw HTML)
- Searches matching word parts incorrectly (LIKE `%network%` matches "networking" AND "subnetwork")
- No result ranking (all matches are equally relevant regardless of frequency)

SQLite FTS5 is the correct solution for this stack:
- Already available in the SQLite distribution bundled with better-sqlite3
- Requires creating a virtual `kb_articles_fts` table that mirrors `kb_articles`
- Supports `snippet()` for highlighted excerpts in search results
- Maintains itself via triggers on INSERT/UPDATE/DELETE of `kb_articles`
- Queries use `kb_articles_fts MATCH 'query'` with BM25 ranking

This is a migration task (one SQL migration), not a library change.

### Two-Way Ticket↔KB Linking: What's Missing

The database schema (`ticket_kb_links`) and the ticket-side UI (`TicketLinks` component, which handles ticket↔ticket links separately from KB) support the connection. The gap is:

**Ticket → KB** (working):
- `GET /api/kb/ticket/:ticketId` — lists KB articles linked to a ticket
- `POST /api/kb/ticket/:ticketId` — link an article to a ticket
- `DELETE /api/kb/ticket/:ticketId/:articleId` — unlink
- Frontend: Ticket detail has this panel (confirmed in TicketDetail.tsx)

**KB → Ticket** (missing):
- No `GET /api/kb/articles/:id/tickets` endpoint
- No UI in `KBArticleDetail.tsx` showing linked tickets
- No link from an article view back to the tickets it helped resolve

The fix requires: one new API endpoint + one new UI section in KBArticleDetail.

### Article Types: Guide vs. Solution

The distinction matters for two reasons:
1. **Reading context**: A how-to guide is browsed proactively. A ticket solution is looked up when the same issue recurs. They are used differently.
2. **Discovery**: Guides belong in a "documentation" browse flow. Solutions belong in the "ticket resolution" flow (e.g. "suggest KB articles similar to this ticket's category/tags").

Implementation is simple: add an `article_type` column (`'guide' | 'solution' | null`) to `kb_articles`. Default null means uncategorized. The UI adds a type selector in the article form and a type badge/filter in the article list.

This is the minimal version. The full Confluence/Notion approach (nested pages, templates, etc.) is out of scope for a single-user internal tool.

### MVP Recommendation for KB

Prioritize in this order:
1. Two-way linking: add `GET /api/kb/articles/:id/tickets` and a "Linked Tickets" section in KBArticleDetail — closes the most visible gap
2. Article type field: one DB column, one form select, one list filter — small effort, high organizational value
3. FTS5 search: one migration, backend query change, and snippet display in frontend — meaningful improvement once the KB grows beyond 20 articles

Defer: Related articles suggestions, view counters, inline article creation from ticket (these are valuable but not blocking)

---

## Feature Dependencies

```
Archive shows resolved tickets → requires changing status filter from ['closed'] to ['resolved', 'closed']

KB two-way linking →
  backend: GET /api/kb/articles/:id/tickets
  frontend: KBArticleDetail linked-tickets section

KB FTS5 search →
  DB migration: CREATE VIRTUAL TABLE kb_articles_fts
  backend: replace LIKE queries with MATCH queries
  frontend: render snippet highlights in search results

Reports category chart →
  backend: /api/reports/by-category endpoint (or compute client-side from existing /api/tickets data)
  frontend: new BarChart or PieChart section in Reports.tsx

Reports open/closed trend →
  client-side computation from existing tickets data (no new endpoint needed)
  frontend: new AreaChart or LineChart with two series
```

---

## Patterns from Reference Tools

### Jira / Linear — Reports
- Both offer "created vs. resolved" overlay as the primary trend chart
- Both show cycle time (time from open to close) as a key metric
- Both allow filtering the chart by time range via a date picker
- Linear emphasizes "backlog growth" as the headline metric
- Neither offers PDF from reports; both rely on CSV or screenshot

### Zendesk — Archive / Ticket Management
- "Closed" and "Solved" (resolved) both live outside the active queue
- Archive is a filter preset, not a separate concept — closed tickets simply aren't shown in active views
- Zendesk's "Views" are saved filters; the concept maps to the existing FilterPresets in this codebase
- Date range filter on "solved date" is a first-class filter in Zendesk

### Notion — Knowledge Base
- No distinction between article types — all articles are documents
- Search is full-text, ranked, with inline highlighting
- "Backlinks" (pages that link to this page) is a core feature — the KB→Ticket reverse link pattern maps directly to Notion backlinks
- Categories are implemented as databases with select properties — the existing `kb_categories` table is the right abstraction

### Freshdesk — Knowledge Base
- Distinguishes "Solution articles" from "How-to articles" via article type field
- Solution articles are discoverable from tickets in the same category
- Article search uses full-text with relevance ranking
- Agents can "insert solution" directly from ticket reply — maps to the "inline article creation from ticket" feature

---

## Sources

- Direct codebase inspection: `src/pages/Reports.tsx`, `src/pages/Archive.tsx`, `src/pages/KnowledgeBase.tsx`, `src/pages/KBArticleDetail.tsx`, `server/src/routes/kb.ts`, `server/src/routes/tickets.ts`, `server/src/db/schema.sql`
- Established patterns: Jira Software reporting, Linear cycle time charts, Zendesk ticket views, Notion backlinks, Freshdesk solution articles
- SQLite FTS5 documentation (knowledge cutoff August 2025): FTS5 is available in SQLite 3.9+ and is bundled with better-sqlite3
- Confidence: HIGH for all three areas — gaps identified by direct code inspection, not speculation
