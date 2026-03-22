# Phase 02: Knowledge Base Rework - Research

**Researched:** 2026-03-22
**Domain:** SQLite FTS5 full-text search, better-sqlite3 triggers, React badge/select patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Search result presentation**
- D-01: FTS5 snippet replaces the current raw content preview in the article list — show the matched excerpt (with highlight markup) instead of the first N characters of HTML
- D-02: Highlight markup: wrap matched terms in `<mark>` tags; style with a subtle background in the existing theme (no custom color needed — shadcn's default `mark` styling or a tailwind utility)
- D-03: Articles with no search query active show a plain content excerpt (strip HTML, truncate to ~120 chars) — same as today but cleanly stripped
- D-04: No match count badge or result ranking indicator in the UI — FTS5 rank is used for ordering but not surfaced

**Linked Tickets panel**
- D-05: Panel appears below the article content in KBArticleDetail, above the footer actions
- D-06: Each row shows: ticket title (linked to ticket detail), status badge, priority badge — same badge components used elsewhere in the app
- D-07: Empty state: "Ingen biljett är länkad till den här artikeln" (no illustration needed — plain text is fine)
- D-08: Panel is always visible (not collapsed/expandable)

**Article type UX**
- D-09: Type badge in article list sits next to the category badge on the same line — small, secondary styling
- D-10: Badge labels: "Instruktion" (how-to) and "Lösning" (solution) — Swedish to match the rest of the UI
- D-11: Articles with `article_type = null` show no badge
- D-12: Type filter in KnowledgeBase list: a third dropdown alongside the existing category dropdown — same Select component pattern, options: All / Instruktion / Lösning
- D-13: Type selector in KBArticleForm: a Select field below the category selector, optional (no required validation)

### Claude's Discretion
- FTS5 virtual table name, trigger naming, HTML-stripping approach (regex vs. simple tag removal)
- Whether to use a migration file or inline db.exec in the route init
- Exact snippet fragment length passed to SQLite's `snippet()` function
- Exact positioning/spacing of the Linked Tickets panel
- Badge color choice for how-to vs. solution types

### Deferred Ideas (OUT OF SCOPE)
None — discussion was skipped, scope matches ROADMAP.md exactly.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KB-01 | KB search uses SQLite FTS5 virtual table (replacing current LIKE queries) with snippet highlighting in results | FTS5 CREATE VIRTUAL TABLE + snippet() function; replace route GET /api/kb/articles |
| KB-02 | FTS5 indexing strips HTML tags before indexing so Tiptap markup does not pollute search tokens | Node.js HTML strip regex applied before INSERT/UPDATE to FTS table; confirmed triggers cannot call external JS |
| KB-03 | API endpoint GET /api/kb/articles/:id/tickets returns tickets linked to a KB article | Reverse query on ticket_kb_links (index already exists on article_id); add route to kb.ts |
| KB-04 | "Linked Tickets" panel visible in KB article detail page | New UI section in KBArticleDetail.tsx, below article content |
| KB-05 | KB articles have an optional article_type field ("how-to" or "solution"); existing articles default to null | ALTER TABLE migration + update CRUD endpoints + frontend form + list filter |
</phase_requirements>

---

## Summary

Phase 02 is a self-contained rework of the Knowledge Base feature spanning three orthogonal concerns: (1) replacing LIKE-based search with SQLite FTS5 and returning highlighted snippets, (2) surfacing the reverse relationship from KB articles back to tickets, and (3) adding an optional article type classification with a filter. All three changes are additive — they extend existing routes, tables, and components without breaking existing functionality.

The codebase is in excellent shape to receive these changes. The `ticket_kb_links` table already has an index on `article_id`, making the reverse query trivially O(log n). The FTS5 virtual table approach is standard SQLite and well-supported by `better-sqlite3` v11. The single tricky concern is HTML stripping before indexing: SQLite triggers cannot call Node.js code, so the strip must happen in the route handler (Node.js) before writing to the FTS table. This decision is already captured in STATE.md as a settled project decision.

The migration pattern for standalone `.ts` files in `server/src/db/` is established and consistent (see `add-template-type.ts`, `add-kb-tables.ts`, etc.). All three feature areas require database migrations: FTS5 virtual table + triggers (or route-level sync), `article_type` column, and no new table for the reverse-ticket endpoint (the table already exists).

**Primary recommendation:** Implement in three logical tasks — (1) DB migration for FTS5 + article_type, (2) backend route changes (FTS search, reverse ticket endpoint, article_type CRUD), (3) frontend changes (search snippet display, Linked Tickets panel, type badge + filter + form field).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^11.7.0 | SQLite driver including FTS5 | Already in use; FTS5 is compiled into the bundled SQLite |
| SQLite FTS5 | built-in | Full-text search virtual table | Official SQLite extension, no additional install |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn Badge | in-repo | Type badge in list and detail | All badge rendering in the app |
| shadcn Select | in-repo | Type filter dropdown and form selector | All dropdowns in the app |

### No New Dependencies Required

All three feature areas can be implemented with existing libraries. No additional npm packages needed.

---

## Architecture Patterns

### Recommended Project Structure

No new files/folders needed beyond one migration file. Changes touch:

```
server/src/db/
└── add-kb-fts5-and-type.ts   # new migration: FTS5 virtual table + article_type column

server/src/routes/
└── kb.ts                      # modified: FTS search, reverse ticket endpoint, article_type CRUD

src/lib/
└── api.ts                     # modified: KbArticleRow type, getArticleLinkedTickets(), article_type param

src/pages/
├── KnowledgeBase.tsx          # modified: snippet display, type filter dropdown
├── KBArticleDetail.tsx        # modified: Linked Tickets panel
└── KBArticleForm.tsx          # modified: article_type selector
```

### Pattern 1: FTS5 Content Table with Manual Sync

**What:** Create a shadow FTS5 virtual table that mirrors the stripped-text content of `kb_articles`. Keep it in sync via SQLite triggers (INSERT/UPDATE/DELETE) — BUT the content written to the FTS table must be pre-stripped in Node.js before being stored. Triggers keep the FTS table consistent when articles are modified through any code path.

**Why triggers work here:** The FTS table stores the already-stripped plain text. The trigger copies content from `kb_articles.content` only for delete/update sync. The initial HTML strip happens in Node before writing to `kb_articles`, and the FTS table is populated with that same (already-stripped) value at write time.

**Wait — critical design decision (see Pitfall 1 below):** The cleanest approach is:
1. Node strips HTML before writing to `kb_articles.content` — NO, this breaks the rich-text editor (content is HTML).
2. Node strips HTML and writes it to a separate `kb_articles.content_plain` column, then the FTS table indexes `content_plain` — YES, this is the correct pattern.
3. Alternatively: FTS table is synced manually (no triggers) — Node writes to both `kb_articles` and the FTS table in the same route handler, using a transaction.

**Recommended approach (Option 3 — manual sync in route):**
- No separate `content_plain` column needed
- Node strips HTML in the route handler
- Route writes to `kb_articles` (raw HTML) and to `kb_articles_fts` (stripped text) in a single `db.transaction()`
- On DELETE, the FTS row is deleted via a trigger (no HTML stripping needed for delete)
- This matches the project decision in STATE.md: "FTS5 HTML stripping happens in Node.js route, not in SQLite trigger"

```sql
-- Migration: FTS5 virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts
  USING fts5(title, content_plain, content='', tokenize='unicode61');

-- Delete trigger to keep FTS in sync when article deleted
CREATE TRIGGER IF NOT EXISTS kb_articles_fts_delete
  AFTER DELETE ON kb_articles BEGIN
    DELETE FROM kb_articles_fts WHERE rowid = OLD.rowid;
  END;
```

```typescript
// Route: strip HTML and write to both tables in a transaction
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const insertArticleAndFts = db.transaction((id, title, content, categoryId, articleType, now) => {
  db.prepare('INSERT INTO kb_articles (id, title, content, category_id, article_type, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, title, content, categoryId, articleType, now, now);
  // FTS rowid must match the article's rowid
  const rowid = (db.prepare('SELECT rowid FROM kb_articles WHERE id = ?').get(id) as { rowid: number }).rowid;
  db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)')
    .run(rowid, title, stripHtml(content));
});
```

### Pattern 2: FTS5 Search Query with snippet()

**What:** Query FTS5 table using MATCH syntax. Use SQLite's built-in `snippet()` function to extract highlighted excerpts. Join back to `kb_articles` on `rowid`.

**Critical rowid note (from STATE.md):** `kb_articles` uses UUID strings as `id`. The FTS5 virtual table's `rowid` is an INTEGER that matches the physical `rowid` of the `kb_articles` row (not the UUID `id`). The join MUST use `a.rowid = fts.rowid`, not `a.id = fts.something`.

```sql
-- FTS search query
SELECT
  a.id, a.title, a.category_id, a.article_type, a.created_at, a.updated_at,
  c.name as category_name, c.color as category_color,
  snippet(kb_articles_fts, 1, '<mark>', '</mark>', '…', 20) AS snippet
FROM kb_articles_fts fts
JOIN kb_articles a ON a.rowid = fts.rowid
LEFT JOIN kb_categories c ON a.category_id = c.id
WHERE kb_articles_fts MATCH ?
  AND (@category_id IS NULL OR a.category_id = @category_id)
  AND (@article_type IS NULL OR a.article_type = @article_type)
ORDER BY rank
```

`snippet()` signature: `snippet(fts_table, column_index, start_match, end_match, ellipsis, max_tokens)`
- Column index 0 = title, 1 = content_plain
- Max tokens: 20–30 is readable; 64 is the hard SQLite limit
- Returns at most one fragment (the best matching window)

### Pattern 3: Reverse Ticket Lookup

**What:** Simple SELECT through the existing `ticket_kb_links` join table. The index `idx_ticket_kb_links_article` already exists (verified in `add-kb-tables.ts` line 65).

```sql
SELECT
  t.id, t.title, t.status, t.priority, t.created_at, t.updated_at
FROM tickets t
JOIN ticket_kb_links tkl ON t.id = tkl.ticket_id
WHERE tkl.article_id = ?
ORDER BY tkl.created_at DESC
```

### Pattern 4: article_type Column Migration

Use the established standalone migration file pattern (`npx tsx src/db/add-kb-fts5-and-type.ts`). Both the FTS5 setup and the `article_type` column can be in the same migration file since they're both Phase 02 changes.

```sql
ALTER TABLE kb_articles ADD COLUMN article_type TEXT CHECK(article_type IN ('how-to', 'solution'));
```

No backfill needed — existing articles default to NULL per requirement KB-05.

### Pattern 5: FTS5 Fallback When No Search

When `search` query param is absent, the route returns regular article list ordered by `updated_at` — no FTS involved. The preview snippet shown in the article list in this case is generated client-side (strip HTML, truncate to 120 chars) as today (D-03). This is already implemented in `KnowledgeBase.tsx` `getPreview()` function — keep it as-is for the no-search path.

### Anti-Patterns to Avoid

- **Using `a.id` for FTS5 join:** The FTS5 rowid is SQLite's physical integer rowid, not the UUID `id` column. Always use `a.rowid = fts.rowid`.
- **Storing HTML in FTS table:** FTS5 would tokenize HTML tags and attribute values. A search for "class" would match every article with a `class="..."` attribute. Strip first.
- **Running FTS5 MATCH with empty string:** SQLite throws an error for `MATCH ''`. Gate the FTS code path on `search.trim().length > 0`.
- **FTS5 MATCH with special characters unescaped:** User input containing `*`, `"`, `(`, `)` can break FTS5 MATCH syntax. Sanitize by wrapping the query in double-quotes: `"${term}"` OR use `fts5_tokenize()` approach. The simplest safe approach: `MATCH '"' || replace(?, '"', '""') || '"'` — this treats the input as a phrase search and escapes internal double-quotes.
- **Running the migration file as a module import:** The migration files open their own `new Database(...)` connection. They must be run as standalone scripts (`npx tsx`), not imported.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Full-text search ranking | Custom TF-IDF or LIKE scoring | FTS5 with `rank` column | FTS5 BM25 ranking is built-in and correct |
| HTML entity decoding before strip | Custom entity decoder | Simple tag-only regex is sufficient for snippet preview | KB content is Tiptap output: entities are minimal, tags are the pollution |
| Snippet extraction | Substring search + context window | SQLite `snippet()` function | Handles word boundaries, max_tokens limit, ellipsis insertion |

**Key insight:** SQLite FTS5 provides ranking, snippet generation, and index maintenance for free. The only custom code needed is the HTML-strip step before indexing.

---

## Common Pitfalls

### Pitfall 1: FTS5 rowid vs UUID id join
**What goes wrong:** Query returns 0 rows or wrong articles even though FTS matches exist.
**Why it happens:** Developer writes `JOIN kb_articles a ON a.id = fts.article_id` — but FTS5 tables have no `article_id` column; the join key is the physical `rowid` integer.
**How to avoid:** Always `JOIN kb_articles a ON a.rowid = fts.rowid`.
**Warning signs:** 0-row result set from FTS query despite known-good content; SQLite "no such column" error.

### Pitfall 2: FTS5 MATCH on empty/whitespace input
**What goes wrong:** `db.prepare('... WHERE kb_articles_fts MATCH ?').all('')` throws `fts5: syntax error near ""`.
**Why it happens:** FTS5 MATCH requires at least one token. Empty string is a syntax error.
**How to avoid:** Guard: `if (!search || !search.trim()) { /* use regular query */ return; }`.
**Warning signs:** 500 errors from the search endpoint when the search box is cleared.

### Pitfall 3: FTS5 MATCH with user-provided special characters
**What goes wrong:** Searching for `C++` or `(error)` throws an FTS5 syntax error.
**Why it happens:** `+`, `(`, `)`, `"`, `*` are FTS5 operators.
**How to avoid:** Phrase-escape the input: `MATCH '"' || replace(@q, '"', '""') || '"'`. This safely treats arbitrary user text as a literal phrase.
**Warning signs:** Intermittent 500s depending on search term content.

### Pitfall 4: FTS table out of sync after UPDATE
**What goes wrong:** Updated articles return stale snippets or no longer appear in search.
**Why it happens:** If using manual sync (no auto-update trigger), the FTS row must be explicitly updated in the same transaction as the `kb_articles` UPDATE.
**How to avoid:** Wrap article UPDATE in a `db.transaction()` that also does `DELETE FROM kb_articles_fts WHERE rowid = ?` then `INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)`.
**Warning signs:** Searching for a term that was in an article pre-edit still returns that article with the old snippet.

### Pitfall 5: article_type migration fails if column already exists
**What goes wrong:** Re-running the migration file throws `duplicate column name: article_type`.
**Why it happens:** SQLite's `ALTER TABLE ADD COLUMN` is not idempotent.
**How to avoid:** Guard with `columnExists()` check before executing the ALTER TABLE — the pattern is already established in `connection.ts`.
**Warning signs:** Migration script exits with error if run twice.

### Pitfall 6: FTS rowid mismatch when article was inserted before FTS table existed
**What goes wrong:** Existing articles have no FTS rows; searching finds nothing until articles are re-saved.
**Why it happens:** The FTS table is new; existing `kb_articles` rows were never inserted into it.
**How to avoid:** After creating the FTS table, run a backfill INSERT in the migration:
```sql
INSERT INTO kb_articles_fts(rowid, title, content_plain)
SELECT rowid, title, /* stripped content */ FROM kb_articles;
```
Since stripping cannot run in SQL (HTML strip requires Node), the migration must do this in Node:
```typescript
const articles = db.prepare('SELECT rowid, title, content FROM kb_articles').all();
const stmt = db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)');
const backfill = db.transaction(() => {
  for (const a of articles) {
    stmt.run(a.rowid, a.title, stripHtml(a.content));
  }
});
backfill();
```

---

## Code Examples

### HTML Strip (Node.js)
```typescript
// Simple and sufficient for Tiptap HTML output
// Handles <p>, <strong>, <em>, <a class="...">, <ul>, <li>, etc.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')   // replace tags with space (not empty, preserves word boundaries)
    .replace(/&nbsp;/g, ' ')    // decode common entity
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
```

### FTS5 MATCH with safe user input
```typescript
// In the search route handler
const safeQuery = `"${search.replace(/"/g, '""')}"`;
const results = db.prepare(`
  SELECT
    a.id, a.title, a.article_type, a.category_id, a.created_at, a.updated_at,
    c.name as category_name, c.color as category_color,
    snippet(kb_articles_fts, 1, '<mark>', '</mark>', '…', 25) AS snippet
  FROM kb_articles_fts fts
  JOIN kb_articles a ON a.rowid = fts.rowid
  LEFT JOIN kb_categories c ON a.category_id = c.id
  WHERE kb_articles_fts MATCH ?
  ORDER BY rank
`).all(safeQuery);
```

### Reverse ticket lookup (already joinable, just needs the route)
```typescript
// GET /api/kb/articles/:id/tickets
const tickets = db.prepare(`
  SELECT t.id, t.title, t.status, t.priority, t.created_at, t.updated_at
  FROM tickets t
  JOIN ticket_kb_links tkl ON t.id = tkl.ticket_id
  WHERE tkl.article_id = ?
  ORDER BY tkl.created_at DESC
`).all(req.params.id);
res.json(tickets);
```

### Frontend: render snippet with `<mark>` safely
```tsx
// snippet is a string like "…some text with <mark>matched</mark> word…"
// dangerouslySetInnerHTML is safe here: snippet comes from our own DB, content is HTML-stripped plain text
// Only our controlled <mark> tags are present
<p
  className="text-sm text-muted-foreground mt-1 line-clamp-2"
  dangerouslySetInnerHTML={{ __html: article.snippet }}
/>
```

### Frontend: type badge
```tsx
const TYPE_LABELS: Record<string, string> = {
  'how-to': 'Instruktion',
  'solution': 'Lösning',
};

{article.article_type && (
  <Badge variant="outline" className="text-xs">
    {TYPE_LABELS[article.article_type]}
  </Badge>
)}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LIKE-based search | FTS5 BM25 ranked search | Phase 02 | Correct ranking, no false HTML-tag matches, snippet support |
| No reverse link from article | `GET /api/kb/articles/:id/tickets` | Phase 02 | Traceability: see which tickets drove a KB article |
| Untyped articles | Optional `article_type` with filter | Phase 02 | Browse by "Instruktion" vs "Lösning" |

---

## Key Findings Summary

1. **FTS5 is available.** `better-sqlite3` v11 bundles SQLite with FTS5 compiled in — no configuration needed, confirmed by checking the connection setup (no FTS-disable pragma).

2. **The rowid join pattern is critical.** `kb_articles` uses TEXT UUID primary keys. The FTS5 join MUST use `a.rowid = fts.rowid` — this is flagged in STATE.md as a known concern for this exact phase.

3. **Manual FTS sync (no triggers for INSERT/UPDATE).** Triggers cannot call Node.js. HTML stripping must happen in the route handler. INSERT/UPDATE to FTS happens inside a `db.transaction()` in the route. Only the DELETE trigger can be a pure SQL trigger.

4. **Backfill is required.** Existing articles have no FTS rows. The migration script must backfill using a Node.js loop (not pure SQL) because HTML stripping cannot run in SQL triggers.

5. **`article_type` needs to flow through 5 places:** DB migration, `KbArticleRow` TypeScript interface, `getKbArticles` API method + URL params, article form (selector), article list (badge + filter).

6. **snippet() output must use `dangerouslySetInnerHTML`.** The snippet contains `<mark>` tags that must render as HTML. This is safe: the content is HTML-stripped plain text + only our own `<mark>` wrapper; no user HTML reaches the snippet.

7. **No new route file needed.** The new `GET /api/kb/articles/:id/tickets` endpoint slots into the existing `kb.ts` router.

---

## Open Questions

1. **FTS5 category/type filtering: JOIN approach vs. two-step**
   - What we know: FTS5 MATCH cannot directly filter on non-FTS columns in the WHERE clause without a join; joining `kb_articles` solves this.
   - What's unclear: Performance with many articles — but this is a single-user system, article count will never be large enough to matter.
   - Recommendation: Single JOIN query as shown in code examples above.

2. **`content` vs `content_plain` in FTS5: content table vs shadow table**
   - What we know: FTS5 supports a "content table" mode (`content='kb_articles'`) that avoids duplicating data but requires triggers for all operations. Without the content table option, a shadow table stores a copy.
   - What's unclear: Whether content table mode simplifies things.
   - Recommendation: Use `content=''` (no content table) with a separate `content_plain` column in the FTS virtual table. This is simpler and works cleanly with the manual-sync approach. The data duplication is minimal (plain text, no HTML markup).

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `server/src/routes/kb.ts` — full current search implementation
- Direct code inspection: `server/src/db/add-kb-tables.ts` — schema including `ticket_kb_links` indexes
- Direct code inspection: `server/src/db/connection.ts` — better-sqlite3 v11, no FTS-disable pragma
- Direct code inspection: `server/src/db/add-template-type.ts` — established migration file pattern
- Direct code inspection: `src/pages/KnowledgeBase.tsx`, `KBArticleDetail.tsx`, `KBArticleForm.tsx` — full current UI
- Direct code inspection: `src/lib/api.ts` — `KbArticleRow` type, all KB API methods
- `.planning/STATE.md` — settled project decision: "FTS5 HTML stripping happens in Node.js route, not in SQLite trigger" and "FTS5 rowid join pattern must use a.rowid = fts.rowid"
- `server/package.json` — `better-sqlite3: ^11.7.0` confirmed

### Secondary (MEDIUM confidence)
- SQLite FTS5 documentation knowledge (training data) — FTS5 `snippet()` function signature, MATCH syntax, `content=''` option

---

## Metadata

**Confidence breakdown:**
- DB schema changes: HIGH — code read directly, pattern confirmed from migration files
- FTS5 implementation: HIGH — standard SQLite FTS5, confirmed by STATE.md decisions and better-sqlite3 version
- Route changes: HIGH — existing route fully read, join pattern confirmed
- Frontend changes: HIGH — all three component files read in full, existing patterns (Badge, Select) confirmed

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable dependencies, no external API changes)
