# Phase 09: Discoverability & Workflow — Cross-refs, Popular, Shortcuts - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Elevate the KB from a document store to a connected, navigable system with power-user shortcuts. Delivers: popular articles section on KB home, "Se även" cross-references between articles, `/` keyboard shortcut for KB search, and "Skapa KB-artikel" button on ticket detail.

**Requirements covered:** DISC-02, DISC-03, DISC-04, WF-02, WF-03

</domain>

<decisions>
## Implementation Decisions

### Popular Articles (DISC-02)
- **D-01:** "Populära artiklar" section on KB home page, below "Senast uppdaterade" section
- **D-02:** Shows top 5 articles sorted by `view_count` descending
- **D-03:** Only articles with `view_count > 0` qualify; section hidden if none qualify
- **D-04:** Same card/list style as "Senast uppdaterade" for visual consistency
- **D-05:** Only published articles shown (exclude drafts)

### Cross-References — "Se även" (DISC-03, DISC-04)
- **D-06:** New `kb_article_links` join table with `source_article_id` and `target_article_id` columns
- **D-07:** Bidirectional display: if A links to B, B's detail page also shows A in its "Se även" panel
- **D-08:** Storage is directional (only one row per link), but queries fetch both directions
- **D-09:** Link picker in article edit form: search/autocomplete dropdown to find and add related articles (similar UX to existing tag input)
- **D-10:** "Se även" panel displayed on article detail page below article content, above linked tickets section
- **D-11:** Each cross-ref shown as clickable link with article title and type badge

### Keyboard Shortcut — `/` (WF-02)
- **D-12:** Global keyboard shortcut: pressing `/` focuses the KB search input on the KnowledgeBase page
- **D-13:** Shortcut suppressed when user is focused on text input, textarea, or contenteditable element
- **D-14:** No visual indicator needed (standard convention) — but search input can show a subtle kbd hint

### Ticket-to-KB Creation (WF-03)
- **D-15:** "Skapa KB-artikel" button placed in the KBLinksSection area on ticket detail page
- **D-16:** Button navigates to KBArticleForm with query params: `?title={ticket.title}&article_type=solution`
- **D-17:** KBArticleForm reads query params to pre-fill title and article_type fields
- **D-18:** After article creation, optionally auto-link the new article back to the source ticket

### Claude's Discretion
- Exact styling of the "Se även" panel (cards vs simple links)
- Whether the popular section uses a different icon than "Senast uppdaterade"
- Search/autocomplete component implementation details for link picker
- Whether to show a small `⌘/` or just `/` kbd hint near the search input

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### KB Implementation (Prior Phases)
- `.planning/phases/07-kb-foundations-tags-status-view-count-quick-wins/07-01-PLAN.md` — Backend schema for kb_articles (tags, status, view_count)
- `.planning/phases/07-kb-foundations-tags-status-view-count-quick-wins/07-02-PLAN.md` — Frontend KB components and patterns
- `.planning/phases/08-content-quality-toc-templates-staleness/08-CONTEXT.md` — Phase 8 decisions (ToC, templates, staleness)

### Requirements
- `.planning/REQUIREMENTS.md` — DISC-02, DISC-03, DISC-04, WF-02, WF-03 definitions

### Key Source Files
- `src/pages/KnowledgeBase.tsx` — KB home page (popular section + `/` shortcut go here)
- `src/pages/KBArticleDetail.tsx` — Article detail ("Se även" panel goes here)
- `src/pages/KBArticleForm.tsx` — Article form (link picker + query param pre-fill go here)
- `src/pages/TicketDetail.tsx` — Ticket detail ("Skapa KB-artikel" button goes here)
- `src/components/KBLinksSection.tsx` — Existing KB links on ticket detail
- `server/src/routes/kb.ts` — KB API routes (cross-ref endpoints go here)
- `server/src/db/connection.ts` — Schema migrations (kb_article_links table)
- `src/lib/api.ts` — API client (new cross-ref methods)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `KBLinksSection` component on ticket detail — "Skapa KB-artikel" button integrates here
- `view_count` column already exists and increments on article view — popular section queries this
- "Senast uppdaterade" section pattern on KB home — reuse layout for popular section
- Tag input autocomplete pattern from Phase 7 — reuse for cross-ref link picker
- `Badge` component — for article type badges in cross-ref display
- `slugify` function in KBArticleDetail — if needed for anchor links

### Established Patterns
- KB articles fetched via `api.getKbArticle(id)` / `api.getKbArticles()`
- Schema migrations added in `server/src/db/connection.ts` using ALTER TABLE / CREATE TABLE
- Join tables pattern: `kb_article_tags` (Phase 7) — reuse for `kb_article_links`
- Filter state managed in parent components
- Swedish UI text throughout

### Integration Points
- `KnowledgeBase.tsx` — Add popular section below "Senast uppdaterade", add `/` keydown listener
- `KBArticleDetail.tsx` — Add "Se även" panel below content
- `KBArticleForm.tsx` — Add cross-ref link picker, read query params for pre-fill
- `TicketDetail.tsx` / `KBLinksSection.tsx` — Add "Skapa KB-artikel" button
- `server/src/routes/kb.ts` — CRUD endpoints for cross-references
- `server/src/db/connection.ts` — Migration for `kb_article_links` table

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. All UI text in Swedish.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-discoverability-workflow-cross-refs-popular-shortcuts*
*Context gathered: 2026-03-29*
