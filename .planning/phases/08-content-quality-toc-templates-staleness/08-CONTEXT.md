# Phase 08: Content Quality — ToC, Templates & Staleness - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the KB a trustworthy reference with structured content, templates for consistency, and staleness detection. Delivers: table of contents on article detail, article templates on creation, and staleness tracking with filter.

**Requirements covered:** QUAL-02, QUAL-03, TMPL-01, TMPL-02, TOC-01, TOC-02

</domain>

<decisions>
## Implementation Decisions

### Table of Contents (TOC-01, TOC-02)
- **D-01:** ToC rendered as sticky sidebar on desktop (right side), collapsible section above content on mobile
- **D-02:** ToC generated client-side by parsing h1-h6 from the rendered HTML (HtmlRenderer already allows all heading tags via DOMPurify)
- **D-03:** Anchor links use slugified heading text as IDs, injected into the rendered HTML
- **D-04:** ToC only shows when article has 2+ headings — otherwise hidden

### Article Templates (TMPL-01, TMPL-02)
- **D-05:** Template picker shown only when creating a new article (not when editing)
- **D-06:** Picker appears as card buttons above the form — selecting a template fills the Tiptap editor with predefined HTML structure
- **D-07:** Three hardcoded templates:
  - **Solution** — Problem / Orsak / Lösning / Förebyggande
  - **How-to** — Förutsättningar / Steg / Verifiering
  - **Troubleshooting** — Symptom / Diagnos / Åtgärd
- **D-08:** User can dismiss the picker and start with blank article
- **D-09:** Templates are frontend-only constants — no database table (per Out of Scope: "Mall-CRUD")

### Staleness Detection (QUAL-02, QUAL-03)
- **D-10:** New column `last_reviewed_at` (ISO timestamp, nullable) on `kb_articles`
- **D-11:** "Markera som granskad" button on article detail page sets `last_reviewed_at = NOW()`
- **D-12:** Staleness threshold: 90 days since last review (or since creation if never reviewed)
- **D-13:** KB list gets a "Visa inaktuella" filter toggle that shows only articles where `last_reviewed_at` (or `created_at`) is older than 90 days
- **D-14:** Stale articles get a subtle visual indicator (badge or icon) in the KB list

### Claude's Discretion
- ToC scroll-spy behavior (highlight active heading) — implement if straightforward
- Exact styling of template picker cards
- Stale badge color/icon choice

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### KB Implementation
- `.planning/phases/07-kb-foundations-tags-status-view-count-quick-wins/07-01-PLAN.md` — Backend schema for kb_articles (tags, status, view_count)
- `.planning/phases/07-kb-foundations-tags-status-view-count-quick-wins/07-02-PLAN.md` — Frontend KB components and patterns
- `.planning/REQUIREMENTS.md` — QUAL-02, QUAL-03, TMPL-01, TMPL-02, TOC-01, TOC-02 definitions

### Key Source Files
- `src/pages/KBArticleDetail.tsx` — Article detail page (ToC and review button go here)
- `src/pages/KBArticleForm.tsx` — Article form (template picker goes here)
- `src/pages/KnowledgeBase.tsx` — KB list (staleness filter goes here)
- `src/components/HtmlRenderer.tsx` — HTML rendering with DOMPurify (ToC heading extraction source)
- `server/src/routes/kb.ts` — KB API routes (staleness endpoint changes)
- `server/src/db/add-kb-tables.ts` — KB schema reference

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `HtmlRenderer` — Already sanitizes and renders h1-h6 headings. ToC can parse the same HTML.
- `Badge` component — Can be used for stale indicator
- Tiptap `RichTextEditor` — Template content injected via editor API
- `@media print` pattern — Already established in KBArticleDetail

### Established Patterns
- KB articles fetched via `api.getKbArticle(id)` returning `KbArticleRow`
- Schema migrations in `server/src/db/` as standalone scripts
- Filter state managed in parent components, passed to filter bars
- Tags stored as join table `kb_article_tags` (Phase 7 pattern)

### Integration Points
- `KBArticleDetail.tsx` — Add ToC sidebar + "Markera som granskad" button
- `KBArticleForm.tsx` — Add template picker (new article only)
- `KnowledgeBase.tsx` — Add staleness filter toggle
- `server/src/routes/kb.ts` — Add `PATCH /api/kb/articles/:id/review` endpoint
- `server/src/db/` — Migration for `last_reviewed_at` column

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Templates use Swedish headings to match the rest of the UI.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-content-quality-toc-templates-staleness*
*Context gathered: 2026-03-29*
