# Project Research Summary

**Project:** IT Ticket System — Knowledge Base Expansion (v1.2)
**Domain:** Internal IT knowledge base — single-user, SQLite-backed, Tiptap rich text
**Researched:** 2026-03-29
**Confidence:** HIGH

---

## Executive Summary

This milestone extends an already-functional KB module with eight capability areas: article versioning/history, tags, related articles, article templates, ratings/feedback, rich media embedding, table of contents, and article export. Research confirms that the existing stack (React 18 + Vite 7 + Express 4 + better-sqlite3 + Tiptap 3.20 + Tailwind + shadcn) handles all of these natively — only 5 new packages are needed (4 Tiptap extensions + `slugify`), and the rest is pure schema additions and application logic. No new databases, no new services, no architectural pivots.

The recommended approach is additive: every new feature slots into the established migration pattern (`initializeDatabase()` guards in `connection.ts`), all new routes append to the existing `kb.ts` router, and all frontend components mount into existing pages. The build order is driven by dependency and risk — low-risk additive features first, pure-frontend features second, the one feature that modifies a tested write path (versioning) last.

The dominant risk is correctness at two integration seams: FTS5 sync (the contentless virtual table must not be altered and the version snapshot must be inside the same transaction as the article update) and the ToC rendering path (headings must be extracted from the rendered DOM, not by regex over stored HTML). Both risks have clear, verified prevention patterns already documented in the codebase.

---

## Key Findings

### Recommended Stack

The existing stack requires minimal extension. Four Tiptap 3.21.x extensions cover the rich content needs (YouTube embed, syntax-highlighted code blocks, table of contents, and heading anchors). One backend utility (`slugify@1.6.8`) handles URL-safe slug generation with correct Swedish character normalization. Every other capability — versioning, tags, relations, templates, feedback, export — is implemented with pure SQL schema additions and application logic. `turndown` for Markdown export is already installed.

**New dependencies (5 total):**
- `@tiptap/extension-youtube@^3.21.0` — YouTube/Vimeo embed node in editor — only Tiptap-native approach
- `@tiptap/extension-code-block-lowlight@^3.21.0` + `lowlight@^3.3.0` — syntax-highlighted code blocks — replaces starter-kit's plain CodeBlock; register only `bash`, `typescript`, `javascript`, `sql`, `yaml`, `json`, `powershell` to avoid bundle bloat
- `@tiptap/extension-table-of-contents@^3.21.0` — live ToC in editor; DOM `querySelectorAll` for read-only view
- `slugify@^1.6.8` (backend) — URL-safe slugs with unicode normalization including Swedish characters

**Explicitly avoid:** `diff`/`jsdiff`, `react-syntax-highlighter`, `marked`, `meilisearch`, `sanitize-html` (DOMPurify already installed), any alternative Tiptap/editor library.

### Expected Features

Research drew a clear line between table stakes, differentiators, and explicit anti-features for this single-user system.

**Must have (table stakes):**
- Tags on articles — cross-cutting labels beyond flat categories; normalized junction table (`kb_tags` + `kb_article_tags`)
- Draft/published status — prevents half-written articles appearing in search
- Article view count — passive quality signal; enables "popular articles" surface
- "Recently updated" section on KB home — no backend change needed
- Table of contents — standard expectation for long how-to guides; pure frontend
- Print article — copy existing Reports `@media print` pattern; ~30 minutes

**Should have (differentiators):**
- Staleness detection (`last_reviewed_at` column + "mark reviewed" button + stale filter)
- Article templates — hard-coded Tiptap content scaffolds applied client-side; no template CRUD needed initially
- "See Also" cross-references — manual related-article links via bidirectional junction table
- Popular articles surface — trivial once view_count exists; one query + one section
- Keyboard shortcuts (`Ctrl+K` global search modal) — high polish-to-effort ratio
- "Convert ticket to KB article" shortcut — pre-fills form from ticket data via URL params

**Defer indefinitely:**
- Article versioning/revision history — FEATURES.md marks this as anti-feature for single-user system; modeled in ARCHITECTURE.md for teams that want it — treat as optional phase
- Hierarchical sub-categories — flat categories + tags cover organizational needs completely
- User ratings from audience — no audience; use view_count as passive quality signal
- AI-generated summaries — external API dependency with cost and privacy concerns

> **Scope conflict resolved:** FEATURES.md marks versioning as anti-feature #1. STACK.md, ARCHITECTURE.md, and PITFALLS.md model it in full detail. Roadmapper should treat Phase 5 (versioning) as optional — include if revision history is desired, exclude if simplicity is preferred. Both modes are safe given the research available.

> **Second scope conflict resolved:** ARCHITECTURE.md models category hierarchy (`parent_id`); FEATURES.md lists it as anti-feature. Category hierarchy is excluded from this milestone — flat categories + tags are sufficient.

### Architecture Approach

All new features follow the established KB architecture: tables created via `tableExists()`/`columnExists()` guards in `connection.ts`, routes appended to `server/src/routes/kb.ts`, migrations never standalone. The article detail page extends its existing `Promise.all` fetch to include related articles and feedback. Version history loads lazily on panel expand only. The single modification to an existing write path is the `PUT /articles/:id` transaction, which gains a version snapshot insert as step 1 (before the FTS delete), keeping full atomicity.

**Major components:**

1. **DB schema additions** — 5 new tables (`kb_tags`, `kb_article_tags`, `kb_article_relations`, `kb_article_templates`, `kb_article_feedback`) + new columns on `kb_articles` (`status`, `view_count`, `last_reviewed_at`, `slug`); optional 6th table `kb_article_versions` if versioning phase is included
2. **`kb.ts` route extensions** — relation CRUD, template CRUD, feedback GET/POST, tag filtering — all appended to existing router; no new router files
3. **Frontend page enhancements** — `KBArticleDetail.tsx` gains ToC sidebar, related articles panel, feedback widget; `KBArticleForm.tsx` gains template picker, tag input, relation picker; `KnowledgeBase.tsx` gains recently-updated strip, popular articles strip, tag filter, stale articles filter
4. **New standalone components** — `KBTableOfContents.tsx`, `KBRelatedArticles.tsx`, `KBTemplatePicker.tsx`; `KBVersionHistory.tsx` if versioning included
5. **Tiptap extension additions** — YouTube, code-block-lowlight, table-of-contents extensions registered in `RichTextEditor.tsx`

### Critical Pitfalls

1. **FTS5 virtual table cannot be ALTERed** — Do not add columns to `kb_articles_fts`. For new searchable fields (e.g. tags), append to `content_plain` at insert time: `stripHtml(content) + ' ' + tags.join(' ')`. Any migration containing `ALTER TABLE kb_articles_fts` will fail with a hard SQLite error. Applies to any phase touching tags or FTS filtering.

2. **Version save must be inside the article update transaction** — The `updateArticleAndFts` transaction wraps FTS delete + article UPDATE + FTS insert. The version snapshot insert must be step 1 inside this same transaction. Any insert outside the transaction risks FTS out-of-sync state on crash. Verify correctness with a forced crash test before marking versioning complete.

3. **ToC must use DOM query, not regex over stored HTML** — `/<h[23][^>]*>(.*?)<\/h[23]>/gi` fails on headings with nested marks (`<h2><strong>Title</strong></h2>` — captured text includes `<strong>` tags). After `HtmlRenderer` renders content into the DOM, use `containerRef.current.querySelectorAll('h2, h3, h4')` to get clean `textContent`. `HtmlRenderer` uses `dangerouslySetInnerHTML` — there is no Tiptap editor instance in the read view, so `@tiptap/extension-table-of-contents` cannot be used there.

4. **Related articles: enforce canonical pair ordering** — Use `CHECK(article_a < article_b)` on the junction table to prevent duplicate `(A,B)` and `(B,A)` rows. All inserts must sort IDs lexicographically. All reads use `WHERE article_a = ? OR article_b = ?`. All deletes must find the relation regardless of which ID was the "source."

5. **Version restore must go through `updateArticleAndFts` transaction** — Restoring an old version must be treated identically to a save: run the same `updateArticleAndFts` transaction with the restored content. A raw `UPDATE kb_articles` without the FTS step leaves the search index pointing at the wrong content.

---

## Implications for Roadmap

Based on combined research, a 4-phase structure (+ 1 optional phase) optimizes for value delivery, dependency satisfaction, and risk sequencing.

### Phase 1: Core Article Enhancements (Foundational)

**Rationale:** All items are additive, require only column migrations (no new tables except tags), and deliver immediate visible value. Draft status and view count are prerequisites for later features (popular articles surface, quality filtering). Tags require a junction table but are table stakes. Print and recently-updated are near-zero effort. None of these touch existing write paths.

**Delivers:** A KB that feels complete for daily use — articles have lifecycle status, quantified popularity, cross-cutting labels, and print capability.

**Addresses:**
- Print button on article detail (copy Reports `@media print` pattern)
- "Recently updated" section on KB home (no backend, slice of existing `updated_at DESC` data)
- Draft/published status (`status` column, filter in list + FTS, toggle in form)
- Article view count (`view_count` column, increment on GET/:id, display on detail)
- Tags on articles + tag filter on KB list (`kb_tags` + `kb_article_tags` junction table, tag input component)

**Schema changes:** `status` column, `view_count` column, `slug` column on `kb_articles`; `kb_tags` + `kb_article_tags` tables

**Pitfalls to avoid:** If tag text is appended to FTS indexing, append to `content_plain` only — do not alter `kb_articles_fts`. Draft articles must be excluded from `kb_articles_fts` inserts (filter `WHERE status = 'published'` in the FTS sync path).

**Research flag:** Standard patterns — skip `/gsd:research-phase`.

---

### Phase 2: Article Detail and Authoring Experience

**Rationale:** These features operate on the article detail or form views without touching the article list or FTS. ToC is pure frontend. Templates are fully isolated from the article save path. Staleness detection adds one column and one button. No risk to existing write paths.

**Delivers:** Long articles become navigable; new articles start from structure; outdated articles are surfaced for review.

**Addresses:**
- Table of contents (DOM `querySelectorAll` after render; `KBTableOfContents.tsx` sticky sidebar; `@tiptap/extension-table-of-contents` in editor for live preview only)
- Article templates (hard-coded templates, `KBTemplatePicker.tsx` modal in new-article mode, client-side `editor.commands.setContent()` — no server-side string interpolation)
- Staleness detection (`last_reviewed_at` column, "mark reviewed" button, stale badge on article list card, stale filter)

**Stack additions:** `@tiptap/extension-table-of-contents@^3.21.0` (editor side only)

**Pitfalls to avoid:** ToC must use `querySelectorAll` on rendered DOM — not regex on stored HTML. Template application must use `editor.commands.setContent()` client-side — never string-interpolate user values into HTML on the server (XSS risk). Applying a template to an article with existing content must show a confirmation dialog.

**Research flag:** Standard patterns — skip `/gsd:research-phase`.

---

### Phase 3: Discovery and Cross-Referencing

**Rationale:** Popular articles depends on `view_count` from Phase 1. "See Also" relations require a new junction table but zero modification to existing routes. Keyboard shortcuts are pure frontend. "Convert ticket to KB article" touches the ticket detail page read-only (URL params only). This phase turns the KB from a list of isolated articles into a connected, discoverable system.

**Delivers:** Users can find related content, discover the most-used articles, and convert resolved tickets into KB articles with one click.

**Addresses:**
- Popular articles surface (one query `ORDER BY view_count DESC LIMIT 5`, one section on KB home)
- "See Also" cross-references (`kb_article_relations` junction table, `KBRelatedArticles.tsx` panel, article picker reuses existing KB search API)
- Keyboard shortcuts (`Ctrl+K` global search modal, `useEffect` keydown listeners)
- "Convert ticket to KB article" shortcut (URL params `?fromTicket=:id` in `KBArticleForm.tsx`, button on ticket detail page)

**Schema changes:** `kb_article_relations` junction table with `CHECK(article_a < article_b)` canonical ordering constraint

**Pitfalls to avoid:** Related article junction table must enforce canonical pair ordering (critical pitfall #4). Single JOIN query for "related articles" — avoid N+1 per article. Show category badge and article type alongside each related article title for context.

**Research flag:** Standard patterns — skip `/gsd:research-phase`.

---

### Phase 4: Rich Media and Export (Editor Enhancements)

**Rationale:** These features extend the Tiptap editor itself. Grouped together because they all touch `RichTextEditor.tsx` and require the Tiptap 3.21.x extension npm installs. Article export uses the already-installed `turndown` — client-side only. YouTube embed and syntax highlighting are independent editor additions with no schema changes.

**Delivers:** Authors can embed YouTube videos, write syntax-highlighted code blocks, and export articles as Markdown files. All visible in both editor and read-only view via the shared Tiptap renderer.

**Addresses:**
- Rich media embedding (YouTube/Vimeo via `@tiptap/extension-youtube`)
- Syntax-highlighted code blocks (`@tiptap/extension-code-block-lowlight` + `lowlight`)
- Article export as Markdown (client-side `turndown(article.content)` + `Blob` download — no backend change)

**Stack additions:** `@tiptap/extension-youtube@^3.21.0`, `@tiptap/extension-code-block-lowlight@^3.21.0`, `lowlight@^3.3.0`, `slugify@^1.6.8` (backend, for slug column on `kb_articles`)

**Pitfalls to avoid:** Disable starter-kit's `CodeBlock` when adding `extension-code-block-lowlight` — they conflict. Register only the relevant language subset from lowlight (not `common` preset) to control bundle size. Verify Tiptap 3.21.x extension compatibility after npm install — all existing extensions are `^3.20.x`, npm will resolve to 3.21.x single instance.

**Research flag:** Standard patterns — skip `/gsd:research-phase`.

---

### Phase 5: Article Versioning (Optional — Modifies Write Path)

**Rationale:** Versioning is the only feature that modifies an existing production-tested write path (`PUT /articles/:id`). Placing it last ensures all other features are battle-tested before the transaction is extended. FEATURES.md explicitly marks versioning as an anti-feature for a single-user system. Include this phase only if revision history is desired by the user; the milestone is complete without it.

**Delivers:** Every article save creates a recoverable snapshot; users can view any past version and restore with one click.

**Addresses:**
- Article versioning/history (`kb_article_versions` table; version list/get/restore endpoints; `KBVersionHistory.tsx` lazy-loaded collapsible panel in `KBArticleDetail.tsx`)

**Schema changes:** `kb_article_versions` table; extends `updateArticleAndFts` transaction in `PUT /articles/:id`

**Pitfalls to avoid:** Version insert must be step 1 inside the same `db.transaction()` as FTS sync (critical pitfall #2). Version restore must call `updateArticleAndFts` — not a raw UPDATE (critical pitfall #5). Version list endpoint must not include `content` — load lazily on panel expand only. Show only 10 most recent versions by default; include "load more." Warn before deleting an article that has versions (CASCADE will destroy history).

**Research flag:** Needs careful implementation review — this is the highest-risk integration point in the milestone. Verify transaction atomicity with a forced crash test before marking done.

---

### Phase Ordering Rationale

- Phase 1 before Phase 3: `view_count` is a hard dependency for "popular articles"
- Phase 2 before Phase 5: client-side confirmation guard in template apply mitigates "overwrote real content" without requiring versioning first; templates ship safely without versioning as a safety net
- Phase 4 grouped separately: batching all Tiptap 3.21.x extension installs minimizes npm install and compatibility verification cycles
- Phase 5 last: only write-path modification in the milestone; all other features must be working and tested before `PUT /articles/:id` is touched
- Phases 1-4 can be reordered by product priority without breaking dependencies; Phase 5 must remain last if included

### Research Flags

Phases with standard, well-documented patterns — skip `/gsd:research-phase`:
- **Phase 1** — column migrations, junction table, filter logic; all patterns proven in existing codebase
- **Phase 2** — Tiptap ToC extension documented; DOM `querySelectorAll` is standard; template picker is modal + state pre-fill
- **Phase 3** — junction table + query patterns established in codebase; keyboard shortcut hooks are standard React
- **Phase 4** — Tiptap extension registration is mechanical; `turndown` API is trivial

Phase needing careful implementation review:
- **Phase 5 (Versioning)** — modifies existing write path; transaction boundary correctness is non-trivial; FTS sync on restore is easy to forget; worth a dedicated implementation checklist and forced crash test

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All 5 new packages version-verified via npm registry; existing stack confirmed from `package.json`; no version conflicts identified |
| Features | HIGH | Existing feature inventory from direct codebase read of all KB source files; table stakes from established KB products (Confluence, Notion, Zendesk Guide); anti-features backed by explicit PROJECT.md single-user constraint |
| Architecture | HIGH | All patterns confirmed from direct source analysis of `kb.ts`, `connection.ts`, all KB pages and components; no inference required |
| Pitfalls | HIGH | FTS5 mechanics from SQLite official docs; transaction patterns from better-sqlite3 docs; ToC and category pitfalls from codebase inspection; versioning pitfalls from direct transaction source read |

**Overall confidence:** HIGH

### Gaps to Address

- **Tiptap 3.21 vs 3.20 compatibility:** New extensions pin to `^3.21.0`; existing packages are `^3.20.x`. npm will resolve to a single 3.21.x instance via semver range. Confirm no breaking changes during Phase 4 install. Low risk — Tiptap follows semver within major version.

- **Ratings vs feedback scope:** FEATURES.md explicitly excludes ratings/feedback as "user ratings are meaningless for single-user." ARCHITECTURE.md models a `kb_article_feedback` table. Resolution: implement feedback as internal quality-tracking (thumbs up/down + optional note, authenticated admin only), not as audience ratings. This is consistent with the single-user constraint. Roadmapper should include `kb_article_feedback` as part of Phase 3 if quality-tracking is desired.

- **ToC in read-only vs editor contexts:** `@tiptap/extension-table-of-contents` works only in a Tiptap editor instance. `HtmlRenderer` uses `dangerouslySetInnerHTML` — not a Tiptap editor — so the extension cannot be used there. ToC for the article read view must use the DOM `querySelectorAll` approach. Both can coexist: extension in editor for live preview, DOM query in detail view for display. Implementation must account for both contexts.

---

## Sources

### Primary (HIGH confidence)
- `server/src/routes/kb.ts` — existing endpoints, FTS5 sync pattern, transaction structure
- `server/src/db/connection.ts` — `initializeDatabase()` migration pattern, `tableExists()`/`columnExists()` guards
- `server/src/db/add-kb-tables.ts`, `add-kb-fts5-and-type.ts` — existing schema
- `src/pages/KBArticleDetail.tsx`, `KBArticleForm.tsx`, `KnowledgeBase.tsx` — existing frontend structure
- `src/components/ui/rich-text-editor.tsx` — Tiptap extensions, heading levels confirmed at h2/h3
- `package.json`, `server/package.json` — installed packages, confirmed versions
- `.planning/PROJECT.md` — single-user constraint, out-of-scope list
- npm registry — `@tiptap/extension-youtube@3.21.0`, `@tiptap/extension-code-block-lowlight@3.21.0`, `@tiptap/extension-table-of-contents@3.21.0`, `lowlight@3.3.0`, `slugify@1.6.8` versions verified

### Secondary (MEDIUM confidence)
- Confluence, Notion, Zendesk Guide, GitBook feature sets — KB table stakes classification
- SQLite FTS5 docs (sqlite.org/fts5.html) — contentless mode, virtual table ALTER restriction
- better-sqlite3 transaction API (GitHub docs) — transaction boundary patterns

---
*Research completed: 2026-03-29*
*Ready for roadmap: yes*
