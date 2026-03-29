# Feature Landscape: Knowledge Base Expansion (v1.2)

**Domain:** Internal IT knowledge base (single-user, SQLite, Tiptap rich text)
**Researched:** 2026-03-29
**Confidence:** HIGH — direct codebase analysis of all KB files + domain knowledge of mature KB systems

---

## What Already Exists (Baseline)

These are fully implemented. Do not rebuild them.

| Existing Feature | Implementation |
|-----------------|----------------|
| Article CRUD (create / edit / delete) | `KBArticleForm.tsx`, `KBArticleDetail.tsx`, `POST/PUT/DELETE /api/kb/articles` |
| Tiptap rich text editor + image upload | `RichTextEditor` component, `POST /api/kb/upload-image`, served at `/api/kb/images/:filename` |
| FTS5 full-text search with `<mark>` snippets | `kb_articles_fts` virtual table, `GET /api/kb/articles?search=` with BM25 rank |
| Category assignment + flat category management | `kb_categories` table (id, name, color, position), inline manager panel on KB list |
| Article type classification (`how-to` / `solution`) + filter | `article_type` column with CHECK constraint, type filter in list UI |
| Linked Tickets reverse-lookup panel on article detail | `ticket_kb_links` table, `GET /api/kb/articles/:id/tickets`, UI in `KBArticleDetail.tsx` |
| Ticket-side KB link panel | `GET/POST/DELETE /api/kb/ticket/:ticketId`, panel on ticket detail page |
| Public share link (token-based, unauthenticated read) | `kb_article_shares` table, `GET /api/kb/public/:token` |

---

## Table Stakes

Features users expect in any internal KB. Missing = KB feels unfinished or untrustworthy.

| Feature | Why Expected | Complexity | Dependency on Existing | Notes |
|---------|-------------|------------|------------------------|-------|
| **Tags on articles** | Categories = coarse grouping. Tags = fine-grained cross-cutting labels. Without them, articles on overlapping topics ("VPN", "Remote Access", "Firewall") are only findable if the user guesses the right category. Tags let one article surface under multiple concepts. | Low | New `kb_article_tags` join table (`article_id`, `tag TEXT`). Tag input in article form. Tag filter chip on KB list. FTS already handles text search. | Store as plain text tags (no `kb_tags` master table). Simple array stored as join rows. |
| **Draft / published status** | Prevents half-written articles appearing in search results and the article list. "Save draft, finish later" is a universal authoring expectation. | Low | Add `status TEXT DEFAULT 'published' CHECK(status IN ('draft','published'))` to `kb_articles`. Filter list/FTS to `published` by default. Add toggle in form. | Backward compat: default to `published`. Draft indicator badge in list. Drafts still accessible via direct link. |
| **Article view count** | Passive signal for "is this article actually useful?" Enables "popular articles" surface. Without it, all articles look equally valuable. For a single-user tool this is trivially accurate — every view is a real read. | Low | Add `view_count INTEGER DEFAULT 0` to `kb_articles`. Increment with `UPDATE ... SET view_count = view_count + 1 WHERE id = ?` on `GET /api/kb/articles/:id`. | No race conditions in single-user SQLite. Show count on article detail page. |
| **"Recently updated" section on KB home** | Users need to know when their reference articles changed. The current list defaults to `updated_at DESC` but has no visual emphasis on recency. A dedicated "Recently updated" section (top 5) makes the home page useful as a "what changed?" overview. | Very Low | `updated_at` column already exists and is indexed. No backend changes. Simple frontend slice of existing data. | Show as a compact "recently updated" strip at the top of the KB home page, above the full article list. |
| **Table of contents (ToC)** | Long how-to guides are unusable without section navigation. Standard expectation in any document-style KB (Confluence, GitBook, Notion, Zendesk Guide). Tiptap headings already exist as `<h1>`, `<h2>`, `<h3>` in the saved HTML. | Medium | No backend changes. Parse heading nodes from article HTML client-side. Render as sticky sidebar or inline ToC block above content in `KBArticleDetail.tsx`. Add `id` anchors to headings via DOM manipulation on render. | Pure frontend. Works with existing Tiptap content immediately. |
| **Print article** | Useful for posting step-by-step instructions near physical hardware. Existing codebase already uses `window.print()` + `@media print` CSS for Reports. Same pattern applies here. | Very Low | Existing `@media print` CSS pattern in codebase. Add a print button to `KBArticleDetail.tsx`. | Copy Reports pattern exactly. No new dependencies. |

---

## Differentiators

Features that make this KB meaningfully better than a flat list of documents. Not assumed to exist, but add real value.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| **Staleness detection** | Articles go stale silently. A `last_reviewed_at` timestamp separate from `updated_at` (which fires on every edit) lets the system flag articles not reviewed in N days. Prevents outdated instructions from being followed confidently. | Medium | Add `last_reviewed_at TEXT` column. Add "Mark as reviewed" button on article detail. Add a "stale articles" filter on KB list (configurable threshold, e.g. 180 days). | Single-user: no workflow. Just a flag. "Stale" badge on card in list. Filter for "needs review". |
| **Article templates** | Pre-fill the Tiptap editor with structure ("Problem", "Cause", "Solution", "Prerequisites", "Steps"). Enforces documentation quality and speeds authoring. Especially valuable for `solution`-type articles that follow a predictable format. | Low-Medium | No schema changes needed for hard-coded templates. Template picker shown when creating a new article. Pre-populates `content` state in `KBArticleForm.tsx` before editor loads. | 2–3 built-in templates is sufficient. No template CRUD needed initially. Templates are hard-coded JSON in frontend. |
| **"See Also" cross-references** | Links an article to other related articles explicitly. Makes the KB a connected graph rather than isolated docs. Users reading about "VPN setup" get pointed to "Certificate renewal" without needing to know the right search term. | Medium | New `kb_article_links` join table (`source_article_id`, `target_article_id`). CRUD endpoint. "See Also" panel on article detail with article picker (reuse existing search). | Separate from ticket links. Unidirectional or bidirectional — recommend bidirectional (both directions shown). |
| **Popular articles surface** | "Most viewed" strip on KB home using `view_count`. Answers "which articles are actually useful?" and surfaces overlooked documentation. | Low | Depends on view_count being implemented (table stakes above). One additional query: `ORDER BY view_count DESC LIMIT 5`. | Add as a section on KB home alongside "recently updated". |
| **Keyboard shortcuts** | Single-user power user tool. Press `/` to focus the search input. `Cmd+K` (or `Ctrl+K`) to open a global search modal from anywhere in the KB. Standard in Notion, Linear, Confluence. | Low | Pure frontend. No backend. Use `useEffect` keydown listeners or a small hotkey hook. The search API already exists. | Very high polish-to-effort ratio. The search endpoint is already fast (FTS5). |
| **"Convert ticket to KB article" shortcut** | After closing a ticket, prompt: "Document this solution in KB?" Pre-fills article title from ticket title and article type as `solution`. Reduces friction for the core KB authoring workflow. | Medium | Ticket detail page context. Pre-populate `KBArticleForm` via URL params (`?fromTicket=:id`). Backend reads ticket title/description on article create. | The ticket-to-KB link is already two-directional via `ticket_kb_links`. This feature just accelerates the creation step. |

---

## Anti-Features

Explicitly do not build these in v1.2.

| Anti-Feature | Why Avoid | What to Do Instead |
|-------------|-----------|-------------------|
| **Article versioning / revision history** | Requires storing every version, diffing HTML, and a version browser UI. Near-zero value for a single-user system where the author knows what they changed. | `updated_at` + "last reviewed" timestamp is sufficient. |
| **Hierarchical categories (sub-categories)** | Nested trees add path-rendering, breadcrumb, and query complexity. For a KB with tens to low-hundreds of articles, flat categories + tags cover the organization need completely. | Flat categories for broad grouping + freeform tags for cross-cutting concerns. |
| **Article comments / discussion** | Single-user system. Discussion belongs on the linked tickets, not the KB article. | Use the ticket comment system for discussion. Link KB article to ticket. |
| **User ratings (thumbs up / down)** | No audience to rate. Self-ratings are meaningless. | Use `view_count` as a passive quality signal. |
| **AI-generated summaries** | Introduces external API dependency (OpenAI etc.) with cost, latency, and privacy concerns. FTS5 snippets already provide contextual previews. | FTS5 `snippet()` function already gives highlighted excerpt previews on search. |
| **Full-text search pagination** | The KB is small (internal single-user IT tool). Paginating 20–200 articles adds complexity with no usability benefit. FTS5 rank ordering is sufficient. | Return all results sorted by rank. |
| **Separate tag taxonomy from ticket tags** | Two separate tag systems create maintenance overhead and conceptual confusion. | KB tags should be freeform text on articles, not linked to the ticket tag system. They serve different purposes. |

---

## Feature Dependencies

```
view_count (table stakes)
  └── popular articles (differentiator)

tags on articles (table stakes)
  └── tag filter on KB list

draft/published status (table stakes)
  └── FTS query must include WHERE status = 'published'
  └── List query must default to published-only

table of contents (table stakes)
  └── requires heading nodes in Tiptap HTML (already exists)
  └── pure frontend, no backend

staleness detection (differentiator)
  └── requires last_reviewed_at column
  └── "mark reviewed" button on article detail

see also / cross-references (differentiator)
  └── requires kb_article_links join table
  └── article picker UI (can reuse KB search API)

popular articles (differentiator)
  └── requires view_count (table stakes)

convert ticket to KB article (differentiator)
  └── requires URL param handling in KBArticleForm
  └── ticket API to fetch title/description (already exists)
```

---

## MVP Recommendation for v1.2

Build in this order, optimizing for value-to-complexity ratio:

**Phase 1 — High value, very low / low complexity:**
1. Print button on article detail (copy Reports pattern, ~30 min)
2. "Recently updated" section on KB home (no backend, ~1 hour)
3. Draft / published status (one column, one filter, one toggle, ~2 hours)
4. Article view count (one column, one increment query, ~1 hour)
5. Tags on articles (join table, tag input, tag filter, ~4 hours)

**Phase 2 — Medium complexity, strong differentiators:**
6. Table of contents (parse HTML headings, sticky sidebar, ~4 hours)
7. Article templates (hard-coded templates, picker UI, ~3 hours)
8. Staleness detection (last_reviewed_at column, mark reviewed button, stale filter, ~3 hours)

**Phase 3 — Higher complexity, valuable but deferrable:**
9. Popular articles surface (depends on view_count, ~1 hour once view_count exists)
10. "See Also" cross-references (new join table, article picker, ~4 hours)
11. Keyboard shortcuts (pure frontend, ~2 hours)
12. Convert ticket to KB article (URL params + pre-fill, ~3 hours)

**Defer indefinitely:**
- Auto-suggest related articles via FTS similarity scoring
- Hierarchical categories
- Article versioning / revision history

---

## Complexity Matrix

| Feature | Schema Changes | Backend Changes | Frontend Changes | Estimated Effort |
|---------|---------------|-----------------|-----------------|------------------|
| Print button | None | None | Button + CSS | ~30 min |
| Recently updated section | None | None | Slice + section component | ~1 hr |
| Draft status | `status` column | Filter in GET list + FTS query | Toggle in form + badge in list | ~2 hr |
| View count | `view_count` column | Increment on GET/:id | Display on detail | ~1 hr |
| Tags | `kb_article_tags` join table | CRUD on articles, filter in list | Tag input + tag chips + filter | ~4 hr |
| Table of contents | None | None | Heading parser + ToC sidebar | ~4 hr |
| Article templates | None (hard-coded) | None | Template picker in new-article flow | ~3 hr |
| Staleness detection | `last_reviewed_at` column | Filter for stale articles | Mark reviewed button + stale badge + filter | ~3 hr |
| Popular articles | None (uses view_count) | Top-N query | Section on KB home | ~1 hr |
| See Also / cross-refs | `kb_article_links` join table | CRUD endpoint | Link picker panel on detail + edit | ~4 hr |
| Keyboard shortcuts | None | None | Hotkey listeners + search modal | ~2 hr |
| Ticket-to-KB shortcut | None | Read ticket on article create (optional) | URL params in KBArticleForm, button on ticket detail | ~3 hr |

---

## Confidence Assessment

| Area | Level | Basis |
|------|-------|-------|
| Existing feature inventory | HIGH | Direct codebase read of all KB source files |
| Table stakes classification | HIGH | Established patterns in Confluence, Notion, Zendesk Guide, Freshdesk, GitBook |
| Differentiator classification | MEDIUM | Based on internal IT tool usage patterns; web search unavailable this session |
| Complexity estimates | HIGH | Based on existing codebase patterns (SQLite, FTS5, React, Tiptap, shadcn all in use) |
| Anti-feature reasoning | HIGH | Explicit constraints in PROJECT.md (single-user, no multi-tenancy) + codebase analysis |

---

## Sources

- Direct codebase: `server/src/routes/kb.ts`, `server/src/db/add-kb-tables.ts`, `server/src/db/add-kb-fts5-and-type.ts`, `src/pages/KnowledgeBase.tsx`, `src/pages/KBArticleDetail.tsx`, `src/pages/KBArticleForm.tsx`
- Project constraints and context: `.planning/PROJECT.md` (single-user constraint, stack constraints, out-of-scope list, existing validated requirements)
- Domain knowledge: Confluence KB, Notion docs, Zendesk Guide, Freshdesk KB, GitBook feature sets (HIGH confidence for well-established patterns in the KB domain)
