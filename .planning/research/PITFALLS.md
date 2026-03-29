# Pitfalls Research

**Domain:** Knowledge Base expansion — versioning, categories/hierarchy, related articles, templates, ToC, feedback — added to existing SQLite-backed IT ticket system
**Researched:** 2026-03-29
**Confidence:** HIGH for SQLite/FTS5 mechanics (codebase-verified). HIGH for Tiptap patterns (source-verified). MEDIUM for versioning storage patterns.

---

## Critical Pitfalls

### Pitfall 1: Extending the FTS5 Contentless Table Breaks Existing Sync Logic

**What goes wrong:**
The existing `kb_articles_fts` is a contentless FTS5 table (`content=''`). Adding new columns to FTS5 in SQLite is not possible via `ALTER TABLE` — virtual tables do not support `ALTER`. If a developer tries to add a `category` or `tags` column to `kb_articles_fts` to enable filtered full-text search, they will hit a hard SQLite error with no recovery path other than dropping and recreating the table. Dropping the virtual table loses all indexed data and requires a full backfill.

**Why it happens:**
Developers extend a normal table by adding columns; FTS5 virtual tables look and act like tables, so the impulse is to `ALTER` them. SQLite's error message (`table kb_articles_fts may not be altered`) is unambiguous but unexpected.

**How to avoid:**
Do not add columns to `kb_articles_fts`. The existing two-column schema (`title`, `content_plain`) is sufficient for all text search. For filtered search (by category or type), apply SQL `WHERE` clauses on `kb_articles` after the FTS5 MATCH — which is exactly what the current code does (JOIN then filter). This pattern already exists in `kb.ts` lines 159-171 and should be preserved as-is.

If new searchable fields are needed (e.g., article tags), strip and append them to `content_plain` during insert rather than adding a new FTS5 column:
```typescript
const tagText = tags.join(' ');
const plainText = stripHtml(content) + ' ' + tagText;
db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)')
  .run(rowid, title, plainText);
```

**Warning signs:**
- Any migration script that contains `ALTER TABLE kb_articles_fts`
- Developer attempting to `SELECT * FROM kb_articles_fts` and looking for more columns

**Phase to address:** Any phase adding tags or category-based FTS filtering.

---

### Pitfall 2: Article Versioning Table Uses Raw HTML — Version Diffing and Storage Bloat

**What goes wrong:**
When implementing article versioning (storing previous versions of content), the naive approach is to insert the full `content` HTML string into a `kb_article_versions` table on every save. Tiptap produces verbose HTML: a 500-word article generates 3-8KB of HTML. With frequent edits, this means 100 versions = 300-800KB per article. More critically, there is no way to render a diff between versions without parsing two HTML strings on the frontend — HTML diff libraries are complex and produce confusing results on structured content (lists within lists, table cells).

**Why it happens:**
The existing `kb_articles.content` is stored as HTML, so the obvious approach is to store versions the same way. The storage concern feels academic until an article has 50+ versions.

**How to avoid:**
Store versions as full HTML snapshots (not deltas) — this is correct for SQLite at this scale. The storage concern is real but bounded: a single-user system with 200 articles and 20 versions each is still only ~30MB of version data, which is fine for SQLite.

What to avoid is implementing diff rendering. Instead of a diff view, build a version viewer that shows the full article content at any past version. This is simpler to build, simpler to understand, and does not require an HTML diff library.

Schema pattern:
```sql
CREATE TABLE IF NOT EXISTS kb_article_versions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kb_versions_article ON kb_article_versions(article_id, version_number DESC);
```

Auto-increment `version_number` via `SELECT MAX(version_number) + 1` inside the save transaction.

**Warning signs:**
- Any plan to store JSON patches or delta diffs in the versions table
- Frontend code importing an HTML diff library

**Phase to address:** Versioning phase.

---

### Pitfall 3: FTS5 Sync Breaks When Version Save and Article Update Are Not in the Same Transaction

**What goes wrong:**
The current article update path in `kb.ts` (lines 281-291) wraps the FTS5 delete + article update + FTS5 insert in a single `db.transaction()`. When article versioning is added, the version insert must also be inside this same transaction. If a developer adds the version insert outside the transaction (e.g., after the transaction call), a crash between the two operations produces an article that was updated but has no version recorded — or an FTS5 table that is out of sync.

**Why it happens:**
The version insert feels like a separate operation ("save the old version before updating"). Developers may add it as a pre-step before calling the existing transaction, rather than inside it.

**How to avoid:**
Expand the existing `updateArticleAndFts` transaction to include the version snapshot:
```typescript
const updateArticleAndFts = db.transaction((aid, title, content, ..., versionNumber) => {
  // 1. Save current state as a version (BEFORE updating)
  db.prepare('INSERT INTO kb_article_versions (id, article_id, title, content, version_number, created_at) VALUES (?,?,?,?,?,?)')
    .run(uuidv4(), aid, existing.title, existing.content, versionNumber, now);
  // 2. FTS delete (old values)
  db.prepare("INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content_plain) VALUES('delete', ?, ?, ?)")
    .run(existing.rowid, existing.title, stripHtml(existing.content));
  // 3. Update article
  db.prepare('UPDATE kb_articles SET title = ?, content = ?, updated_at = ? WHERE id = ?')
    .run(title, content, now, aid);
  // 4. FTS insert (new values)
  db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)')
    .run(existing.rowid, title, stripHtml(content));
});
```

**Warning signs:**
- Version insert is a separate `db.prepare().run()` call outside of `db.transaction()`
- Version insert happens in a `try/catch` block separate from the article update

**Phase to address:** Versioning phase.

---

### Pitfall 4: Table of Contents Generated by Parsing Stored HTML Instead of Tiptap's JSON

**What goes wrong:**
Generating a ToC from article content requires extracting all heading nodes. The approach of parsing the stored HTML string with regex (`content.match(/<h[23][^>]*>(.+?)<\/h[23]>/g)`) is fragile: it fails on headings with nested marks (e.g., `<h2><strong>Title</strong></h2>` — the captured text includes `<strong>` tags), it fails on attributes in the opening tag, and it provides no way to generate anchor IDs that match the rendered HTML.

**Why it happens:**
The article's `content` field is HTML, so HTML parsing feels like the obvious approach. Regex-based HTML parsing is a known anti-pattern but still tempting for "simple" cases.

**How to avoid:**
Two correct approaches, in order of preference:

**Option A — Extract headings from the rendered DOM (client-side only):**
After `HtmlRenderer` renders the article content into the DOM, use `document.querySelectorAll('h2, h3, h4')` on the container element to get headings with their actual rendered text (no HTML tags). Assign `id` attributes to each heading on render (slugified text). Build the ToC array from these DOM nodes.

```typescript
// In KBArticleDetail, after content renders:
const headings = containerRef.current?.querySelectorAll('h2, h3, h4') ?? [];
const toc = Array.from(headings).map(h => ({
  level: parseInt(h.tagName[1]),
  text: h.textContent ?? '',
  id: h.id, // assigned during render
}));
```

**Option B — Use Tiptap's TableOfContents extension (editor-side only):**
Tiptap has a `@tiptap/extension-table-of-contents` that works on the editor's document model. This is only available in the editor context, not the read-only view.

**Warning signs:**
- Any `content.match(/<h[23]/)` regex on the stored HTML string
- `DOMParser` used to parse the `content` string in a Node.js context (there is no DOM in Node)

**Phase to address:** ToC phase.

---

### Pitfall 5: Category Hierarchy Implemented as Self-Referencing Foreign Key Without Depth Guard

**What goes wrong:**
If article categories are enhanced to support parent/child nesting (subcategories), the natural schema is:
```sql
ALTER TABLE kb_categories ADD COLUMN parent_id TEXT REFERENCES kb_categories(id) ON DELETE SET NULL;
```
Without a depth constraint, a user can create arbitrarily deep trees (category → subcategory → sub-subcategory → ...). The frontend breadcrumb renderer, the category picker dropdown, and the article list filter all need to handle arbitrary depth. This causes N+1 query problems (fetching parent of each category in a loop) and complex recursive UI components.

**Why it happens:**
Self-referencing FK is the obvious relational model for hierarchical data. The depth problem is invisible until someone actually nests 4 levels deep.

**How to avoid:**
For a single-user IT KB with ~10-30 categories, enforce a maximum depth of 2 (parent + child, no grandchildren). Enforce this in the API:
```typescript
if (parent_id) {
  const parent = db.prepare('SELECT parent_id FROM kb_categories WHERE id = ?').get(parent_id);
  if (parent?.parent_id) {
    return res.status(400).json({ error: 'Categories can only be nested one level deep' });
  }
}
```

Fetch all categories in a single query and build the tree client-side:
```typescript
// One query, no recursive SQL needed
const allCategories = db.prepare('SELECT * FROM kb_categories ORDER BY position').all();
// Build tree in JS: group children under parents
```

**Warning signs:**
- Recursive SQL CTE (`WITH RECURSIVE`) for category traversal — overkill for this use case
- Frontend category picker that makes a separate API call per category to get children

**Phase to address:** Category hierarchy phase.

---

### Pitfall 6: Related Articles Stored as Bidirectional Links Causing Duplicate or Inconsistent State

**What goes wrong:**
When adding "related articles" between KB articles, the simplest schema is a join table:
```sql
CREATE TABLE kb_article_relations (
  article_id TEXT,
  related_id TEXT,
  PRIMARY KEY (article_id, related_id)
);
```
If this is implemented as directed links (A relates to B but B does not relate to A), the reverse lookup is missing. If implemented as bidirectional (inserting both (A,B) and (B,A)), any delete must remove both rows — and it's easy to leave orphaned half-links. If there's a `UNIQUE(article_id, related_id)` constraint without a constraint on the reverse direction, inserts can succeed in both directions, creating duplicate relationships.

**Why it happens:**
The `ticket_kb_links` table already exists as a model. Developers copy that pattern but don't account for the symmetric nature of article-to-article relations.

**How to avoid:**
Enforce directionality at the application layer: always store with `article_id < related_id` alphabetically (or by string comparison) as the canonical direction. When querying, use `WHERE article_id = ? OR related_id = ?` to find all related articles regardless of which was the "source." Delete both directions by the normalized key.

```sql
-- Insert: normalize so article_id is always lexically smaller
-- Query all relations for article X:
SELECT * FROM kb_article_relations WHERE article_id = ? OR related_id = ?
```

Alternatively, use directed links (simpler) and accept that the user must add the relation from both articles if they want symmetric display — but be explicit about this in the UI.

**Warning signs:**
- Insert logic that does two `INSERT` calls without wrapping in a transaction
- Delete logic that only removes one direction

**Phase to address:** Related articles phase.

---

### Pitfall 7: Article Templates Store Rich Text HTML With Placeholders That Break the Tiptap Parser

**What goes wrong:**
KB article templates need placeholder syntax (e.g., `{{software_name}}`, `{{version}}`). If these placeholders are embedded in the stored HTML content and then loaded into Tiptap via `editor.commands.setContent(templateHtml)`, Tiptap's HTML parser will treat `{{...}}` as text nodes — which is correct. However, if someone mistakenly stores placeholders inside HTML attributes (e.g., `<a href="{{url}}">link</a>`), Tiptap will strip or mangle the attribute because `href` validation rejects non-URL values.

A separate failure mode: if template HTML is generated server-side by string interpolation (`content.replace('{{name}}', userValue)`), any user value containing `<`, `>`, `&`, or `"` creates XSS-capable HTML that gets stored in `kb_articles.content` and rendered by `HtmlRenderer`.

**Why it happens:**
String interpolation for template substitution is the simplest approach. The XSS risk is easy to miss when the rendered content is "internal-only."

**How to avoid:**
- Store template placeholders only in text content, never in HTML attributes.
- If server-side substitution is used, always HTML-encode user-provided values before interpolating:
  ```typescript
  function escapeHtml(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  ```
- Preferred approach: do substitution client-side in the Tiptap editor after loading the template, using Tiptap's `editor.commands.setContent()` with pre-escaped values. This keeps the editor as the source of truth and avoids manual HTML generation.

**Warning signs:**
- `content.replace('{{', ...)` string interpolation in any route handler
- Template preview rendered via `dangerouslySetInnerHTML` without sanitization

**Phase to address:** Templates phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store all versions as full HTML snapshots | Simple, no delta logic | Storage grows ~5-10KB per save | Acceptable — 200 articles × 20 versions = ~30MB max |
| No soft-delete for articles with versions | Simpler delete logic | Deleting an article also deletes all its versions (CASCADE) | Acceptable only if user is warned before delete |
| Flat category structure (depth ≤ 2) | Simple queries, simple UI | Cannot model deeply nested IT knowledge domains | Acceptable for single-user IT tool with ~30 categories |
| ToC from DOM query instead of Tiptap JSON | No new Tiptap extension needed | ToC only available in read view, not editor preview | Acceptable — ToC is a read-side feature |
| Feedback stored as simple thumbs up/down counter | No separate feedback table needed | Cannot see which saves were flagged helpful or not | Never — use a proper feedback table for auditability |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| FTS5 + versioning | Re-indexing old article versions in FTS5 | Only index the current article in FTS5. Versions are not searchable and should not be inserted into `kb_articles_fts`. |
| Tiptap + ToC | Using Tiptap's `@tiptap/extension-table-of-contents` in the read-only `HtmlRenderer` | `HtmlRenderer` renders plain HTML, not a Tiptap editor. ToC must be extracted from the DOM after render, not from a Tiptap extension. |
| Category delete + articles | `ON DELETE SET NULL` on `kb_articles.category_id` silently orphans articles | Before deleting a category, warn: "X articles will become uncategorized." Show affected count. |
| Version restore + FTS5 | Restoring an old version must also update FTS5 | Treat a version restore identically to a save: run the same `updateArticleAndFts` transaction with the restored content. |
| Article templates + image uploads | Template HTML references `/api/kb/images/...` URLs that were uploaded for the template | When creating a new article from a template, images from the template are shared (same URLs). Deleting the template article does not delete its images — this is a feature, not a bug, since articles share the upload directory. Document this. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching all versions in article list response | Article list response includes 50+ version objects per article | Never include versions in list responses. Only return version count and latest version number. Load full version history lazily in article detail. | First article with 10+ versions |
| N+1 for related articles | Fetching each related article individually in a loop | Single JOIN query: `SELECT a.* FROM kb_articles a JOIN kb_article_relations r ON (r.article_id = a.id OR r.related_id = a.id) WHERE r.article_id = ? OR r.related_id = ?` | First article with 5+ related articles |
| Rendering ToC on every keypress in editor | ToC flickers as user types, expensive DOM queries | Debounce ToC extraction by 500ms in the editor. In read view (static), compute once on mount. | Immediately in editor with long articles |
| Loading full article content for search results | FTS5 search returns full HTML for every result | Article list query should NOT return `content` column. FTS5 snippet is sufficient. Current code already handles this correctly in the search path — preserve it when adding related articles or versioning metadata to the list query. | Once average article content exceeds 5KB |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Server-side template substitution via string interpolation | XSS: user input inserted into HTML rendered by `HtmlRenderer` | HTML-escape all substituted values; prefer client-side substitution in Tiptap editor |
| Serving article images without checking article ownership | Any unauthenticated user who knows a `kb-*.jpg` filename can access it via `/api/kb/images/:filename` | This is an existing architecture decision (images are public for the share feature). Accept this for a single-user internal tool, but document it. Do not add sensitive screenshots to articles that have public share links. |
| Version endpoint without authentication | Old article versions may contain sensitive resolution steps | Add `authenticate` middleware to all version endpoints, same as other KB routes |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Version history as full list with no pagination | 50+ versions visible in a list, user cannot find the version they want | Show only the 10 most recent versions by default, with "Load more" |
| ToC that does not scroll-highlight active section | User loses their position in long articles | Use IntersectionObserver to track which heading is currently in view and highlight the corresponding ToC entry |
| Feedback (thumbs up/down) resets on page reload | User cannot tell if they already gave feedback | Persist feedback state in localStorage keyed by article ID; mark already-voted articles |
| Related articles shown as a flat list with no context | User sees article titles but cannot judge relevance | Show category badge and article type badge alongside each related article title |
| Article template picker with no preview | User selects a template blindly | Show a short preview of the template content on hover or in a side panel before applying |
| Deleting a category while editing an article that uses it | Article's category silently becomes null mid-session | On article save, validate that category_id still exists; show a clear error if the category was deleted |

---

## "Looks Done But Isn't" Checklist

- [ ] **Versioning:** Version save is inside the same `db.transaction()` as the FTS5 sync — verify the transaction wraps all four operations.
- [ ] **Versioning:** Version restore calls the same `updateArticleAndFts` transaction — verify FTS5 is updated on restore, not just `kb_articles`.
- [ ] **ToC:** Heading IDs are assigned on render (not left as empty strings) — verify `id` attributes are written to heading elements in `HtmlRenderer`.
- [ ] **ToC:** ToC works when there are no headings in the article — verify empty-array case renders nothing (not a crash).
- [ ] **Related articles:** Delete removes only the normalized-direction row — verify the query finds and removes the relation regardless of which article_id is the "source."
- [ ] **Category hierarchy:** API enforces max depth of 2 — verify a third level of nesting returns a 400, not a silent insertion.
- [ ] **Templates:** Applying a template to an existing article with content shows a confirmation — verify the editor does not silently overwrite existing content.
- [ ] **Feedback:** Feedback endpoint is authenticated — verify `authenticate` middleware is present on the POST route.
- [ ] **FTS5:** New fields added to article (e.g., tags, template_id) are NOT inserted into `kb_articles_fts` — verify `content_plain` remains the only dynamic field in FTS5.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| FTS5 table out of sync after botched migration | LOW | Run `INSERT INTO kb_articles_fts(kb_articles_fts) VALUES('rebuild')` — but this does not work on contentless tables. For `content=''` mode: `DELETE FROM kb_articles_fts`, then re-insert all current articles via the backfill loop already in `connection.ts`. |
| Version table has orphaned rows after manual article delete (bypassed CASCADE) | LOW | `DELETE FROM kb_article_versions WHERE article_id NOT IN (SELECT id FROM kb_articles)` |
| Related article half-link (only one direction stored) | LOW | Query for orphaned relations and delete: `DELETE FROM kb_article_relations WHERE article_id NOT IN (SELECT id FROM kb_articles) OR related_id NOT IN (SELECT id FROM kb_articles)` |
| Article template applied and overwrote real content | MEDIUM | If versioning is in place, restore from the last version. If versioning is not yet implemented, content is unrecoverable — this is the strongest argument for implementing versioning before templates. |
| Category deleted, articles are now uncategorized | LOW | Re-create the category and run an UPDATE to re-assign affected articles, using the version history or article list to identify them. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| FTS5 column extension attempt | Any phase touching FTS5 or tags | Run `ALTER TABLE kb_articles_fts ADD COLUMN ...` in test — confirm it fails, confirm the workaround (append to content_plain) works |
| Version save not in transaction | Versioning phase | Introduce a forced crash between version insert and article update — confirm DB state is consistent after crash (SQLite rolls back) |
| ToC regex parsing HTML | ToC phase | Test with heading containing nested `<strong>` — confirm ToC text is clean, no HTML tags in extracted text |
| Category depth unbounded | Category hierarchy phase | Attempt to create a grandchild category via API — confirm 400 response |
| Related article half-link on delete | Related articles phase | Delete one article that has a relation — confirm the relation is fully removed, not left as an orphan |
| Template substitution XSS | Templates phase | Submit a template field value containing `<script>alert(1)</script>` — confirm it renders as escaped text, not executed |
| Versions visible in article list payload | Versioning phase | Check network tab for `GET /api/kb/articles` — confirm response does not include `versions` array, only `version_count` |
| FTS5 indexed with version content | Versioning phase | Search for a word only in an old version — confirm it does NOT appear in search results |

---

## Sources

- Codebase inspection: `server/src/routes/kb.ts`, `server/src/db/connection.ts`, `server/src/db/schema.sql`, `server/src/db/add-kb-fts5-and-type.ts`, `src/components/ui/rich-text-editor.tsx`, `src/pages/KBArticleDetail.tsx`
- SQLite FTS5 documentation: https://www.sqlite.org/fts5.html — contentless mode, `rebuild` command, virtual table ALTER restriction (HIGH confidence)
- better-sqlite3 transaction API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md (HIGH confidence)
- Tiptap extension architecture: source inspection of existing `rich-text-editor.tsx` showing heading levels 2, 3, 4 configured in StarterKit (HIGH confidence for heading structure available for ToC)
- SQLite self-referencing FK and recursive CTE: https://www.sqlite.org/lang_with.html (HIGH confidence for technical mechanics; depth-guard approach is a practical recommendation based on project constraints)

---
*Pitfalls research for: KB expansion (versioning, categories, related articles, templates, ToC, feedback) on existing SQLite/FTS5/Tiptap system*
*Researched: 2026-03-29*
