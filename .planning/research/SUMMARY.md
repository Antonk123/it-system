# Project Research Summary

**Project:** IT Ticket System — Reports, Archive, KB Milestone
**Domain:** Single-user internal IT ticket management
**Researched:** 2026-03-22
**Confidence:** HIGH

---

## Executive Summary

The codebase is significantly more complete than the PROJECT.md "Active" list implies. Direct inspection found that Reports, Archive, and KB each have a large working core — the milestone is about closing specific, well-defined gaps rather than building features from scratch. This changes the effort profile: each area needs 1-3 targeted additions, not redesigns. The implementation risk is low because the schema already supports every required feature; the work is mostly new API endpoints and new frontend panels wired to existing data structures.

The recommended approach is to move all analytics aggregation from the frontend (where it currently runs on a paginated subset of tickets) to the backend via a new `/api/reports/summary` endpoint using SQL `GROUP BY` queries. This is the highest-priority fix in the whole milestone because the current architecture silently produces incorrect charts. For KB, FTS5 is a single migration with no new packages; it is the right call and already confirmed to be compiled into the bundled SQLite. For PDF export, the user's decision to use print CSS (`window.print()`) eliminates the only potential new dependency (`@react-pdf/renderer`) — zero new packages are required.

The primary risks are: (1) the analytics-on-paginated-data bug in Reports.tsx must be fixed before any chart work, or new charts will inherit the same bug; (2) FTS5 indexes raw Tiptap HTML, which bloats the index with tag tokens — a simple regex strip before indexing prevents this; (3) the Archive page currently excludes `resolved` tickets, but the user has confirmed that `closed`-only is the correct behavior for this system, so this is not a gap to fix.

---

## Key Findings

### Recommended Stack

The existing stack handles everything in this milestone without new packages. `better-sqlite3` v11 bundles SQLite 3.46+ with FTS5 compiled in — no build flags or additional packages needed. `recharts` is already installed and will remain the charting library; it receives pre-aggregated data from the backend rather than raw ticket arrays.

The only package that was researched as a candidate addition (`@react-pdf/renderer ^4.x`) is not needed given the print CSS decision. CSV export already works via a hand-rolled generator. The net result: zero new dependencies for this milestone.

**Core technologies (unchanged):**
- `better-sqlite3` v11 — synchronous SQLite with FTS5 built in; all new queries follow existing `db.prepare().get()/.all()` patterns
- `recharts` — remains the chart renderer; fed pre-shaped data from `/api/reports/summary` instead of raw ticket arrays
- React Query — used for the new `useReportsSummary()` and `useArticleTickets()` hooks, following the existing hook pattern
- Express Router — new `reports.ts` route file mounted at `/api/reports`, new endpoint added to `kb.ts`

### Expected Features

Based on codebase inspection against what the milestone targets:

**Already built (do not re-implement):**
- Reports: KPI cards, bar/pie charts, heatmap, status flow, tag analytics, requester analytics, module toggle, CSV export, year/month filter
- Archive: `/archive` route, closed-ticket filter, search, category/tag/priority filters, sort, pagination, compact view, CSV/import, reopen dialog
- KB: Tiptap CRUD, category management, LIKE search, ticket→KB links (API + UI), public share tokens

**Must close (table stakes gaps):**
- Reports: category breakdown chart — connects existing `categories` table to charts; one new backend query
- Reports: open vs. closed trend overlay — compute from existing ticket data; one new chart replacing/supplementing current "created" bar chart
- KB: KB→ticket reverse links — one new endpoint (`GET /api/kb/articles/:id/tickets`) and one new panel in `KBArticleDetail`
- KB: FTS5 search — one migration (`ensureKbArticlesFts()`), one query change in `kb.ts`, snippet display in frontend
- KB: `article_type` field — one new column, one form select, one list filter badge

**Should close (differentiators):**
- Reports: PDF via print CSS — `@media print` stylesheet, `window.print()` button; zero dependencies
- Archive: closed-date range filter (`dateFrom`/`dateTo` on `closed_at`) — adds audit/period-review capability

**Defer:**
- Reports: arbitrary date range picker (year/month dropdowns are sufficient)
- KB: related article suggestions, view counters, inline article creation from ticket
- Archive: bulk reopen, summary stats header
- Archive: including `resolved` tickets — user confirmed `closed`-only is correct behavior

### Architecture Approach

Every feature in this milestone follows the same pattern as the existing codebase: Express Router file per domain, synchronous `better-sqlite3` queries, React Query hooks on the frontend, `useTickets()`-style hooks for data fetching. No new patterns are introduced. Schema changes are limited to: one FTS5 virtual table + 3 triggers (KB search), one `article_type` column (KB types), and one composite index on `(status, closed_at)` (archive performance). All migrations are idempotent `ensure*` functions called from `initializeDatabase()`.

**Change surface per feature area:**

| Feature | Schema | New Route/Endpoint | Modified Route | New Frontend |
|---------|--------|--------------------|----------------|--------------|
| Reports aggregation | None | `GET /api/reports/summary` | None | `Reports.tsx` wired to new endpoint |
| Reports category chart | None | Included in summary endpoint | None | New chart in Reports.tsx |
| Reports open/closed trend | None | Included in summary endpoint | None | New chart in Reports.tsx |
| Reports print CSS PDF | None | None | None | `@media print` CSS + button |
| Archive closed-date filter | Index only | None | `GET /api/tickets` (params) | Date inputs in Archive.tsx |
| KB two-way links | None | `GET /api/kb/articles/:id/tickets` | None | Linked tickets panel in KBArticleDetail |
| KB FTS5 | Virtual table + triggers | None | `GET /api/kb/articles` (search path) | Snippet display in search results |
| KB article type | `article_type` column | None | KB CRUD routes (include new field) | Type select in form, badge in list |

### Critical Pitfalls

1. **Analytics computed on paginated data** — `Reports.tsx` currently calls `useTickets()` without a limit override, meaning all `useMemo` aggregations run on one page (10 tickets) of data, not the full dataset. Fix this first, before adding any new charts. All aggregation must move to `/api/reports/summary` using SQL `GROUP BY`. Detection: charts show suspiciously small or round numbers.

2. **FTS5 indexing raw Tiptap HTML** — If `kb_articles.content` (which stores HTML like `<p><strong>password</strong></p>`) is inserted directly into the FTS table, the tokenizer will index tag strings (`p`, `strong`, `href`, `class`) as searchable tokens. Strip HTML with a regex (`content.replace(/<[^>]+>/g, ' ')`) in the Express route before inserting to the FTS table. The stripping must happen in Node.js, not inside a SQLite trigger, because SQLite triggers cannot call external code.

3. **FTS5 user input causes SQLite errors** — FTS5 MATCH syntax treats `+`, `-`, `*`, `[`, `"` as operators. A user searching for `C++` will crash the query. Wrap all user search terms in double quotes: `"${term.replace(/"/g, '""')}"`. Add a try/catch at the route level with fallback to LIKE if FTS5 throws.

4. **FTS5 rowid vs UUID join** — `kb_articles` uses a TEXT UUID primary key. The FTS5 `content_rowid='rowid'` maps to the internal integer rowid, not the UUID `id`. Search results must join back to `kb_articles` via `a.rowid = fts.rowid`, not via `a.id`. Getting this wrong returns no results or wrong rows with no obvious error.

5. **CSV export `SELECT *` and in-memory build** — The existing export route uses `SELECT *` (known tech debt) and builds the full CSV string in memory before sending. For a new reports-specific export, use `SELECT ${TICKET_COLUMNS}` and `stmt.iterate()` with `res.write()` streaming. Do not extend the current hand-rolled generator for the reports export path.

---

## Implications for Roadmap

Based on dependencies and risk profile, three phases are the right structure.

### Phase 1: Reports Backend Fix + New Charts

**Rationale:** The current analytics architecture is broken (paginated data). This must be fixed before any UI work, or new charts inherit the same bug. The backend endpoint is a prerequisite for all chart additions.

**Delivers:**
- `GET /api/reports/summary` with pre-aggregated data (status counts, category counts, monthly trend with open/closed split)
- All SQL aggregation moved out of the frontend
- Category breakdown chart (new)
- Open vs. closed trend overlay (new)
- Print CSS `@media print` stylesheet + print button (PDF — zero dependencies)

**Key pitfalls to avoid:**
- Do not let any chart computation remain in `useMemo` on raw ticket arrays after this phase
- Use `strftime` for all date grouping in SQL, never `new Date().getMonth()` in JS
- Only mount chart components for the active tab (not all tabs simultaneously)

**Research flag:** Standard patterns — no additional research needed. SQL `GROUP BY` + recharts is well-documented.

---

### Phase 2: KB Improvements (FTS5 + Two-Way Links + Article Types)

**Rationale:** These three KB features are independent of Reports but share the same migration deployment window. FTS5 migration and the `article_type` column should ship together to avoid multiple schema deployments. Two-way linking is pure endpoint + UI with no schema change, so it can slot into the same phase.

**Delivers:**
- `ensureKbArticlesFts()` migration: FTS5 virtual table, 3 sync triggers, initial population from existing articles
- Search upgraded from LIKE to FTS5 MATCH with BM25 ranking
- Snippet highlighting in search results (`<mark>` tags via `snippet()`)
- `GET /api/kb/articles/:id/tickets` endpoint using the existing `idx_ticket_kb_links_article` index
- "Linked Tickets" panel in `KBArticleDetail` with links to `/tickets/:id`
- `article_type` column (`'guide' | 'solution'`), type selector in KB article form, type badge + filter in KB article list

**Key pitfalls to avoid:**
- Strip HTML before FTS5 insert (regex in Node.js route, not in trigger)
- Wrap FTS5 user queries in double quotes; add try/catch with LIKE fallback
- Join FTS results to `kb_articles` via `rowid`, not `id`
- Run `INSERT INTO kb_articles_fts(kb_articles_fts) VALUES('rebuild')` at end of migration to ensure index is consistent
- Show pre-delete warning count when deleting an article that has linked tickets

**Research flag:** FTS5 mechanics are well-documented in official SQLite docs. No additional research needed. The rowid vs UUID join pattern is confirmed and coded in ARCHITECTURE.md.

---

### Phase 3: Archive Filter Enhancement

**Rationale:** Archive is the most complete feature already. The one meaningful addition is a closed-date range filter for period-based audits. This is a low-risk, low-complexity addition that does not touch the schema (only adds query parameters to the existing endpoint and date inputs to Archive.tsx).

**Delivers:**
- `dateFrom` / `dateTo` query parameters on `GET /api/tickets` (or a new archive-specific endpoint) filtering on `closed_at`
- Date range inputs in Archive.tsx filter bar
- Composite index `idx_tickets_closed_at ON tickets(status, closed_at DESC)` for query performance

**Key pitfalls to avoid:**
- After a status change (reopen from archive), explicitly invalidate the React Query cache so the ticket disappears from the list immediately
- Show a toast with a link to the ticket's new location when it disappears from the archive after reopening
- Use UTC-consistent date comparison in SQL (`closed_at >= ? AND closed_at < ?` with ISO strings)

**Research flag:** Standard patterns — no additional research needed.

---

### Phase Ordering Rationale

- Phase 1 must come first because the broken analytics foundation makes new chart work pointless until fixed.
- Phase 2 groups all three KB changes to minimize migration deployments (one Docker restart covers all schema changes).
- Phase 3 is last because Archive already works and the addition is cosmetic/filtering only — lowest risk, highest tolerance for shifting if earlier phases run long.
- The print CSS PDF approach (Phase 1) avoids the `@react-pdf/renderer` dependency entirely, keeping the build clean and the Docker image unchanged.

### Research Flags

Phases with standard patterns (no additional research needed):
- **Phase 1:** SQL GROUP BY aggregation + recharts — textbook patterns, fully documented
- **Phase 2:** FTS5 mechanics fully confirmed via official SQLite docs; rowid join pattern coded in ARCHITECTURE.md; two-way link schema already exists
- **Phase 3:** Date range filtering on an existing paginated endpoint — no novel patterns

No phases require a `/gsd:research-phase` call before implementation.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Based on direct `package.json` inspection; better-sqlite3 v11 FTS5 inclusion confirmed |
| Features | HIGH | Based on direct codebase inspection of all affected source files; gaps are confirmed absences, not inferences |
| Architecture | HIGH | Direct inspection of `schema.sql`, `connection.ts`, `kb.ts`, `tickets.ts`, `index.ts`; all patterns verified |
| Pitfalls | HIGH (SQLite/CSV), MEDIUM (recharts) | SQLite and CSV pitfalls verified in source; recharts tab-render pitfall is training knowledge |

**Overall confidence: HIGH**

### Gaps to Address

- **HTML stripping quality:** The regex approach (`/<[^>]+>/g`) handles standard HTML but may misbehave on malformed Tiptap output (unclosed tags, inline `<script>` from copy-paste). Monitor FTS search quality after deployment; upgrade to `striptags` package if needed.
- **FTS5 Swedish stemming:** The `unicode61` tokenizer does not stem Swedish words. Searching "lösenord" will not match "lösenordets". This is acceptable for now but should be documented for users. No fix is needed in this milestone.
- **recharts tab performance:** The claim that inactive tabs cause layout thrash is based on established recharts patterns, not live profiling. Verify during Phase 1 implementation and apply conditional rendering if visible.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/pages/Reports.tsx`, `src/pages/Archive.tsx`, `src/pages/KnowledgeBase.tsx`, `src/pages/KBArticleDetail.tsx`, `server/src/routes/kb.ts`, `server/src/routes/tickets.ts`, `server/src/db/schema.sql`, `server/src/db/connection.ts`
- SQLite FTS5 official documentation: https://www.sqlite.org/fts5.html
- SQLite strftime documentation: https://www.sqlite.org/lang_datefunc.html
- `.planning/codebase/CONCERNS.md` — confirmed tech debt and known bugs

### Secondary (MEDIUM confidence)
- `@react-pdf/renderer` GitHub — evaluated and ruled out in favor of print CSS
- recharts ResponsiveContainer behavior — established community patterns
- Jira, Linear, Zendesk, Notion, Freshdesk — reference patterns for feature expectations

---

*Research completed: 2026-03-22*
*Ready for roadmap: yes*
