# Technology Stack — Library Additions

**Project:** IT Ticket System
**Milestone scope:** CSV export, PDF export, SQLite full-text search (KB articles)
**Researched:** 2026-03-22
**Overall confidence:** HIGH (FTS5 from official SQLite docs; CSV/PDF from training data + package ecosystem knowledge; no contradicting signals found)

---

## Existing Stack (do not change)

React 18.3.1 + Vite 7 + Express 4.21.2 + better-sqlite3 11.7.0 + TypeScript 5.8.3.
All new libraries must fit without replacing anything already installed.

---

## Feature 1: CSV Export

### Recommendation: No new dependency — use built-in string construction

**Rationale:** The export scope is a flat table of ticket rows (id, title, status, priority, category, created_at, resolved_at, etc.). This is exactly the case where a dedicated library adds overhead with zero benefit. SQLite returns plain JS objects; converting them to CSV is a one-function operation.

**Implementation pattern (server-side, Express route):**

```typescript
// server/src/routes/reports.ts
function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(','))
  ].join('\r\n');
}

router.get('/export/csv', authenticate, (req, res) => {
  // apply same filters as ticket list
  const rows = db.prepare('SELECT ... FROM tickets WHERE ...').all();
  const csv = rowsToCsv(rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"');
  res.send(csv);
});
```

**Why not a library:**
- `csv-stringify` (from the `csv` monorepo by wdavidw) is the standard library choice — well-maintained, excellent streaming support — but its value is for streaming large datasets or complex quoting rules. For a single-admin IT system with dozens to hundreds of tickets, the overhead of a library dependency is not justified.
- `papaparse` is client-side first and designed for parsing, not generation.
- `fast-csv` is heavy and designed for pipelines.

**If ticket counts grow above ~10,000 rows**, switch to `csv-stringify` in streaming mode (`^6.x`). That migration is a one-function swap with no frontend changes.

**New dependencies:** None.

---

## Feature 2: PDF Export

### Recommendation: `@react-pdf/renderer` on the client (frontend)

**Version:** `^4.x` (latest stable as of knowledge cutoff, maintained actively)

**Install location:** Frontend (`package.json` root)

```bash
npm install @react-pdf/renderer
```

**Rationale:**

The PDF output is a "reports PDF" — structured ticket data with headers, tables, maybe charts as images. The two realistic server-side options are `PDFKit` and Puppeteer. Neither fits well:

- **PDFKit** produces PDFs via a low-level drawing API (lines, text at x/y coordinates). Building a table layout for ticket data requires significant imperative boilerplate. It has no concept of React components or HTML — every column must be positioned manually. Produces files server-side, but authoring cost is high.
- **Puppeteer** (headless Chrome) is a 200–400MB binary that must ship inside the Docker container. For a Docker-deployed single-user internal tool, adding Chromium to the backend image to print a ticket table is operationally disproportionate. Cold start is slow. Alpine compatibility requires extra setup (`--no-sandbox` flags, font packages).
- **jsPDF** is browser-only and produces poor results for table layouts without a separate `jspdf-autotable` plugin. HTML-to-PDF conversion via `html2canvas` is fragile.

`@react-pdf/renderer` uses React's reconciler to render a PDF-specific component tree (using `View`, `Text`, `Page`, `Document` primitives). It runs entirely in the browser — no server involvement, no binary dependencies. The output is a proper PDF with selectable text (not a screenshot). Since the frontend already uses React 18, the integration is zero-friction: use `PDFDownloadLink` or `usePDF` hook, and the download triggers in-browser.

**What to render:** A `Document` with one `Page` per export, containing a `View`-based table of ticket rows matching the current filter state. The same filters the user has active on the Reports page drive what rows are fetched before the component renders.

**Trade-off to accept:** The PDF is generated client-side, so very large exports (1,000+ tickets) may block the main thread momentarily. This is acceptable for a single-admin tool with typical ticket volumes. `@react-pdf/renderer` supports `usePDF` with a Web Worker via `pdf.worker.js` if this becomes an issue, but it is unlikely to matter here.

**Alternatives ruled out:**

| Library | Location | Ruled out because |
|---------|----------|-------------------|
| PDFKit | Server | Low-level drawing API, high authoring cost for tables |
| Puppeteer | Server | 300MB+ binary, Alpine complexity, overkill |
| jsPDF | Client | Requires autotable plugin, canvas-based (not selectable text) |
| html2pdf.js | Client | Canvas screenshot, poor quality, not selectable |

**New dependencies:** `@react-pdf/renderer` (frontend only).

---

## Feature 3: SQLite Full-Text Search for KB Articles

### Recommendation: FTS5 virtual table, no additional library

**Implementation:** Server-side SQL migration + updated query in the `kb.ts` route.

**Why FTS5, not FTS4:**

FTS5 is SQLite's current full-text search module, shipping as part of the standard amalgamation since SQLite 3.9.0 (2015). `better-sqlite3` v11 bundles a recent SQLite build (3.45+) which includes FTS5 compiled in. FTS4 is the legacy predecessor with no active development. There is no reason to use FTS4 in a new implementation.

Key FTS5 advantages relevant to this use case:
- Built-in BM25 ranking (`ORDER BY rank`) — returns more relevant articles first
- `snippet()` auxiliary function — extracts matched context with highlighted terms
- `highlight()` auxiliary function — returns the full column with match terms wrapped in tags
- Better prefix query performance (`term*`)
- Unicode61 tokenizer by default — handles international characters correctly (relevant: UI is in Swedish)

**Content storage strategy: External Content table**

`kb_articles` already exists as a normal table. FTS5 supports an "external content" mode where the FTS index references the source table rather than duplicating data:

```sql
CREATE VIRTUAL TABLE kb_articles_fts USING fts5(
  title,
  content,
  content='kb_articles',
  content_rowid='rowid'
);
```

This approach:
- Does not duplicate article text in the FTS index (saves space)
- Requires keeping the FTS index in sync via triggers (INSERT/UPDATE/DELETE on `kb_articles`)
- Is the correct pattern for tables that already exist with their own primary key

**Sync triggers:**

```sql
-- Keep FTS index in sync with kb_articles
CREATE TRIGGER kb_articles_fts_insert AFTER INSERT ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER kb_articles_fts_delete AFTER DELETE ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER kb_articles_fts_update AFTER UPDATE ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO kb_articles_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;
```

**Note on rowid vs TEXT primary key:** The `kb_articles` table uses `id TEXT PRIMARY KEY` (UUID). SQLite TEXT primary keys are aliases for rowid only when they are INTEGER type — UUID TEXT PKs get their own rowid internally. The FTS `content_rowid` must map to the integer rowid of `kb_articles`, not the UUID `id`. In the search query, join back on `rowid` to retrieve the UUID `id`:

```sql
SELECT a.id, a.title, a.category_id, a.updated_at,
       snippet(kb_articles_fts, 1, '<mark>', '</mark>', '...', 20) AS excerpt
FROM kb_articles_fts
JOIN kb_articles a ON kb_articles_fts.rowid = a.rowid
WHERE kb_articles_fts MATCH ?
ORDER BY kb_articles_fts.rank;
```

**Content note:** KB article content is stored as Tiptap HTML (rich text). FTS5 will index the raw HTML including tags (`<p>`, `<strong>`, etc.). This is acceptable — searches will still match the text content correctly, and tag strings like "strong" are unlikely to appear in search queries. For a higher-quality solution, strip HTML server-side before indexing (a simple regex or `striptags` package), but this is an optimization, not a requirement.

**Migration approach:** Add a new migration script (`server/src/db/add-kb-fts.ts`) following the existing pattern. It:
1. Creates the FTS5 virtual table
2. Creates the three sync triggers
3. Populates the FTS index from existing articles: `INSERT INTO kb_articles_fts(rowid, title, content) SELECT rowid, title, content FROM kb_articles`

**New dependencies:** None. FTS5 is part of SQLite.

---

## Summary: New Dependencies

| Feature | New Package | Location | Version |
|---------|-------------|----------|---------|
| CSV export | none | — | — |
| PDF export | `@react-pdf/renderer` | frontend | `^4.x` |
| KB full-text search | none | — | — |

Total new packages: **1**.

---

## What NOT to Use

| Library | Avoid because |
|---------|--------------|
| `puppeteer` / `playwright` | Chromium binary in Docker, 300MB+ overhead, Alpine incompatibility |
| `pdfkit` | Low-level drawing API; building table layouts is expensive boilerplate |
| `jspdf` + `jspdf-autotable` | Canvas-based (non-selectable text), needs two packages |
| `papaparse` | CSV parser, not generator; browser-first |
| `csv-stringify` | Unnecessary for small-volume flat exports; adopt if volume grows |
| `better-sqlite3-fts5` | Not a real package; FTS5 is built into better-sqlite3 already |
| FTS4 | Legacy, superseded by FTS5, no advantages for new implementations |
| Elasticsearch / Meilisearch | External search service contradicts the "no new databases" constraint |

---

## Sources

- SQLite FTS5 official documentation: https://www.sqlite.org/fts5.html (HIGH confidence — fetched directly)
- `@react-pdf/renderer` GitHub: https://github.com/diegomura/react-pdf (MEDIUM confidence — training data, well-established library)
- `better-sqlite3` v11 bundled SQLite version: package changelog (MEDIUM confidence — SQLite 3.45+ confirmed for v11.x)
- CSV construction approach: established pattern for small flat exports (HIGH confidence — no library needed for RFC 4180 compliance at this scale)
