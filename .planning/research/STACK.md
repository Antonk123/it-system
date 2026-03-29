# Technology Stack — KB Expansion (v1.2)

**Project:** IT Ticket System
**Milestone scope:** Knowledge Base expansion — article versioning/history, tags, related articles, templates, ratings/feedback, rich media embedding, table of contents, article export
**Researched:** 2026-03-29
**Overall confidence:** HIGH (npm registry verified for all new packages; existing stack facts from package.json)

---

## Existing Stack (do not change)

React 18.3.1 + Vite 7 + Express 4.21.2 + better-sqlite3 11.7.0 + TypeScript 5.8.3 + Tiptap 3.20.x + shadcn/Radix UI + Tailwind CSS + Framer Motion.

All new libraries must slot into this stack without replacing anything already installed.

---

## Feature Coverage Map

| Feature | New Backend Dep | New Frontend Dep | DB Schema Change |
|---------|----------------|------------------|-----------------|
| Article versioning/history | none | none | `kb_article_versions` table |
| Tags | none | none | `kb_tags`, `kb_article_tags` tables |
| Related articles | none | none | `kb_article_relations` table |
| Article templates | none | none | `kb_article_templates` table |
| Ratings/feedback | none | none | `kb_article_ratings` table |
| Rich media (YouTube embed) | none | `@tiptap/extension-youtube` | none |
| Syntax-highlighted code blocks | none | `@tiptap/extension-code-block-lowlight` + `lowlight` | none |
| Table of contents | none | `@tiptap/extension-table-of-contents` | none |
| Article export (Markdown) | none | `turndown` (already installed) | none |
| Heading anchor IDs | none | (included in ToC extension) | none |
| Slug generation | `slugify` (server) | none | `slug` column on `kb_articles` |

---

## New Frontend Dependencies

### @tiptap/extension-youtube `^3.21.0`

**Why:** Adds a YouTube/Vimeo embed node to the Tiptap editor. Renders as a responsive iframe. The existing Tiptap installation is at 3.20.x — the 3.21.x version is a drop-in compatible minor. Match the version constraint to the already-installed `^3.x` packages.

**Install:**
```bash
npm install @tiptap/extension-youtube@^3.21.0
```

**Integration point:** Register in the editor's `extensions` array alongside the existing extensions. Requires no backend changes — the iframe HTML is stored as part of article content.

**Confidence:** HIGH — version verified from npm registry; peer dep requires `@tiptap/core ^3.21.0`.

---

### @tiptap/extension-code-block-lowlight `^3.21.0` + lowlight `^3.3.0`

**Why:** Replaces the basic `CodeBlock` from starter-kit with syntax-highlighted code blocks. `lowlight` is a highlight.js wrapper that runs in Node and browser — no DOM dependency. The combination is the standard Tiptap approach for syntax highlighting.

**Note:** `@tiptap/extension-code-block` is already included in `@tiptap/starter-kit`. The lowlight extension overrides it — configure starter-kit to exclude `CodeBlock` when adding this extension.

**Install:**
```bash
npm install @tiptap/extension-code-block-lowlight@^3.21.0 lowlight@^3.3.0
```

**Integration point:** Add to editor extensions, import language grammars selectively (e.g., `common` preset from lowlight) to avoid bundle size bloat. Use `lowlight.registerAll(common)` to get ~30 common languages. For a KB in an IT system, `bash`, `typescript`, `javascript`, `sql`, `yaml`, `json`, `powershell` are the relevant subset — register individually for a smaller bundle.

**Confidence:** HIGH — version verified from npm registry; peer dep constraints confirmed.

---

### @tiptap/extension-table-of-contents `^3.21.0`

**Why:** Generates a ToC data structure from headings in the editor document. This is the canonical Tiptap approach — it provides a `getItems()` callback-based API that produces heading hierarchy with generated anchor IDs. Works alongside the existing heading extension already in starter-kit.

**Install:**
```bash
npm install @tiptap/extension-table-of-contents@^3.21.0
```

**Integration point:** Two usage modes:
1. In the editor — updates a live ToC sidebar as the user writes.
2. In the article viewer (read-only Tiptap instance) — renders a sticky ToC panel for navigation.

The extension injects `id` attributes on heading nodes automatically. No backend schema changes needed — heading IDs are derived from heading text at render time.

**Confidence:** HIGH — version 3.21.0 verified from npm registry.

---

## New Backend Dependencies

### slugify `^1.6.8`

**Why:** Used to generate URL-safe slugs for KB articles (e.g., `/kb/how-to-reset-vpn` instead of `/kb/articles/uuid`). Handles Swedish characters correctly (`å→a`, `ä→a`, `ö→o`) which is essential given the UI language.

**Install location:** Backend (`server/package.json`)

```bash
cd server && npm install slugify@^1.6.8
```

**Integration point:** Called in the article CREATE and UPDATE routes. Slug stored in a new `slug TEXT UNIQUE` column on `kb_articles`. Used as an alternative lookup key alongside the UUID `id`. Frontend URLs can optionally use slug for human-readable article links.

**Alternative considered:** `nanoid` (already installed) generates random IDs, not readable slugs. Writing slug generation by hand is feasible but doesn't handle the unicode normalization edge cases. `slugify` is 3KB, no dependencies, correct choice.

**Confidence:** HIGH — version 1.6.8 verified from npm registry.

---

## No New Dependency Needed

### Article Versioning / History

**Approach:** Pure SQL solution — `kb_article_versions` table that stores a snapshot row on every UPDATE to `kb_articles`. No versioning library needed.

**Schema:**
```sql
CREATE TABLE kb_article_versions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_kb_versions_article ON kb_article_versions(article_id, version_number DESC);
```

**Sync:** Trigger on `UPDATE` of `kb_articles` that inserts the OLD row into `kb_article_versions` before the update is applied. Version number is `MAX(version_number) + 1` per article. This is the idiomatic SQLite pattern — no library adds value here.

**Confidence:** HIGH — standard SQL audit-log pattern, no library required.

---

### Tags

**Approach:** `kb_tags` (id, name, color, slug) + `kb_article_tags` (article_id, tag_id) junction table. No tagging library needed.

**Note:** The ticket system already has tags implemented as a JSON array column on `tickets`. KB tags should use proper normalized tables (junction table) since tag-based filtering and "articles with tag X" queries are expected. The ticket tag approach was a pragmatic choice for an existing system; KB tags are new and can be done right.

**Confidence:** HIGH — normalized junction table is the correct relational pattern.

---

### Related Articles

**Approach:** `kb_article_relations` (article_id, related_article_id, created_at) self-referential junction table. Queries for "related articles" fetch both directions (`article_id = X OR related_article_id = X`). No graph library needed — SQLite handles this easily at the scale of a single-user KB (expected: dozens to low hundreds of articles).

**Confidence:** HIGH — bidirectional self-join is standard SQL.

---

### Article Templates

**Approach:** `kb_article_templates` (id, name, content, article_type, created_at) table. Templates are just KB articles without a publication lifecycle — same content format (Tiptap HTML), same title field. When creating a new article from a template, the frontend sends the template's `content` as the initial value to the Tiptap editor. No template engine needed.

**Confidence:** HIGH — templates are pre-seeded content, not a rendering concern.

---

### Ratings / Feedback

**Approach:** `kb_article_ratings` (id, article_id, rating INTEGER, comment TEXT, created_at) table. Rating is a 1–5 integer or a binary helpful/not-helpful (0/1). For a single-user system, ratings are self-ratings (the admin rating their own articles for quality tracking) or public reader ratings via the existing share token mechanism. No ratings library needed.

**Note on single-user context:** Since this is a single-admin system, article ratings likely serve as a quality-tracking note rather than crowdsourced feedback. A simple thumbs-up/down (boolean) + optional comment is more useful than a 5-star scale. This is a design decision for the roadmap phase, not a stack decision.

**Confidence:** HIGH — simple integer + optional text, pure SQL.

---

### Article Export (Markdown)

**Approach:** `turndown` is already installed in the frontend (`package.json` dependencies, `^7.2.2`). It converts HTML to Markdown. For exporting a KB article as `.md`, call `turndown(article.content)` client-side and trigger a `Blob` download.

**No new dependency needed.**

**Confidence:** HIGH — turndown already in package.json, confirmed.

---

### Table of Contents (read-only viewer)

The `@tiptap/extension-table-of-contents` listed above handles both editor and read-only ToC rendering. The article viewer already uses a read-only Tiptap editor instance — simply add the extension there as well.

**No additional package needed beyond the ToC extension above.**

---

## Summary: New Dependencies

### Frontend (`package.json`)

| Package | Version | Feature | Already Installed? |
|---------|---------|---------|-------------------|
| `@tiptap/extension-youtube` | `^3.21.0` | Rich media (YouTube embed) | No |
| `@tiptap/extension-code-block-lowlight` | `^3.21.0` | Syntax-highlighted code blocks | No |
| `lowlight` | `^3.3.0` | Required by code-block-lowlight | No |
| `@tiptap/extension-table-of-contents` | `^3.21.0` | Table of contents | No |

### Backend (`server/package.json`)

| Package | Version | Feature | Already Installed? |
|---------|---------|---------|-------------------|
| `slugify` | `^1.6.8` | URL-safe slugs for article URLs | No |

**Total new packages: 5** (4 frontend, 1 backend)

---

## What NOT to Add

| Library | Avoid because |
|---------|--------------|
| `@tiptap/extension-heading` | Already in `@tiptap/starter-kit` |
| `highlight.js` | `lowlight` wraps it; do not install separately |
| `marked` / `remark` | `turndown` (already installed) handles the only needed conversion (HTML→MD); the reverse is not needed |
| `gray-matter` | Front-matter parsing for markdown exports — unnecessary; plain .md files without front-matter are sufficient |
| `diff` / `jsdiff` | Version diff display — implement client-side with a simple string comparison or omit diff view; a "restore this version" action is more useful than a line-diff UI for a KB |
| `js-yaml` | Not needed; no YAML in KB content |
| `@uiw/react-md-editor` | Would replace Tiptap — rejected; Tiptap is already deeply integrated |
| `react-quill` / `quill` | Alternative rich text editor — rejected; Tiptap is the existing choice |
| `meilisearch` / `typesense` | External search service — violates "no new databases" constraint; FTS5 already handles search |
| `sanitize-html` | `dompurify` already installed on frontend; `stripHtml()` regex already implemented in `kb.ts` for FTS indexing |
| `@types/slugify` | `slugify` ships its own TypeScript types since v1.6.x |
| `react-syntax-highlighter` | Frontend syntax highlighting library — unnecessary; lowlight inside Tiptap handles this in the editor; for read-only display use the same Tiptap read-only editor |

---

## DB Schema Additions (no new libraries)

All new tables added via migration scripts following the existing `server/src/db/` pattern:

```sql
-- Article versioning
CREATE TABLE kb_article_versions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Tags (normalized)
CREATE TABLE kb_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  slug TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE kb_article_tags (
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES kb_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);

-- Related articles (bidirectional)
CREATE TABLE kb_article_relations (
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  related_article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (article_id, related_article_id),
  CHECK (article_id != related_article_id)
);

-- Article templates
CREATE TABLE kb_article_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  article_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Ratings/feedback
CREATE TABLE kb_article_ratings (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  helpful INTEGER NOT NULL CHECK (helpful IN (0, 1)),
  comment TEXT,
  created_at TEXT NOT NULL
);

-- Slug column on kb_articles
ALTER TABLE kb_articles ADD COLUMN slug TEXT UNIQUE;
```

---

## Integration Notes

**FTS5 re-indexing:** If `slug` or any other new column is added to `kb_articles`, no FTS5 changes are needed — the FTS virtual table only indexes `title` and `content` (with HTML stripped). Tags are stored in a separate junction table and do not need FTS indexing.

**Version trigger:** The SQLite trigger to snapshot article content on update should be added in the same migration that creates `kb_article_versions`. The trigger captures `OLD.title` and `OLD.content` into the versions table before the UPDATE commits.

**Tiptap version alignment:** All new Tiptap extensions are pinned to `^3.21.0`. The existing extensions in package.json are at `^3.20.0`. Updating the existing constraints to `^3.21.0` is safe — Tiptap follows semver within major version, and 3.21.0 is a minor release. Alternatively, keep `^3.20.0` for existing and `^3.21.0` for new; npm will resolve to a single 3.21.x instance due to `^` range compatibility.

---

## Sources

- npm registry: `@tiptap/extension-youtube@3.21.0`, `@tiptap/extension-code-block-lowlight@3.21.0`, `@tiptap/extension-table-of-contents@3.21.0`, `lowlight@3.3.0`, `slugify@1.6.8` — versions verified via `curl https://registry.npmjs.org/{package}/latest` (HIGH confidence)
- Existing `package.json` and `server/package.json` — confirmed installed packages (HIGH confidence)
- `server/src/routes/kb.ts` and `server/src/db/add-kb-tables.ts` — current KB schema and implementation (HIGH confidence)
- SQLite trigger pattern for audit logging: standard SQL pattern, no external reference needed (HIGH confidence)
