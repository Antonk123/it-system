# Architecture Patterns: IT Ticket System — Milestone Features

**Domain:** IT ticket management system (Express + SQLite + React)
**Researched:** 2026-03-22
**Overall Confidence:** HIGH — based on direct codebase inspection

---

## Existing Architecture Context

The codebase uses a consistent pattern throughout:

- Routes in `server/src/routes/[domain].ts` export an Express `Router`
- Database accessed via `db` singleton from `server/src/db/connection.ts` using `better-sqlite3` synchronous API
- Migrations are idempotent functions in `connection.ts` called from `initializeDatabase()`, or standalone `server/src/db/[migration-name].ts` scripts
- All state-changing routes require `authenticate` middleware and pass CSRF protection
- Responses follow `{ data, pagination }` for lists, flat objects for single resources, `{ error: string }` for errors
- `schema.sql` is the canonical schema source; `connection.ts` adds columns/tables added after the initial schema via `ensure*` functions

**SQLite version:** `better-sqlite3` v11.7.0 bundles SQLite 3.46+. Node 20 Alpine image. FTS5 is compiled in by default in the bundled SQLite — no additional build flags required. Confidence: HIGH (better-sqlite3 has bundled SQLite with FTS5 since v7).

---

## Feature 1: Archive View

### Problem Statement

Closed tickets currently appear in the main ticket list. The `buildWhereClause` function already excludes `status = 'closed'` by default when no status filter is provided (line 352-354 in `tickets.ts`). The issue is UX — there is no dedicated archive page, and the filter to see closed tickets is not surfaced explicitly.

### Schema Changes: None Required

The existing `tickets` table already has `status` (with 'closed' as a valid value) and `closed_at` columns. No schema change is needed.

### What Needs to Change

**Backend:** No new endpoints needed. The existing `GET /api/tickets` already supports `?status=closed` filtering. The archive view can reuse the same endpoint with a forced `status=closed` parameter.

However, add a composite index to speed up archive queries (closed tickets sorted by `closed_at DESC`):

```sql
CREATE INDEX IF NOT EXISTS idx_tickets_closed_at ON tickets(status, closed_at DESC);
```

This index goes in `schema.sql` and as an `ensure*` call in `connection.ts`.

**Frontend:** Add a new route `/archive` → `ArchivePage.tsx` that calls the existing `useTickets()` hook with `status: 'closed'` locked in. The hook already accepts status as a filter parameter. The archive page should:
- Not show the status filter dropdown (it is implicitly locked to 'closed')
- Show `closed_at` as the primary sort column
- Link back to the active ticket list

**No API changes required.** Confidence: HIGH.

### Migration Strategy

Idempotent index creation in `connection.ts`:

```typescript
const ensureArchiveIndex = () => {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tickets_closed_at ON tickets(status, closed_at);
  `);
};
```

Call `ensureArchiveIndex()` inside `initializeDatabase()`. Existing data is unaffected.

---

## Feature 2: KB ↔ Ticket Two-Way Linking

### Problem Statement

The schema already has `ticket_kb_links` (added via `add-kb-tables.ts` migration) and the KB route already implements the ticket→article direction. The missing piece is the reverse direction: given an article, show which tickets reference it.

### Existing Schema (already complete)

```sql
CREATE TABLE IF NOT EXISTS ticket_kb_links (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ticket_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_kb_links_ticket ON ticket_kb_links(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_kb_links_article ON ticket_kb_links(article_id);
```

Both indexes exist. The schema is fully capable of bidirectional queries.

### What Needs to Change

**Backend — add reverse lookup endpoint in `server/src/routes/kb.ts`:**

```
GET /api/kb/articles/:id/tickets
```

Query:
```sql
SELECT
  t.id, t.title, t.status, t.priority, t.created_at, t.closed_at,
  tkl.id as link_id
FROM ticket_kb_links tkl
JOIN tickets t ON tkl.ticket_id = t.id
WHERE tkl.article_id = ?
ORDER BY tkl.created_at DESC
```

Response: array of ticket stubs (id, title, status, priority, created_at) — not full ticket rows, as content/description bloat is unnecessary here.

**Also add:** The existing `GET /api/kb/ticket/:ticketId` endpoint already provides the ticket→article direction. No changes needed there.

**Frontend — `KBArticleDetail` page:**

Add a "Related Tickets" panel below the article content. Fetch from the new endpoint using a React Query hook (e.g. `useArticleTickets(articleId)`). Each ticket should link to `/tickets/:id`.

### Schema Changes: None

The `ticket_kb_links` table and both directional indexes are already present in `schema.sql`. The only addition is the API endpoint and frontend panel.

**No migration required.** Confidence: HIGH.

---

## Feature 3: KB Full-Text Search

### Problem Statement

The current `GET /api/kb/articles?search=` uses `LIKE '%term%'` against `title` and `content`. This has two problems:
1. Performance degrades as content grows (full table scan, no index on TEXT content)
2. No relevance ranking — results are unsorted by match quality

### Recommended Approach: SQLite FTS5 Virtual Table

FTS5 is the right tool. It is built into the bundled SQLite in `better-sqlite3` v11, requires no additional dependencies, and handles HTML content correctly (it tokenises text, ignoring angle brackets when using the default `unicode61` tokenizer).

### Schema Changes: New FTS5 Virtual Table

Add to `schema.sql` (idempotent — uses `CREATE VIRTUAL TABLE IF NOT EXISTS`):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts
USING fts5(
  title,
  content,
  content='kb_articles',
  content_rowid='rowid'
);
```

This is a **content table** configuration — FTS5 stores the index only, reading actual content from `kb_articles` on demand. This avoids data duplication.

**Triggers to keep the index current** (add to `schema.sql`):

```sql
CREATE TRIGGER IF NOT EXISTS kb_articles_ai AFTER INSERT ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS kb_articles_ad AFTER DELETE ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content)
  VALUES('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS kb_articles_au AFTER UPDATE ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content)
  VALUES('delete', old.rowid, old.title, old.content);
  INSERT INTO kb_articles_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;
```

**Initial population** (one-time, in the migration function):

```typescript
db.exec(`INSERT INTO kb_articles_fts(rowid, title, content)
  SELECT rowid, title, content FROM kb_articles`);
```

This must only run when the FTS table is empty (i.e., first-time setup). Wrap with:

```typescript
const count = (db.prepare('SELECT COUNT(*) as c FROM kb_articles_fts').get() as { c: number }).c;
if (count === 0) { /* populate */ }
```

### SQLite Constraint: FTS5 and `CREATE VIRTUAL TABLE IF NOT EXISTS`

`CREATE VIRTUAL TABLE IF NOT EXISTS` is supported and idempotent in SQLite 3.16+. Safe to add to `schema.sql`.

The triggers also use `IF NOT EXISTS` syntax which is valid in SQLite.

### API Changes: Modify `GET /api/kb/articles`

When a `search` query param is present, switch from LIKE to FTS5:

```typescript
// FTS5 path
const ftsQuery = `
  SELECT
    a.id, a.title, a.content, a.category_id, a.created_at, a.updated_at,
    c.name as category_name, c.color as category_color
  FROM kb_articles_fts fts
  JOIN kb_articles a ON fts.rowid = a.rowid
  LEFT JOIN kb_categories c ON a.category_id = c.id
  WHERE kb_articles_fts MATCH ?
  ORDER BY rank
`;
```

The `?` parameter for FTS5 MATCH uses the FTS5 query syntax. Pass the user's search term directly — FTS5 handles tokenisation. For safety, wrap bare terms in quotes to prevent FTS5 syntax errors from user input:

```typescript
const safeTerm = `"${search.replace(/"/g, '""')}"`;
```

No fallback to LIKE is needed — if `search` is absent, use the original plain SELECT path.

### Migration Strategy

Add an `ensureKbArticlesFts()` function in `connection.ts`:

```typescript
const ensureKbArticlesFts = () => {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts
    USING fts5(title, content, content='kb_articles', content_rowid='rowid');

    CREATE TRIGGER IF NOT EXISTS kb_articles_ai AFTER INSERT ON kb_articles BEGIN
      INSERT INTO kb_articles_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS kb_articles_ad AFTER DELETE ON kb_articles BEGIN
      INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS kb_articles_au AFTER UPDATE ON kb_articles BEGIN
      INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
      INSERT INTO kb_articles_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
    END;
  `);

  const row = db.prepare('SELECT COUNT(*) as c FROM kb_articles_fts').get() as { c: number };
  if (row.c === 0) {
    const articleCount = (db.prepare('SELECT COUNT(*) as c FROM kb_articles').get() as { c: number }).c;
    if (articleCount > 0) {
      db.exec(`INSERT INTO kb_articles_fts(rowid, title, content) SELECT rowid, title, content FROM kb_articles`);
    }
  }
};
```

Call inside `initializeDatabase()`. Safe to run on any existing database. Confidence: HIGH.

**HTML content note:** The `content` column stores Tiptap-generated HTML. FTS5's default `unicode61` tokenizer treats `<`, `>`, `/` as separator characters and will index the text nodes correctly. A search for "password reset" will match even if the article content is `<p>password reset procedure</p>`. No stripping of HTML is needed before indexing.

---

## Feature 4: Reports

### Problem Statement

No `/api/reports` endpoint exists. The frontend has `recharts` installed and a `Reports.tsx` page in the pages directory (referenced in STRUCTURE.md), but it is not yet wired to real data. Reports need aggregate SQL queries against `tickets`.

### Schema Changes: None

All data exists in `tickets`. No new tables needed. Existing indexes on `status`, `priority`, `category_id`, and `created_at` are sufficient for the queries below.

### New Endpoint: `GET /api/reports/summary`

Create `server/src/routes/reports.ts`. Mount in `index.ts` as `app.use('/api/reports', reportsRoutes)`.

**Endpoint parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `dateFrom` | ISO string | Start of period (inclusive) |
| `dateTo` | ISO string | End of period (inclusive) |
| `groupBy` | `week` or `month` | Time bucket granularity |

**Response shape:**

```typescript
{
  overview: {
    total: number;
    byStatus: { status: string; count: number }[];
    byPriority: { priority: string; count: number }[];
  };
  byCategory: { category_id: string; category_name: string; count: number }[];
  byTag: { tag_id: string; tag_name: string; count: number }[];
  trend: { period: string; opened: number; closed: number; resolved: number }[];
}
```

**SQL for `overview.byStatus`:**

```sql
SELECT status, COUNT(*) as count
FROM tickets
WHERE created_at >= ? AND created_at <= ?
GROUP BY status
```

**SQL for `byCategory`:**

```sql
SELECT
  t.category_id,
  c.name as category_name,
  COUNT(*) as count
FROM tickets t
LEFT JOIN categories c ON t.category_id = c.id
WHERE t.created_at >= ? AND t.created_at <= ?
GROUP BY t.category_id
ORDER BY count DESC
```

**SQL for `trend` (weekly buckets):**

SQLite does not have `DATE_TRUNC`. Use `strftime` instead:

```sql
-- Weekly grouping
SELECT
  strftime('%Y-W%W', created_at) as period,
  COUNT(*) as opened,
  SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
  SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
FROM tickets
WHERE created_at >= ? AND created_at <= ?
GROUP BY strftime('%Y-W%W', created_at)
ORDER BY period ASC

-- Monthly grouping
SELECT
  strftime('%Y-%m', created_at) as period,
  COUNT(*) as opened,
  SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
  SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
FROM tickets
WHERE created_at >= ? AND created_at <= ?
GROUP BY strftime('%Y-%m', created_at)
ORDER BY period ASC
```

**Important SQLite note:** `strftime('%Y-W%W', ...)` uses ISO week numbering where week starts on Sunday. This is consistent but differs from ISO 8601 week numbering (starts Monday). For a single-user internal tool this is acceptable. Document it in code comments.

**SQL for `byTag`:**

```sql
SELECT
  tg.id as tag_id,
  tg.name as tag_name,
  COUNT(DISTINCT tt.ticket_id) as count
FROM tags tg
JOIN ticket_tags tt ON tg.id = tt.tag_id
JOIN tickets t ON tt.ticket_id = t.id
WHERE t.created_at >= ? AND t.created_at <= ?
GROUP BY tg.id
ORDER BY count DESC
```

### New Route File: `server/src/routes/reports.ts`

Pattern follows existing routes exactly:

```typescript
import { Router, Response } from 'express';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.get('/summary', authenticate, (req: AuthRequest, res: Response) => {
  const { dateFrom, dateTo, groupBy = 'month' } = req.query as Record<string, string>;
  // ... build and run queries
  // Return combined { overview, byCategory, byTag, trend }
  res.json({ overview, byCategory, byTag, trend });
});

export default router;
```

**Performance note:** All five aggregate queries run synchronously (better-sqlite3 model) on startup of a page load. For a single-user system with hundreds to low thousands of tickets, this is fast (sub-10ms each). No caching layer needed.

### Migration Strategy

No schema changes. Only:
1. Create `server/src/routes/reports.ts`
2. Import and mount in `server/src/index.ts`

---

## Component Boundary Summary

| Feature | Schema Change | Migration | New Route | Modified Route | New Frontend |
|---------|---------------|-----------|-----------|----------------|--------------|
| Archive View | None | Index only | None | None | `ArchivePage.tsx` + route in `App.tsx` |
| KB Reverse Link | None | None | `GET /api/kb/articles/:id/tickets` | None | Related tickets panel in `KBArticleDetail` |
| KB FTS | FTS5 virtual table + 3 triggers | `ensureKbArticlesFts()` | None | `GET /api/kb/articles` (search path only) | No change needed |
| Reports | None | None | `GET /api/reports/summary` | None | `Reports.tsx` (wire to real data) |

---

## SQLite-Specific Constraints to Observe

### ALTER TABLE Limitations

SQLite does not support `ALTER TABLE ... ADD COLUMN` with a `NOT NULL` constraint and no default value on a non-empty table. All new columns must either:
- Have a `DEFAULT` value, or
- Be nullable

None of the above features require new columns on existing tables. This constraint is not triggered.

### No RETURNING Clause (older SQLite)

`better-sqlite3` v11 targets SQLite 3.46+ which does support `RETURNING`. However, the codebase pattern is to do a `SELECT` after `INSERT`/`UPDATE` to return the created/updated row (seen throughout `kb.ts` and `tickets.ts`). Follow the same pattern for consistency.

### FTS5 Content Tables and DELETE

When using `content=` (external content table) with FTS5, deletes must be done via the triggers above — direct `DELETE FROM kb_articles_fts` only rebuilds the index, it does not remove rows from the source table. The trigger pattern shown above is the correct FTS5 delete pattern.

### WAL Mode Already Enabled

WAL mode is already configured in `connection.ts`. FTS5 operations are fully compatible with WAL mode. No change needed.

---

## API Design: Consistency With Existing Patterns

| Concern | Existing Pattern | New Features Follow |
|---------|-----------------|---------------------|
| Auth | `authenticate` middleware on all protected routes | Yes — all new endpoints use `authenticate` |
| Error format | `res.status(N).json({ error: string })` | Yes |
| List responses | Flat array for small lists, `{ data, pagination }` for paginated | Archive reuses `useTickets()` (paginated); KB reverse links are unbounded arrays (tickets linked to an article will be small); reports returns flat object |
| ID format | UUID v4 strings | Not applicable (reports returns aggregates, no new rows) |
| Timestamps | ISO strings via `new Date().toISOString()` | Not applicable |
| Route mounting | `app.use('/api/[domain]', router)` in `index.ts` | Yes — `app.use('/api/reports', reportsRoutes)` |

---

## Sources

- Direct inspection of `server/src/db/schema.sql`, `server/src/db/connection.ts`, `server/src/routes/kb.ts`, `server/src/routes/tickets.ts`, `server/src/index.ts`
- `server/package.json`: `better-sqlite3` v11.7.0
- `Dockerfile.server`: `node:20-alpine`
- SQLite FTS5 documentation (built into SQLite 3.9+, FTS5 included in better-sqlite3 bundles): https://www.sqlite.org/fts5.html
- SQLite `strftime` date formatting: https://www.sqlite.org/lang_datefunc.html
- Confidence: HIGH for all sections (based on direct code inspection, not inference)
