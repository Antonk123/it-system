# Phase 2: Knowledge Base Rework - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

KB search uses FTS5 full-text indexing with snippet highlighting in results. KB articles link back to the tickets that reference them via a "Linked Tickets" panel. Articles carry an optional type classification ("how-to" or "solution") visible in the list and filterable.

</domain>

<decisions>
## Implementation Decisions

### Search result presentation
- **D-01:** FTS5 snippet replaces the current raw content preview in the article list — show the matched excerpt (with highlight markup) instead of the first N characters of HTML
- **D-02:** Highlight markup: wrap matched terms in `<mark>` tags; style with a subtle background in the existing theme (no custom color needed — shadcn's default `mark` styling or a tailwind utility)
- **D-03:** Articles with no search query active show a plain content excerpt (strip HTML, truncate to ~120 chars) — same as today but cleanly stripped
- **D-04:** No match count badge or result ranking indicator in the UI — FTS5 rank is used for ordering but not surfaced

### Linked Tickets panel
- **D-05:** Panel appears below the article content in KBArticleDetail, above the footer actions
- **D-06:** Each row shows: ticket title (linked to ticket detail), status badge, priority badge — same badge components used elsewhere in the app
- **D-07:** Empty state: "Ingen biljett är länkad till den här artikeln" (no illustration needed — plain text is fine)
- **D-08:** Panel is always visible (not collapsed/expandable) — it's a small addition and the list will typically be short

### Article type UX
- **D-09:** Type badge in article list sits next to the category badge on the same line — small, secondary styling
- **D-10:** Badge labels: "Instruktion" (how-to) and "Lösning" (solution) — Swedish to match the rest of the UI
- **D-11:** Articles with `article_type = null` show no badge — no "Okategoriserad" label
- **D-12:** Type filter in KnowledgeBase list: a third dropdown alongside the existing category dropdown — same Select component pattern, options: All / Instruktion / Lösning
- **D-13:** Type selector in KBArticleForm: a Select field below the category selector, optional (no required validation)

### Claude's Discretion
- FTS5 virtual table name, trigger naming, HTML-stripping approach (regex vs. simple tag removal)
- Whether to use a migration file or inline db.exec in the route init
- Exact snippet fragment length passed to SQLite's `snippet()` function
- Exact positioning/spacing of the Linked Tickets panel
- Badge color choice for how-to vs. solution types

</decisions>

<specifics>
## Specific Ideas

- The `ticket_kb_links` table (ticket→article direction) already exists and is populated — the new endpoint is just the reverse query: `SELECT tickets.* FROM tickets JOIN ticket_kb_links ON tickets.id = ticket_kb_links.ticket_id WHERE ticket_kb_links.article_id = ?`
- FTS5 content must have HTML stripped before indexing (KB-02) — Tiptap stores HTML, so `<p>`, `<strong>`, `<a class="...">` etc. would pollute tokens without stripping
- The existing `GET /api/kb/articles?search=` endpoint should be replaced (not duplicated) with the FTS5-backed version — same URL, different implementation

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in REQUIREMENTS.md and decisions above.

### Requirements
- `.planning/REQUIREMENTS.md` — KB-01 through KB-05 define the must-haves for this phase

### Existing code (must read before planning)
- `server/src/routes/kb.ts` — current search implementation (LIKE-based), existing ticket-link endpoints, article CRUD
- `server/src/db/add-kb-tables.ts` — existing schema: `kb_articles`, `kb_categories`, `ticket_kb_links`
- `src/pages/KnowledgeBase.tsx` — article list with search input and category filter
- `src/pages/KBArticleDetail.tsx` — article detail page (insert Linked Tickets panel here)
- `src/pages/KBArticleForm.tsx` — article create/edit form (insert type selector here)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Badge` component (shadcn): used for category and status badges throughout — use for type badge and ticket status/priority in the Linked Tickets panel
- `Select` component (shadcn): used for category filter in KnowledgeBase.tsx — use same pattern for type filter and type selector in form
- `ticket_kb_links` table: already has indexes on both `ticket_id` and `article_id` — reverse query is O(log n)
- `HtmlRenderer` component: used in KBArticleDetail to render article content — relevant for understanding how content is currently displayed

### Established Patterns
- DB migrations: standalone `.ts` files in `server/src/db/` run with `npx tsx` — follow same pattern for FTS5 migration and `article_type` column
- API routes: all in `server/src/routes/`, registered in `server/src/index.ts` — no new route file needed, add to `kb.ts`
- Swedish UI strings: all user-facing text is Swedish ("Inga artiklar hittades", "Hämtar...", etc.) — maintain this

### Integration Points
- FTS5 virtual table syncs via triggers on `kb_articles` INSERT/UPDATE/DELETE
- New `GET /api/kb/articles/:id/tickets` slots into existing `kb.ts` router
- `article_type` column added via migration; existing article CRUD endpoints updated to read/write the new field

</code_context>

<deferred>
## Deferred Ideas

None — discussion was skipped, scope matches ROADMAP.md exactly.

</deferred>

---

*Phase: 02-knowledge-base-rework*
*Context gathered: 2026-03-22*
