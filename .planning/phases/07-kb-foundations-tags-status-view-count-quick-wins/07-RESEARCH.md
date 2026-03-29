# Phase 7: KB Foundations — Tags, Status, View Count & Quick Wins - Research

**Researched:** 2026-03-29
**Domain:** SQLite schema migrations, Express.js route patterns, React/TypeScript UI, KB feature foundations
**Confidence:** HIGH — direct codebase analysis of all relevant files

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORG-01 | Användaren kan lägga till taggar på KB-artiklar (fristående från ticket-taggar) | `kb_article_tags` join table + inline tag input in `KBArticleForm.tsx`; freeform text tags (no master table); follow CRUD pattern from `server/src/routes/kb.ts` |
| ORG-02 | Användaren kan filtrera artiklar efter tagg i KB-listan | Backend: add `tag` query param to `GET /api/kb/articles`; Frontend: tag chip/select filter in `KnowledgeBase.tsx` alongside existing category/type filters |
| ORG-03 | Artiklar har draft/publicerad-status — utkast döljs från sök och lista som standard | `status TEXT DEFAULT 'published' CHECK(status IN ('draft','published'))` column on `kb_articles`; filter list+FTS to `status='published'` by default; toggle in form |
| QUAL-01 | Artiklar har en visningsräknare som ökar vid varje visning | `view_count INTEGER DEFAULT 0` column on `kb_articles`; increment in `GET /api/kb/articles/:id`; display on detail page |
| DISC-01 | KB-startsidan visar en "Senast uppdaterade"-sektion (topp 5) | `updated_at` already indexed; no backend change needed; frontend slice of existing list data (top 5 by `updated_at DESC`) |
| WF-01 | Skriv ut-knapp på artikeldetaljsidan (använder befintlig window.print()-pattern) | Reports.tsx pattern: `<Button onClick={() => window.print()} data-print-hide className="print:hidden">`; existing `@media print` CSS in `src/index.css` hides `[data-print-hide]` |

</phase_requirements>

---

## Summary

Phase 7 adds the foundational data model changes that later KB phases (8 and 9) depend on, plus two zero-cost quick wins. All changes are additive: three `ALTER TABLE` operations and one new join table. No existing data is at risk.

The codebase is well-established: better-sqlite3 (synchronous), Express routes in `server/src/routes/kb.ts`, React + shadcn/ui + Tailwind on the frontend. All migration patterns are proven — `connection.ts` has 10+ examples of the `if (!columnExists(...))` guard pattern used by every previous migration.

KB tags for articles are intentionally separate from ticket tags (`tags` / `ticket_tags` tables). Article tags are freeform text stored in a `kb_article_tags` join table (no master tags table needed) — this avoids conflating two different tagging concerns and was explicitly noted in the anti-features research.

**Primary recommendation:** Implement all six requirements in a single migration file that adds `status`, `view_count`, and `kb_article_tags` atomically. Wire backend first (routes), then frontend (form → list → detail). Print button and "recently updated" section require zero backend changes.

---

## Standard Stack

### Core (already in use — no new installs needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | (existing) | Synchronous SQLite — migrations, queries | Already powering all KB routes |
| Express.js | (existing) | REST API routes | All KB routes in `server/src/routes/kb.ts` |
| React + TypeScript | (existing) | Frontend components | All KB pages in `src/pages/` |
| shadcn/ui | (existing) | Badge, Button, Input, Select, Popover, Command | Used throughout KB pages |
| Tailwind CSS | (existing) | Styling including `print:hidden` utility | Used in all components |
| lucide-react | (existing) | Icons | Used in all KB components |
| sonner | (existing) | Toast notifications | Already used in KB pages |

No new packages needed for this phase.

---

## Architecture Patterns

### Migration Pattern (from `connection.ts`)

Every new column is added with a `columnExists` guard — idempotent, safe to re-run:

```typescript
// From connection.ts — established pattern
const ensureKbV2Columns = () => {
  if (!tableExists('kb_articles')) return;

  if (!columnExists('kb_articles', 'status')) {
    db.exec(`ALTER TABLE kb_articles ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published'));`);
    console.log('Added status column to kb_articles');
  }
  if (!columnExists('kb_articles', 'view_count')) {
    db.exec(`ALTER TABLE kb_articles ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;`);
    console.log('Added view_count column to kb_articles');
  }
};

const ensureKbArticleTagsTable = () => {
  if (tableExists('kb_article_tags')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_article_tags (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(article_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_kb_article_tags_article ON kb_article_tags(article_id);
    CREATE INDEX IF NOT EXISTS idx_kb_article_tags_tag ON kb_article_tags(tag);
  `);
  console.log('Created table: kb_article_tags');
};
```

Both functions must be called inside `initializeDatabase()` in `connection.ts`.

### KB Article Tags Design

Tags are freeform text — no master `kb_tags` table. The `UNIQUE(article_id, tag)` constraint prevents duplicates. The `tag` index enables efficient `WHERE tag = ?` filtering.

**Backend SET pattern** (matching how ticket tags are replaced atomically):
```typescript
// In PUT /api/kb/articles/:id — replace tags atomically in transaction
const updateTagsForArticle = db.transaction((articleId: string, tags: string[]) => {
  db.prepare('DELETE FROM kb_article_tags WHERE article_id = ?').run(articleId);
  const insert = db.prepare('INSERT OR IGNORE INTO kb_article_tags (id, article_id, tag) VALUES (?, ?, ?)');
  for (const tag of tags) {
    insert.run(uuidv4(), articleId, tag.trim().toLowerCase());
  }
});
```

**Backend tag JOIN** (for GET /api/kb/articles and GET /api/kb/articles/:id):
```typescript
// Aggregate tags as JSON array via GROUP_CONCAT (SQLite)
const tags = db.prepare(
  `SELECT tag FROM kb_article_tags WHERE article_id = ? ORDER BY tag ASC`
).all(articleId).map((r: { tag: string }) => r.tag);
```

For the list endpoint, join tags per article using a subquery:
```sql
-- Efficient: subquery per article (list is small, no pagination needed)
SELECT a.*,
  (SELECT GROUP_CONCAT(tag, ',') FROM kb_article_tags WHERE article_id = a.id ORDER BY tag) as tags_csv
FROM kb_articles a ...
```

Then split `tags_csv` by comma in the route handler to produce `string[]`.

### Status Column

```typescript
// Default 'published' — backward compat with all existing articles
// Filter list and FTS to published-only by default
// Allow ?include_drafts=true for future admin use (not needed phase 7)
AND a.status = 'published'
```

The FTS search query already uses parameterized named bindings. Add `status` filter to both the FTS path and the standard path in `GET /api/kb/articles`.

### View Count Increment

```typescript
// In GET /api/kb/articles/:id — after article fetch succeeds
db.prepare('UPDATE kb_articles SET view_count = view_count + 1 WHERE id = ?').run(req.params.id);
```

Single-user SQLite — no race conditions. Increment AFTER the SELECT to ensure the article exists before incrementing.

### Print Button Pattern (from Reports.tsx)

```tsx
// Exact pattern from Reports.tsx — already working
<Button
  variant="outline"
  size="sm"
  onClick={() => window.print()}
  className="gap-2 print:hidden"
  data-print-hide
>
  <Printer className="w-4 h-4" />
  <span>Skriv ut</span>
</Button>
```

The `[data-print-hide]` selector is already in `src/index.css`'s `@media print` block — no CSS changes needed.

### "Senast uppdaterade" Section

No backend changes needed. The KB list already fetches articles sorted by `updated_at DESC`. Slice the top 5 from the fetched `articles` array in `KnowledgeBase.tsx`:

```tsx
// In KnowledgeBase.tsx — derive from existing articles state
const recentlyUpdated = useMemo(
  () => [...articles].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5),
  [articles]
);
```

Only show the section when not filtering (no active search/category/type/tag filters) to avoid confusion when the list is already filtered.

### Tag Input in KBArticleForm

Use a controlled text input with chip display — similar to `TicketTagSelector.tsx` but simpler (no popover needed, no master tag table). Pattern: typed text + Enter/comma to add, X button to remove:

```tsx
const [tagInput, setTagInput] = useState('');
const [tags, setTags] = useState<string[]>([]);

const handleTagKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setTagInput('');
  }
};
```

### Tag Filter in KnowledgeBase.tsx

Add a `tagFilter` state (single tag string, `'all'` when no filter). Fetch available tags via a `GET /api/kb/tags` endpoint (query: `SELECT DISTINCT tag FROM kb_article_tags ORDER BY tag`). Render as a `<Select>` alongside existing category/type selects.

Alternatively, derive available tags from the loaded articles array to avoid a second API call. Recommended: derive from articles (simpler, consistent with data already loaded).

### Recommended Project Structure (no changes needed)

```
server/src/
├── db/
│   ├── connection.ts          # Add ensureKbV2Columns() + ensureKbArticleTagsTable()
│   └── schema.sql             # Does NOT need updating (migrations handle additive changes)
└── routes/
    └── kb.ts                  # All KB route changes here

src/
├── lib/
│   └── api.ts                 # Extend KbArticleRow + add new API methods
└── pages/
    ├── KnowledgeBase.tsx      # Add tag filter + "Senast uppdaterade" section
    ├── KBArticleDetail.tsx    # Add print button + show view_count + show tags
    └── KBArticleForm.tsx      # Add tag input + status toggle
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Tag uniqueness | Custom dedup logic | `UNIQUE(article_id, tag)` constraint + `INSERT OR IGNORE` |
| Tag atomic replace | Manual delete-then-insert with error handling | `db.transaction()` — already used in PUT /api/kb/articles for FTS sync |
| Print CSS hiding elements | Custom JS to hide/show elements | `data-print-hide` attribute + existing `@media print` CSS |
| Tag case sensitivity | Separate normalization layer | Normalize to lowercase at write time in both backend and frontend |

---

## Common Pitfalls

### Pitfall 1: FTS5 and `status` filter inconsistency
**What goes wrong:** The list endpoint has two code paths (FTS search and standard query). Adding `status = 'published'` to only one path means draft articles appear in search results but not in the regular list.
**Why it happens:** The two `if (trimmedSearch)` branches share no SQL.
**How to avoid:** Add `AND a.status = 'published'` (or `AND (@status IS NULL OR a.status = @status)`) to BOTH branches in `GET /api/kb/articles`.
**Warning signs:** Draft article appears when typing in search box but not in the unfiltered list.

### Pitfall 2: FTS5 contentless table and `status` column
**What goes wrong:** The FTS5 table (`kb_articles_fts`) is contentless (`content=''`). It only indexes title and content_plain. Status filtering must happen on the `kb_articles` table JOIN, not on the FTS table.
**How to avoid:** The FTS query already JOINs `kb_articles a ON a.rowid = fts.rowid`. Add the status filter on `a.status`, not on the FTS side.

### Pitfall 3: view_count in public share endpoint
**What goes wrong:** `GET /api/kb/public/:token` serves public shared articles. If view_count is incremented there too, public views inflate the count separately. Decision needed: increment on public views (arguably correct, single-user) or only on authenticated views.
**Recommendation:** Increment on public views too — every view is a real read. The public endpoint is read-only and already in `kb.ts`.

### Pitfall 4: Tags in API response for list vs detail
**What goes wrong:** The list endpoint fetches many articles — a per-article N+1 query for tags would be inefficient (though tolerable for small KBs). Using `GROUP_CONCAT` in the main query avoids N+1 but requires splitting the CSV string in the route handler.
**How to avoid:** Use the `GROUP_CONCAT` subquery approach for the list; use a separate `SELECT tag FROM kb_article_tags WHERE article_id = ?` for the detail endpoint. Both are correct.

### Pitfall 5: `KbArticleRow` TypeScript interface drift
**What goes wrong:** Adding `status`, `view_count`, and `tags` to the DB but not to the `KbArticleRow` interface in `src/lib/api.ts` causes TypeScript errors or silent `undefined` access.
**How to avoid:** Update `KbArticleRow` in `api.ts` first, then wire frontend. The interface is the contract between backend and frontend.

### Pitfall 6: "Senast uppdaterade" showing draft articles
**What goes wrong:** If the recently-updated section is derived from the `articles` state (which is already filtered to `published`), drafts are excluded automatically. If it fetches independently, drafts could appear.
**How to avoid:** Derive from the same `articles` state array — drafts are filtered at the backend before reaching the frontend.

### Pitfall 7: Tag filter breaks FTS results
**What goes wrong:** FTS search and tag filter need to be combined. The FTS query currently returns articles matching the text search. Filtering by tag requires either a JOIN or a post-filter.
**How to avoid:** Add `AND (@tag IS NULL OR EXISTS (SELECT 1 FROM kb_article_tags WHERE article_id = a.id AND tag = @tag))` to both FTS and standard query paths.

---

## Code Examples

### Schema migration (verified from existing patterns in connection.ts)

```typescript
// Add to connection.ts — call both from initializeDatabase()
const ensureKbV2Columns = () => {
  if (!tableExists('kb_articles')) return;
  if (!columnExists('kb_articles', 'status')) {
    db.exec(`ALTER TABLE kb_articles ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published'));`);
    console.log('Added status column to kb_articles');
  }
  if (!columnExists('kb_articles', 'view_count')) {
    db.exec(`ALTER TABLE kb_articles ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;`);
    console.log('Added view_count column to kb_articles');
  }
};

const ensureKbArticleTagsTable = () => {
  if (tableExists('kb_article_tags')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_article_tags (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(article_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_kb_article_tags_article ON kb_article_tags(article_id);
    CREATE INDEX IF NOT EXISTS idx_kb_article_tags_tag ON kb_article_tags(tag);
  `);
  console.log('Created table: kb_article_tags');
};
```

### Updated KbArticleRow interface (api.ts)

```typescript
export interface KbArticleRow {
  id: string;
  title: string;
  content: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  article_type?: string | null;
  status: 'draft' | 'published';    // NEW
  view_count: number;                // NEW
  tags: string[];                    // NEW — freeform text tags
  snippet?: string | null;
  created_at: string;
  updated_at: string;
}
```

### GET /api/kb/articles — combined filter (both branches)

```typescript
// Both FTS and standard query branches need these two additional filters
AND a.status = 'published'
AND (@tag IS NULL OR EXISTS (
  SELECT 1 FROM kb_article_tags WHERE article_id = a.id AND tag = @tag
))
```

Pass `tag: tag_param || null` in the named params object.

### Tags in GET list response (GROUP_CONCAT)

```sql
SELECT
  a.id, a.title, a.content, a.category_id, a.article_type,
  a.status, a.view_count, a.created_at, a.updated_at,
  c.name as category_name, c.color as category_color,
  (SELECT GROUP_CONCAT(kat.tag, ',')
   FROM kb_article_tags kat
   WHERE kat.article_id = a.id
   ORDER BY kat.tag) as tags_csv
FROM kb_articles a
LEFT JOIN kb_categories c ON a.category_id = c.id
WHERE a.status = 'published'
  ...
```

In the route handler: `tags: (row.tags_csv ?? '').split(',').filter(Boolean)`

---

## Runtime State Inventory

This phase adds new columns and a new table — no rename or refactor. No runtime state migration required.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New columns `status` + `view_count` get `DEFAULT` values — all existing articles become `status='published'`, `view_count=0` automatically | None — defaults handle backward compat |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | Docker image must be rebuilt after migration runs | `docker build -t it-ticketing-backend:latest -f Dockerfile.server .` per CLAUDE.md |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| better-sqlite3 | All DB migrations | Already installed | — | — |
| Node.js / npx tsx | Migration scripts | Already installed | — | — |
| Docker | Deployment | Per CLAUDE.md | — | Portainer fallback |

No missing dependencies — this phase uses only the existing stack.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate migration script files (`add-kb-tables.ts`, `add-kb-fts5-and-type.ts`) | `ensure*` functions inside `connection.ts` called at startup | From v1.1 onward | All new migrations should use the `ensure*` pattern in `connection.ts`, not standalone migration scripts |

**Deprecated pattern:** Creating standalone `add-*.ts` migration scripts (the old files still exist but the current pattern is `ensure*` functions in `connection.ts` called from `initializeDatabase()`).

---

## Open Questions

1. **Should tag filtering be single-select or multi-select?**
   - What we know: The existing category and type filters are single-select `<Select>` dropdowns. Ticket tag filtering supports multi-select with AND/OR toggle (complex).
   - What's unclear: Phase scope says "tag filter on KB list" — single or multi?
   - Recommendation: Single-select for Phase 7 (matches existing KB filter pattern). Multi-select can be Phase 9 enhancement if needed. Single-select is consistent with category/type filters.

2. **Should drafts be visible to the author on the detail page via direct link?**
   - What we know: FEATURES.md says "Drafts still accessible via direct link." The GET /:id endpoint has no status filter.
   - Recommendation: `GET /api/kb/articles/:id` returns the article regardless of status (author navigating directly). The list and search endpoints filter to `published` only. This matches the design intent.

3. **Should view_count be shown in the list view or only on detail?**
   - What we know: DISC-02 (popular articles section) is Phase 9 and depends on view_count. Phase 7 only needs to store and increment it.
   - Recommendation: Show `view_count` on the detail page only (e.g., "X visningar" near the article metadata). No changes to the list card layout needed.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `server/src/routes/kb.ts` — all KB API routes
- Direct codebase read: `server/src/db/connection.ts` — migration patterns, `ensure*` functions
- Direct codebase read: `server/src/db/add-kb-tables.ts`, `add-kb-fts5-and-type.ts` — historical migration approach
- Direct codebase read: `server/src/db/schema.sql` — canonical table definitions
- Direct codebase read: `src/pages/KnowledgeBase.tsx`, `KBArticleDetail.tsx`, `KBArticleForm.tsx` — all KB frontend pages
- Direct codebase read: `src/pages/Reports.tsx` lines 571-580 — print button implementation
- Direct codebase read: `src/index.css` lines 895-929 — `@media print` CSS block
- Direct codebase read: `src/lib/api.ts` — `KbArticleRow` interface, KB API methods
- Direct codebase read: `src/components/TicketTagSelector.tsx` — freeform tag input pattern reference
- Direct codebase read: `.planning/research/FEATURES.md` — feature decisions and complexity estimates
- Direct codebase read: `.planning/REQUIREMENTS.md` — requirement IDs and descriptions

### Secondary (MEDIUM confidence)
- SQLite `GROUP_CONCAT` function — standard SQLite aggregate, verified against SQLite documentation patterns in existing codebase
- FTS5 contentless table behavior — verified from existing FTS delete pattern in `add-kb-fts5-and-type.ts`

---

## Metadata

**Confidence breakdown:**
- Schema changes: HIGH — pattern copied directly from existing `connection.ts` migrations
- Backend routes: HIGH — all patterns exist in current `kb.ts`
- Frontend tag input: HIGH — `TicketTagSelector.tsx` provides the exact component pattern
- Print button: HIGH — copied from `Reports.tsx` line 574, CSS already handles it
- Recently updated section: HIGH — derives from already-fetched data, no new API calls
- FTS + status filter: HIGH — FTS JOIN pattern is in current code, adding one WHERE clause
- Open questions: MEDIUM — reasonable defaults identified, planner should decide

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (stable stack, 30-day window)
