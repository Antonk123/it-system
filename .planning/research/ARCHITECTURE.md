# Architecture Patterns

**Domain:** Knowledge Base expansion — article versioning, categories/hierarchy, related articles, templates, table of contents, article feedback
**Researched:** 2026-03-29
**Confidence:** HIGH (based on direct codebase analysis)

---

## Existing KB Architecture Baseline

Before mapping new features, the current state matters because every new table or endpoint must fit into the established patterns.

### Existing Tables

```
kb_categories         id, name, color, position, created_at
kb_articles           id, title, content, category_id, article_type, created_at, updated_at
kb_articles_fts       (virtual, FTS5 contentless) rowid, title, content_plain
kb_article_shares     id, article_id, share_token, created_at
ticket_kb_links       id, ticket_id, article_id, created_at
```

### Existing Endpoints (all at /api/kb/*)

```
GET    /categories
POST   /categories
PUT    /categories/:id
DELETE /categories/:id
GET    /articles?search=&category_id=&article_type=
GET    /articles/:id
GET    /articles/:id/tickets
POST   /articles
PUT    /articles/:id
DELETE /articles/:id
GET    /articles/:id/share
POST   /articles/:id/share
DELETE /articles/:id/share
GET    /public/:token
POST   /upload-image
GET    /images/:filename
GET    /ticket/:ticketId
POST   /ticket/:ticketId
DELETE /ticket/:ticketId/:articleId
```

### Existing Frontend Pages

```
/kb                   KnowledgeBase.tsx     — article list, category manager, filters
/kb/new               KBArticleForm.tsx     — create form (Tiptap editor)
/kb/:id               KBArticleDetail.tsx   — article detail, linked tickets, share panel
/kb/:id/edit          KBArticleForm.tsx     — edit form
/kb/shared/:token     SharedKBArticle.tsx   — public unauthenticated view
```

### Installed Tiptap Extensions

Confirmed from `package.json` (all `^3.20.x`):
`@tiptap/starter-kit`, `extension-link`, `extension-image`, `extension-table` (+row/cell/header), `extension-placeholder`, `extension-underline`, `extension-color`, `extension-highlight`, `extension-text-align`

Heading nodes are `<h2>` and `<h3>` (confirmed in `rich-text-editor.tsx` — toolbar uses `Heading2`, `Heading3` from lucide and `editor.chain().toggleHeading({ level: 2/3 })`).

### Key Existing Patterns to Follow

- **Migrations wired into `initializeDatabase()`** in `connection.ts` using `tableExists()` / `columnExists()` guards — every new table follows this pattern, not standalone migration scripts
- **FTS5 sync is manual**: INSERT/UPDATE/DELETE on `kb_articles` also touches `kb_articles_fts` using the auxiliary delete approach (`INSERT INTO kb_articles_fts(kb_articles_fts, rowid, ...) VALUES('delete', ...)`) — the broken auto-trigger was dropped
- **UUID primary keys** (text) everywhere via `uuidv4()`
- **ISO string timestamps** (`created_at`, `updated_at` as TEXT via `new Date().toISOString()`)
- **`db.transaction()`** wraps any multi-statement write
- **`authenticate` middleware** on all auth-required routes — the only KB route without auth is `/public/:token`
- **All KB routes live in a single file** `server/src/routes/kb.ts` — no separate router file per sub-feature

---

## New Feature Architecture

### 1. Article Versioning

**Goal:** Snapshot article content on each save so the user can review history and restore previous versions.

**New table:**

```sql
CREATE TABLE IF NOT EXISTS kb_article_versions (
  id          TEXT PRIMARY KEY,
  article_id  TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  article_type TEXT CHECK(article_type IN ('how-to', 'solution')),
  version_num  INTEGER NOT NULL,
  saved_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_versions_article ON kb_article_versions(article_id, version_num DESC);
```

`version_num` is computed as `SELECT COALESCE(MAX(version_num), 0) + 1 FROM kb_article_versions WHERE article_id = ?` inside the save transaction.

**Integration point — existing `PUT /api/kb/articles/:id`:**

The current `updateArticleAndFts` transaction reads the existing row before modifying it (for FTS delete). Extend that same transaction to INSERT a version snapshot of the *before* state:

```
db.transaction():
  1. Read existing row (already done for FTS delete)
  2. NEW: Compute next version_num
  3. NEW: INSERT INTO kb_article_versions (old title, old content, old article_type, version_num, now)
  4. FTS auxiliary delete with old values [existing]
  5. UPDATE kb_articles [existing]
  6. FTS re-insert with new values [existing]
```

First edit creates version 1 (the pre-edit snapshot). The live article is always the current truth; versions are the history.

**New endpoints appended to `kb.ts`:**

```
GET    /articles/:id/versions              — list (id, version_num, saved_at, title) — no content in list
GET    /articles/:id/versions/:vnum        — full version with content
POST   /articles/:id/versions/:vnum/restore — copy version back to article (creates new version of current state first)
```

**Frontend components:**

- `KBVersionHistory.tsx` — collapsible panel in `KBArticleDetail.tsx`, loads lazily on expand (not on initial page load — most users never need it)
- Each entry shows version number and date; clicking reveals a read-only content preview via `HtmlRenderer`
- Restore shows a confirm dialog; on confirm calls `POST /restore`, then re-fetches the article

**FTS impact:** Versions are NOT indexed in FTS5. Only live article content is searchable. No FTS changes needed.

---

### 2. Category Hierarchy (Subcategories)

**Goal:** One level of parent-child nesting for categories. Two levels is sufficient for an IT knowledge base (e.g., "Hardware > Monitors").

**Schema change — additive column on existing table:**

```sql
ALTER TABLE kb_categories ADD COLUMN parent_id TEXT REFERENCES kb_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_kb_categories_parent ON kb_categories(parent_id);
```

Use `columnExists('kb_categories', 'parent_id')` guard in `initializeDatabase()`.

**No changes to `/api/kb/articles` routes** — `category_id` on articles still references `kb_categories.id` directly at any level.

**`GET /categories` response** — already returns all fields; adding `parent_id` is automatic with no query change needed.

**Frontend changes:**

- `KnowledgeBase.tsx` category manager: add parent selector dropdown when creating/editing a category (uses the existing flat category list, filtered to exclude self and any children to prevent cycles)
- Category filter dropdown in the KB list: group subcategories under their parent with visual indentation
- No new pages — category management remains inline

**Note on depth limit:** Enforce one level maximum in the UI (disable the parent selector for a category that is already used as a parent) and in the API (validate that `parent_id` references a top-level category, i.e., one with `parent_id IS NULL`).

---

### 3. Related Articles

**Goal:** Manual "See also" links between articles shown at the bottom of the detail view.

**New junction table:**

```sql
CREATE TABLE IF NOT EXISTS kb_article_relations (
  id         TEXT PRIMARY KEY,
  article_a  TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  article_b  TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(article_a, article_b),
  CHECK(article_a < article_b)
);
CREATE INDEX IF NOT EXISTS idx_kb_relations_a ON kb_article_relations(article_a);
CREATE INDEX IF NOT EXISTS idx_kb_relations_b ON kb_article_relations(article_b);
```

The `CHECK(article_a < article_b)` constraint enforces canonical pair ordering (lexicographic UUID comparison). This prevents `(A,B)` and `(B,A)` as separate rows. Insertion must sort the two IDs before inserting. Read queries use `WHERE article_a = ? OR article_b = ?` to find all relations for a given article.

**New endpoints appended to `kb.ts`:**

```
GET    /articles/:id/related            — list related articles (id, title, category_name, article_type)
POST   /articles/:id/related            — body: { relatedArticleId }
DELETE /articles/:id/related/:relatedId
```

**Frontend components:**

- `KBRelatedArticles.tsx` — panel in `KBArticleDetail.tsx` below linked tickets
- Relation picker in `KBArticleForm.tsx` edit mode: search input that calls `GET /api/kb/articles?search=` and lets the user pick articles to relate
- Picker should exclude the current article and already-related articles from results

---

### 4. Article Templates

**Goal:** Pre-built content scaffolds (title + Tiptap HTML structure) that new articles can start from.

**New table:**

```sql
CREATE TABLE IF NOT EXISTS kb_article_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  content      TEXT NOT NULL DEFAULT '',
  article_type TEXT CHECK(article_type IN ('how-to', 'solution')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

Templates do NOT go through FTS5 — they are not articles and should not appear in search.

**New endpoints appended to `kb.ts`:**

```
GET    /templates                       — list all templates (id, name, description, article_type)
POST   /templates                       — create template
PUT    /templates/:id                   — update template
DELETE /templates/:id                   — delete template
GET    /templates/:id                   — get single template with full content (used by picker)
```

**Frontend integration:**

- `KBArticleForm.tsx` (new article mode only): "Start from template" button opens a `KBTemplatePicker.tsx` modal
- Selecting a template calls `GET /templates/:id` to fetch full content, then sets `content` and `article_type` in the form state
- Template manager is accessible from a settings area in `KnowledgeBase.tsx` (alongside the existing category manager — add a second collapsible panel or a tab)
- Templates are authored using the same `RichTextEditor` component already in `KBArticleForm.tsx`

**Note:** This uses the existing Tiptap editor — no new editor instance or extension is required.

---

### 5. Table of Contents

**Goal:** Auto-generated navigation from `<h2>` and `<h3>` headings in the article, rendered as a sticky sidebar.

**This is entirely frontend — zero backend or database changes required.**

**How headings work in the existing stack:**

- Tiptap serializes heading nodes as `<h2>` and `<h3>` in the stored HTML content
- `KBArticleDetail.tsx` renders via `<HtmlRenderer content={article.content} />`
- `HtmlRenderer` uses `dangerouslySetInnerHTML` (confirmed by its usage pattern)

**TOC generation approach:**

Pre-process the article HTML string before rendering:

1. Parse headings from HTML using a regex: `/<h([23])[^>]*>(.*?)<\/h[23]>/gi`
2. Generate a slug for each heading text (strip HTML tags from inner content, lowercase, replace spaces with dashes)
3. Inject `id` attributes: `<h2 id="slug">...</h2>` — do this as a string transformation on `article.content` before passing to `HtmlRenderer`
4. Build the TOC entries array: `{ level: 2|3, text: string, id: string }[]`

**New component: `KBTableOfContents.tsx`**

- Accepts `entries: { level: number; text: string; id: string }[]`
- Renders a sticky sidebar list with anchor links `href="#id"`
- Indents `<h3>` entries under their parent `<h2>`
- Hidden on mobile (`hidden md:block`), shown as a thin column on desktop

**Integration in `KBArticleDetail.tsx`:**

Extract a `headings` array from `article.content` using the heading parser. When `headings.length > 0`, switch from single-column to two-column layout:

```
[article content — 2/3 width] [KBTableOfContents — 1/3 width, sticky]
```

The same heading-injected HTML string goes to `HtmlRenderer`. No changes needed to `HtmlRenderer` itself.

**Public share view** (`SharedKBArticle.tsx`): Apply the same TOC treatment — it fetches article content with the same structure.

---

### 6. Article Feedback

**Goal:** Self-rating (thumbs up / thumbs down) so the single user can flag articles that need improvement.

**Single-user context:** The logged-in admin rates their own articles. Multiple feedback entries per article are valuable as a history — "I marked this unhelpful, improved it, marked it helpful." This differs from multi-user systems where uniqueness per user is enforced.

**New table:**

```sql
CREATE TABLE IF NOT EXISTS kb_article_feedback (
  id          TEXT PRIMARY KEY,
  article_id  TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK(rating IN (1, -1)),
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_feedback_article ON kb_article_feedback(article_id);
```

**New endpoints appended to `kb.ts`:**

```
GET    /articles/:id/feedback           — { helpful: N, notHelpful: N, latest: 1|-1|null }
POST   /articles/:id/feedback           — body: { rating: 1|-1, note?: string }
```

**Frontend component (inline in `KBArticleDetail.tsx`):**

- Two icon buttons (thumbs up, thumbs down) with running counts
- Most-recent rating is highlighted to show current stance
- Optional note textarea (collapsed by default, shown with "Add note" toggle)
- Counts update optimistically on click

**Initial page load:** Feedback is small and cheap. Include in the `Promise.all` alongside the existing article/share/tickets fetch — no lazy loading needed.

---

## Component Boundaries Summary

| Component | Type | Communicates With |
|-----------|------|-------------------|
| `kb_article_versions` | DB table | `kb_articles` (FK), version routes |
| `kb_article_relations` | DB table | `kb_articles` (FK x2), relation routes |
| `kb_article_templates` | DB table | Template routes, KBArticleForm.tsx |
| `kb_article_feedback` | DB table | `kb_articles` (FK), feedback routes |
| `parent_id` on `kb_categories` | Column migration | Category routes, KnowledgeBase.tsx |
| Version/relation/template/feedback routes | Backend additions in `kb.ts` | Respective new tables |
| Extended `PUT /articles/:id` transaction | Modified backend | `kb_article_versions` |
| `KBVersionHistory.tsx` | Frontend component | Mounts in KBArticleDetail.tsx, lazy |
| `KBRelatedArticles.tsx` | Frontend component | Mounts in KBArticleDetail.tsx |
| `KBTableOfContents.tsx` | Frontend component | Mounts in KBArticleDetail.tsx, pure derived |
| `KBTemplatePicker.tsx` | Frontend component | Mounts in KBArticleForm.tsx (new mode) |
| Feedback widget | Inline in KBArticleDetail.tsx | Feedback GET/POST endpoints |

---

## Data Flow Changes

### Article Save (PUT /articles/:id) — Extended Transaction

```
Client submits edited article
  → PUT /api/kb/articles/:id
    → db.transaction():
        1. Read existing row (rowid, title, content, article_type) [existing]
        2. NEW: SELECT COALESCE(MAX(version_num), 0) + 1 FROM kb_article_versions
        3. NEW: INSERT INTO kb_article_versions (old state snapshot)
        4. FTS auxiliary delete with old values [existing]
        5. UPDATE kb_articles [existing]
        6. FTS re-insert with new values [existing]
    → SELECT updated article + JOIN kb_categories [existing]
    → Return updated article JSON
```

### Article Detail Page Load — Extended Parallel Fetches

**Current:** `Promise.all([getKbArticle, getKbArticleShare, getArticleLinkedTickets])`

**Extended:** `Promise.all([getKbArticle, getKbArticleShare, getArticleLinkedTickets, getRelatedArticles, getFeedback])`

Versions are loaded lazily on panel expand — not in the initial `Promise.all`.

---

## FTS5 Impact Assessment

| Feature | FTS5 Change |
|---------|-------------|
| Versioning | None — versions not indexed, only live articles are |
| Category hierarchy | None |
| Related articles | None |
| Templates | None — templates are not articles |
| Table of contents | None — client-side only |
| Feedback | None |

No FTS5 changes needed for any new feature. The existing sync logic in `PUT /articles/:id` is untouched structurally — the version snapshot is inserted into `kb_article_versions` before the FTS delete step, within the same transaction.

---

## Migration Integration Pattern

All new tables follow the `connection.ts` pattern:

```typescript
// Add to connection.ts, call from initializeDatabase()

const ensureKbVersionsTable = () => {
  if (tableExists('kb_article_versions')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_article_versions ( ... );
    CREATE INDEX IF NOT EXISTS idx_kb_versions_article ON kb_article_versions(article_id, version_num DESC);
  `);
  console.log('Created missing table: kb_article_versions');
};

// Column migration:
const ensureKbCategoriesParentId = () => {
  if (!tableExists('kb_categories')) return;
  if (columnExists('kb_categories', 'parent_id')) return;
  db.exec('ALTER TABLE kb_categories ADD COLUMN parent_id TEXT REFERENCES kb_categories(id) ON DELETE SET NULL;');
  db.exec('CREATE INDEX IF NOT EXISTS idx_kb_categories_parent ON kb_categories(parent_id);');
  console.log('Added parent_id to kb_categories');
};
```

Order in `initializeDatabase()` matters only when there are dependencies. New KB tables have no cross-dependencies with each other except `ensureKbVersionsTable` must be called before the first PUT to an article (i.e., before the server starts handling requests — which is guaranteed since `initializeDatabase()` runs at startup).

---

## Suggested Build Order

Dependencies and risk drive order. Build low-risk/no-existing-code-changes first; leave the one feature that modifies a tested write path until last.

### Phase 1 — Additive, zero modification to existing write paths

**1. Category hierarchy** (`parent_id` column migration + UI update)
- `ensureKbCategoriesParentId()` in `connection.ts`
- `GET /categories` response gains `parent_id` with no query change needed
- Update `KnowledgeBase.tsx` category manager with parent selector
- Lowest risk: purely additive, all existing articles and categories unchanged

**2. Article templates** (new table, new routes, isolated from article save/load)
- `ensureKbArticleTemplatesTable()` in `connection.ts`
- CRUD routes appended to `kb.ts`
- `KBTemplatePicker.tsx` modal + button in `KBArticleForm.tsx` (new mode only)
- Zero impact on existing article flow

### Phase 2 — Article detail enhancements (read-side only)

**3. Table of contents** (no DB, no API — pure frontend transformation)
- Heading parser utility function
- `KBTableOfContents.tsx` component
- Two-column layout in `KBArticleDetail.tsx`
- Apply same to `SharedKBArticle.tsx`
- Zero backend risk, fully reversible

**4. Related articles** (new table, new routes, new panel)
- `ensureKbArticleRelationsTable()` in `connection.ts`
- Relation routes appended to `kb.ts`
- `KBRelatedArticles.tsx` panel in `KBArticleDetail.tsx`
- Relation picker in `KBArticleForm.tsx` (edit mode)
- Extend `Promise.all` in detail page fetch

**5. Article feedback** (new table, new routes, inline widget)
- `ensureKbArticleFeedbackTable()` in `connection.ts`
- Feedback routes appended to `kb.ts`
- Feedback widget inline in `KBArticleDetail.tsx`
- Extend `Promise.all` in detail page fetch

### Phase 3 — Versioning (modifies existing write path)

**6. Article versioning** (most invasive — modifies `PUT /articles/:id` transaction)
- `ensureKbVersionsTable()` in `connection.ts`
- Extend `updateArticleAndFts` transaction in `PUT /articles/:id`
- Version list/get/restore routes appended to `kb.ts`
- `KBVersionHistory.tsx` collapsible panel in `KBArticleDetail.tsx` (lazy load)

**Rationale for versioning last:** It is the only feature that modifies an existing, production-tested write path. Building all other features first ensures the PUT route is battle-tested before touching it. A bug in the version snapshot insertion rolls back the entire transaction, leaving the article unchanged — the transaction boundary is the safety net.

---

## Anti-Patterns to Avoid

### Storing TOC in the database
TOC is derived from headings in `article.content`. Computing it server-side or persisting it separately creates a synchronization problem every time content is edited. Derive client-side on render.

### FTS-indexing versions or templates
Version content is archival. Template content is scaffolding. Neither should appear in article search results. Only `kb_articles` content is indexed.

### Symmetric rows for related articles
Storing `(A,B)` and `(B,A)` as separate rows requires complex UNIQUE constraint management and double-counts pairs. The `CHECK(article_a < article_b)` canonical ordering with `OR` queries at read time is the correct SQLite pattern.

### Separate router file for KB v1.2 additions
All KB routes live in `server/src/routes/kb.ts`. Splitting into `kb-versions.ts`, `kb-relations.ts`, etc. fragments the KB API surface and requires new `app.use()` mounts. Append to the existing router.

### Eager version loading on article detail page load
Version history is an edge case. Loading it on every article open wastes a query and slows the primary read path. Load lazily when the user opens the history panel.

### Enforcing max depth for category hierarchy in the database only
A `CHECK` constraint in SQL cannot easily enforce "max one level of nesting." Enforce the one-level limit in the API route validation (reject `parent_id` that itself has a non-null `parent_id`) and in the UI (disable parent selector for categories that are already parents). The database schema relies on `ON DELETE SET NULL` for cascading orphan cleanup.

---

## Sources

- Direct analysis of `server/src/routes/kb.ts` (HIGH confidence)
- Direct analysis of `server/src/db/connection.ts` — `initializeDatabase()` migration pattern (HIGH confidence)
- Direct analysis of `src/pages/KBArticleDetail.tsx`, `KBArticleForm.tsx`, `KnowledgeBase.tsx` (HIGH confidence)
- Direct analysis of `src/components/ui/rich-text-editor.tsx` — Tiptap extensions confirmed (HIGH confidence)
- Direct analysis of `package.json` — `@tiptap/*` packages at `^3.20.x` (HIGH confidence)
- Direct analysis of `src/App.tsx` — KB route structure (HIGH confidence)
- Direct analysis of `src/lib/api.ts` — `KbArticleRow`, `KbCategoryRow` interfaces (HIGH confidence)
