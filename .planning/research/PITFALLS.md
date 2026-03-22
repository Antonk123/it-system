# Domain Pitfalls

**Domain:** IT ticket system — reports/analytics, archive, KB FTS, ticket-KB linking, CSV/PDF export
**Researched:** 2026-03-22
**Codebase:** React 18 + Vite, Express 4, better-sqlite3, recharts (already installed), Docker

---

## 1. Reports / Analytics with recharts

### CRITICAL — Reports.tsx loads all tickets with no pagination

**What goes wrong:** `useTickets()` in `Reports.tsx` (line 151) is called without a `limit`, which means it uses the default page size (10). The reports page therefore computes analytics on only the current page of tickets, not the full dataset. This is a silent data integrity bug: charts look correct but display a fraction of real history.

**Why it happens:** `useTickets` wraps the paginated `/api/tickets` endpoint. All the `useMemo` calculations run on `tickets` from that hook, not a dedicated analytics endpoint.

**Prevention:** Create a separate backend endpoint `GET /api/reports/summary` that returns pre-aggregated data (counts by status, counts by month, counts by category). Never send all raw tickets to the frontend for aggregation — this does not scale and produces wrong results if pagination is involved.

**Detection warning sign:** Charts show suspiciously round numbers or match exactly one page worth of tickets.

---

### CRITICAL — All analytics computed in-browser via useMemo on raw ticket array

**What goes wrong:** `requesterAnalytics`, `ticketsByMonth`, `ticketsClosedByYear`, and all chart data are computed in the React component with `useMemo`. As ticket count grows, these computations block the JS thread during render. `requesterAnalytics` makes `users.find()` inside a loop (O(n*m) scan), visible at line 247-248 of `Reports.tsx`.

**Why it happens:** Early convenience — recharts expects data arrays, so building them in JS feels natural.

**Prevention:**
- Move aggregation to the backend. SQLite `GROUP BY`, `strftime`, and `COUNT` are much faster than JS array iteration.
- For requester analytics: a single JOIN query replaces the nested `find()` loop.
- Keep recharts for rendering only; feed it pre-shaped data from the API.

**SQLite query pattern for monthly counts:**
```sql
SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
FROM tickets
WHERE created_at >= ?
GROUP BY month
ORDER BY month ASC
```

---

### MODERATE — Date handling: local timezone vs. UTC stored timestamps

**What goes wrong:** SQLite stores timestamps as ISO 8601 UTC strings (e.g., `2026-03-15T09:00:00.000Z`). When the frontend does `new Date(ticket.createdAt).getFullYear()`, it converts to the browser's local timezone. A ticket created at `2026-03-31T23:30:00Z` in Europe/Stockholm (UTC+2) correctly appears as April 1 in the browser but is stored as March 31. Monthly charts can be off by one day at month boundaries, producing missing or split bars.

**Prevention:**
- Do all date grouping in SQL using `strftime`, which operates on the stored UTC string consistently.
- If displaying in local time on the frontend, use `date-fns` with `parseISO` and `format` consistently — never mix `new Date(str).getMonth()` with formatted display.
- The existing `Reports.tsx` already imports `date-fns` functions (`format`, `startOfMonth`, etc.) but some paths use plain `new Date()` — audit for inconsistency.

---

### MODERATE — recharts ResponsiveContainer causes layout thrash with many charts

**What goes wrong:** `ResponsiveContainer` listens to ResizeObserver. When multiple charts are on one page (current `Reports.tsx` has at least 4: bar charts, pie charts, heatmap, sparklines), each fires resize events independently. On initial render and tab switch, this can cause visible flash/relayout.

**Prevention:**
- Set explicit `width` and `height` on charts inside tabs that are not currently visible. recharts renders all tab content; inactive tabs should not trigger expensive ResponsiveContainer calculations.
- Wrap tabs with `React.lazy` or conditional rendering: only mount charts for the active tab.
- Memoize chart data arrays so recharts does not re-render when unrelated state changes.

---

### MINOR — Recharts tooltip renders stale closure data

**What goes wrong:** Custom tooltip components (like `RequesterTooltip` at line 65 of `Reports.tsx`) use `payload[0].payload` which is fine, but if the tooltip captures variables from the parent scope via closure, those variables can be stale if state updates during hover.

**Prevention:** Keep tooltip components pure. Derive everything from `payload` and `active` props. Avoid accessing parent state in tooltip components.

---

## 2. Archive View

### MODERATE — Archive currently only shows `status = 'closed'` but misses `resolved`

**What goes wrong:** `Archive.tsx` line 69 passes `status: 'closed'` to `useTickets`. The ticket system has five statuses: `open`, `in-progress`, `waiting`, `resolved`, `closed`. Resolved tickets (which may sit for days before being manually closed) are invisible in the archive. Users who expect to find "done" tickets will not find resolved ones.

**Prevention:** The archive filter should be `status IN ('resolved', 'closed')` or offer a status picker that defaults to both. Confirm with the product requirement whether "archived" means closed-only or all terminal statuses.

---

### MODERATE — Status change confirmation in Archive does not refetch on cancel

**What goes wrong:** `Archive.tsx` shows an `AlertDialog` for status changes (lines 358-373). If the user confirms a status change that moves a ticket from `closed` to `open`, `updateTicket` is called and the ticket disappears from the archive list — but the `useTickets` hook refetches based on URL params, not a mutation callback. If `updateTicket` succeeds but the refetch is stale or cached, the ticket may linger in the UI briefly, confusing the user.

**Prevention:** After a status change in the archive, explicitly invalidate/refetch the ticket list. If using React Query, use `queryClient.invalidateQueries`. If using the current custom hook pattern, ensure `updateTicket` triggers a fresh fetch.

---

### MINOR — Reopening archived tickets from the archive view is surprising UX

**What goes wrong:** The archive's `TicketTable` exposes status change dropdowns (it passes `onStatusChange`). A user can accidentally set a closed ticket back to `open` from the archive, which removes it from the list. There is no breadcrumb or confirmation that tells them the ticket is now in the main list.

**Prevention:** Either remove the status change control from the archive view (archive as read-mostly), or show a toast with a link to the ticket's new location when it disappears from the archive.

---

## 3. KB Full-Text Search in SQLite (FTS5)

### CRITICAL — FTS5 table must be separate from the main table; cannot add FTS to existing table

**What goes wrong:** FTS5 is a virtual table type. You cannot `ALTER TABLE kb_articles ADD COLUMN ... fts`. The correct approach is creating a separate `kb_articles_fts` virtual table and keeping it in sync with `kb_articles` via triggers or manual updates. If a developer tries to modify the existing `kb_articles` table directly, FTS5 setup will fail with a confusing error.

**Correct setup pattern:**
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS kb_articles_fts USING fts5(
  title,
  content_stripped,  -- HTML stripped, plain text only
  content='kb_articles',
  content_rowid='rowid'
);

-- Populate initially
INSERT INTO kb_articles_fts(rowid, title, content_stripped)
SELECT rowid, title, strip_html(content) FROM kb_articles;

-- Keep in sync (triggers for insert/update/delete)
CREATE TRIGGER kb_fts_insert AFTER INSERT ON kb_articles BEGIN
  INSERT INTO kb_articles_fts(rowid, title, content_stripped)
  VALUES (new.rowid, new.title, new.content);
END;
```

**Prevention:** Plan the FTS5 table as a migration from day 1. Add it in a new migration file, not by modifying the schema.sql base.

---

### CRITICAL — KB articles store Tiptap HTML; FTS5 will index HTML tags as searchable text

**What goes wrong:** The `kb_articles.content` column stores Tiptap-generated HTML (e.g., `<p>Reset the <strong>password</strong></p>`). If you index this directly in FTS5, a search for "password" will match, but a search for "p>" or "strong" will also match. More problematically, boilerplate HTML like `<ul>`, `<li>`, `href=`, `class=` will bloat the FTS index with junk tokens.

**Prevention:** Strip HTML to plain text before indexing. Do not use the raw `content` column in FTS5 — create a separate `content_stripped` column or compute the stripped text at insert/update time.

**Implementation:** Use a server-side HTML stripper. In Node.js, the simplest approach is a regex strip (`content.replace(/<[^>]+>/g, ' ')`) applied before inserting to the FTS table. For better results, use the `striptags` npm package which handles edge cases.

**better-sqlite3 note:** SQLite functions cannot call external code. The stripping must happen in the Express route before calling FTS insert, not inside a SQLite trigger.

---

### CRITICAL — FTS5 `content=` mode requires manual rebuild after bulk updates

**What goes wrong:** FTS5 with `content='kb_articles'` is a "content table" configuration — the FTS index stores tokens but defers to the real table for content retrieval. This is efficient but requires that the FTS index be explicitly rebuilt after any direct database manipulation (e.g., seeding, migrations, manual SQL edits). If the FTS table is out of sync, searches return wrong results with no error.

**Rebuild command:**
```sql
INSERT INTO kb_articles_fts(kb_articles_fts) VALUES('rebuild');
```

**Prevention:** Add this rebuild command at the end of any migration that touches `kb_articles`. Document it in the migration pattern.

---

### MODERATE — FTS5 query syntax errors crash better-sqlite3 if not caught

**What goes wrong:** FTS5 uses a query syntax where `*` means prefix match, `-` means NOT, and unquoted special characters can throw errors. A user searching for `C++` or `[closed]` passes these characters directly to the FTS5 `MATCH` operator and gets a SQLite error propagated to the Express response.

**Prevention:** Wrap FTS5 searches in try/catch at the route level. If an FTS5 syntax error occurs, fall back to a `LIKE` search. Alternatively, sanitize user input by escaping or quoting the search term:
```javascript
const ftsQuery = `"${userInput.replace(/"/g, '""')}"*`;
// This searches for the literal phrase with prefix matching
```

---

### MODERATE — better-sqlite3 and FTS5: the `rowid` must match `kb_articles.rowid`

**What goes wrong:** The `kb_articles` table uses a TEXT primary key (`id` as UUID). SQLite assigns an internal `rowid` automatically. If using `content='kb_articles'` and `content_rowid='rowid'`, the FTS query returns `rowid` values, not UUID `id` values. Joining back to get the actual article requires `WHERE rowid = fts_result_rowid`, not `WHERE id = ...`.

**Prevention:** Either query by rowid and JOIN:
```sql
SELECT a.id, a.title FROM kb_articles a
JOIN kb_articles_fts ON a.rowid = kb_articles_fts.rowid
WHERE kb_articles_fts MATCH ?
ORDER BY rank
```
Or store the UUID `id` as an additional column in the FTS table (not `content=` mode), accepting the data duplication.

---

### MINOR — FTS5 default tokenizer does not handle Swedish characters well

**What goes wrong:** The default FTS5 tokenizer (`unicode61`) normalizes Unicode and handles most European characters. Swedish characters (å, ä, ö) are handled correctly by `unicode61` in SQLite 3.25+. However, the tokenizer case-folds but does not stem — "lösenord" and "lösenords" are different tokens. For a small internal tool this is acceptable, but searches for plural/possessive forms will miss singular forms.

**Prevention:** Accept the limitation for now. If stemming becomes important, consider the `porter` tokenizer (English only) or a custom tokenizer approach — but for a single-user Swedish IT tool, exact and prefix matching is sufficient. Document this limitation so users know to search for root words.

---

## 4. Two-Way Linking Between Tickets and KB Articles

### MODERATE — `ticket_kb_links` already exists; the "two-way" direction is one-directional in the UI

**What goes wrong:** The schema has `ticket_kb_links(ticket_id, article_id)` with a UNIQUE constraint (schema.sql, line 163). The API at `GET /api/kb/ticket/:ticketId` returns articles linked to a ticket. But there is no reverse query — from a KB article, you cannot see which tickets link to it. The "two-way" requirement means this reverse direction must be built.

**Prevention:** Add `GET /api/kb/articles/:articleId/tickets` endpoint that does:
```sql
SELECT t.id, t.title, t.status, t.priority, t.created_at
FROM ticket_kb_links tkl
JOIN tickets t ON tkl.ticket_id = t.id
WHERE tkl.article_id = ?
ORDER BY t.created_at DESC
```
The reverse index `idx_ticket_kb_links_article` already exists in schema.sql (line 192) — so this query is pre-optimized.

---

### MODERATE — Deleting a KB article silently removes all ticket links (CASCADE)

**What goes wrong:** `ticket_kb_links.article_id` has `ON DELETE CASCADE` (schema.sql, line 161). Deleting an article removes all links to tickets. From the ticket's perspective, linked KB articles silently disappear with no notification. The ticket's `KBLinksSection` component will simply show empty on next render with no explanation.

**Prevention:**
- Before deleting a KB article, query `ticket_kb_links` to find affected tickets. If any exist, show a warning: "This article is linked to 3 tickets. Deleting it will remove those links."
- Alternatively, soft-delete articles: add `deleted_at TEXT` to `kb_articles` and filter `WHERE deleted_at IS NULL` in all queries. This preserves links and allows recovery. A migration is required.

---

### MODERATE — Deleting a ticket silently removes all KB links from the ticket side

**What goes wrong:** Symmetrically, `ticket_kb_links.ticket_id` has `ON DELETE CASCADE` (schema.sql, line 160). When a ticket is deleted, all its KB article links are removed. The KB article now has no record of ever being linked to that ticket. For an archive/audit use case, this erases potentially useful context.

**Prevention:** Same soft-delete recommendation. Since this is a single-user system without strict audit requirements, add a brief comment in the delete route noting this behavior so future developers do not miss it.

---

### MINOR — Duplicate link prevention uses UNIQUE constraint, not application logic

**What goes wrong:** The `UNIQUE(ticket_id, article_id)` constraint in `ticket_kb_links` (schema.sql line 163) causes a SQLite error if a user tries to link the same article twice. The current `kb.ts` route (line 299-302) catches this and returns a 409. However, the frontend `LinkDialog` component may not handle the 409 specifically — it may show a generic error or silently fail.

**Prevention:** In the frontend link dialog, handle 409 responses explicitly with a clear message: "This article is already linked to this ticket." Do not rely on the constraint error bubbling up as a generic error toast.

---

### MINOR — UI complexity: showing linked KB articles on ticket detail vs. article detail creates two surfaces to maintain

**What goes wrong:** The ticket detail page (`KBLinksSection` component) and the article detail page (future reverse links view) both need link add/remove capability. Implementing this in two places means two places to fix bugs, two places to update when the link schema changes.

**Prevention:** Extract link management into a shared `useKbLinks(ticketId?, articleId?)` hook that abstracts the API calls. Both surfaces use the same hook. This is especially important since the API pattern differs: ticket-side uses `/api/kb/ticket/:ticketId`, article-side will use `/api/kb/articles/:id/tickets`.

---

## 5. CSV/PDF Export from React Frontend

### CRITICAL — Export endpoint uses `SELECT *` not `TICKET_COLUMNS`

**What goes wrong:** The export route in `tickets.ts` (line 797-801) uses `SELECT * FROM tickets` despite the file establishing `TICKET_COLUMNS` as the optimized column list. This is documented in `CONCERNS.md` (Tech Debt #2). For a reports export covering all closed tickets, this adds unnecessary columns and increases response payload.

**Prevention:** Replace `SELECT *` with `SELECT ${TICKET_COLUMNS}` in the export route. This is a one-line fix with zero risk.

---

### CRITICAL — Large CSV export is built entirely in memory before response

**What goes wrong:** `generateCSV()` at `tickets.ts:49` builds the entire CSV string in memory by string concatenation (`csv += row.join(',') + '\n'`). For 5,000 tickets with descriptions and notes, this can reach 10-50MB held in Node.js heap before being sent. CONCERNS.md (Performance #4) confirms this is a known issue.

**Prevention:** Use Node.js streaming response:
```javascript
res.setHeader('Content-Type', 'text/csv; charset=utf-8');
res.write(BOM + headers.join(',') + '\n');
for (const ticket of tickets) {
  res.write(buildRow(ticket) + '\n');
}
res.end();
```
With `better-sqlite3`, use `.iterate()` instead of `.all()` to avoid loading all rows into memory:
```javascript
const stmt = db.prepare(`SELECT ... FROM tickets WHERE ...`);
for (const ticket of stmt.iterate(...params)) {
  res.write(buildRow(ticket) + '\n');
}
```

---

### CRITICAL — Multi-line ticket descriptions break naive CSV row detection

**What goes wrong:** Ticket `description`, `notes`, and `solution` fields frequently contain newlines (they come from a rich text editor). The existing `escapeCSVField` function (tickets.ts:39-47) wraps fields containing `\n` in double quotes, which is correct per RFC 4180. However, the import-side `parseCSVLine` (tickets.ts:93) is a hand-rolled parser that may not correctly handle multi-line fields split across multiple file lines.

**Why it matters for export:** Excel and Numbers open CSV files correctly when newlines within fields are properly quoted. But if another system imports the exported CSV, hand-rolled parsers will break on these records.

**Prevention for reports export:** Use the `csv-stringify` npm package instead of the hand-rolled generator. It handles all RFC 4180 edge cases. For a new reports/PDF export feature, do not extend the existing hand-rolled approach.

---

### MODERATE — PDF export: browser `window.print()` vs. server-side PDF generation

**What goes wrong:** The common beginner approach to PDF from React is `window.print()` with print-specific CSS. This works but produces inconsistent results across browsers, cannot be automated, and cannot be triggered programmatically from the archive export button.

**For server-side PDF:** Libraries like `pdfmake` (pure JS, no Chromium dependency) or `puppeteer` (full Chrome, ~130MB Docker image increase) are common choices. Puppeteer is overkill for a Docker-deployed internal tool. `pdfmake` or `jsPDF` on the client side are more appropriate.

**Prevention:** For the reports milestone, use client-side PDF generation with `jsPDF` + `jspdf-autotable` for tabular data. This requires no new backend route and no Docker image changes. Limitation: complex chart rendering requires `html2canvas` to snapshot the DOM, which is slow and produces raster (not vector) output.

**Recommendation:** Export chart data as CSV (already partly implemented) and offer a print-optimized report page for PDF — using `window.print()` with `@media print` CSS. This avoids library complexity entirely for a single-user tool.

---

### MODERATE — BOM character in CSV causes issues with non-Excel tools

**What goes wrong:** The current `generateCSV` adds a UTF-8 BOM (`\uFEFF`) at the start of the CSV (tickets.ts:55). This is the correct approach for Excel on Windows to recognize UTF-8. However, BOM causes issues in: Python's `csv` module (reads BOM as first column name character), most Linux tools (`cut`, `awk`), and some import utilities.

**Prevention:** Keep the BOM for the current export (it solves Swedish character rendering in Excel). If adding a reports-specific export, consider making BOM optional via a query param (`?bom=true`). Document the BOM presence in comments near the export header.

---

### MINOR — Missing null checks for deleted contacts/categories in export

**What goes wrong:** `generateCSV` builds lookup maps for categories and contacts (tickets.ts:51-52). If a ticket's `category_id` or `requester_id` points to a record that was deleted (and SET NULL did not cascade correctly), the map lookup returns `undefined`, producing an empty string in the export. This is a known bug in CONCERNS.md (Bug #2). The exported CSV will have blank category/requester fields with no indication of the data gap.

**Prevention:** Add a null check that includes the original ID when the lookup fails:
```javascript
const category = ticket.category_id
  ? (categoryMap.get(ticket.category_id) || `[deleted:${ticket.category_id.slice(0,8)}]`)
  : '';
```
This makes data gaps visible in the export rather than silent.

---

### MINOR — Content-Disposition filename with special characters breaks some browsers

**What goes wrong:** The export filename uses `tickets-export-2026-03-22.csv` (safe), but if future exports include filter context in the filename (e.g., category name with Swedish characters: `tickets-export-Hårdvara.csv`), the `Content-Disposition` header will be malformed in browsers that do not support RFC 5987 encoding.

**Prevention:** Always use ASCII-safe filenames in `Content-Disposition`. Transliterate or slugify any user-provided strings before using them in filenames.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Reports backend endpoint | Computing analytics in JS on paginated data | Add `/api/reports/summary` that uses SQL GROUP BY |
| FTS5 migration | Trying to add FTS to existing table | Create separate virtual table in new migration file |
| FTS5 and HTML content | Indexing raw Tiptap HTML | Strip HTML to plain text before insert into FTS table |
| KB two-way links | Forgetting reverse endpoint | Add `GET /api/kb/articles/:id/tickets` using existing index |
| KB article deletion | Silent CASCADE removes ticket links | Add pre-delete warning showing affected ticket count |
| CSV export fix | `SELECT *` in export route | One-line fix: replace with `TICKET_COLUMNS` |
| Reports date grouping | Timezone mismatch at month boundaries | Use `strftime` in SQL, not `new Date().getMonth()` in JS |
| recharts + tabs | All tab charts rendered even when not visible | Conditionally mount charts; only render active tab content |
| Archive status filter | Only shows `closed`, misses `resolved` | Change filter to `status IN ('resolved', 'closed')` or add picker |

---

## Sources

- Codebase inspection: `server/src/routes/tickets.ts`, `server/src/routes/kb.ts`, `server/src/db/schema.sql`, `server/src/db/connection.ts`, `src/pages/Reports.tsx`, `src/pages/Archive.tsx`
- `.planning/codebase/CONCERNS.md` (Tech Debt #2, Bug #2, Performance #4, Fragile Area #4)
- SQLite FTS5 documentation (https://www.sqlite.org/fts5.html) — training knowledge, HIGH confidence for FTS5 virtual table mechanics
- better-sqlite3 iterate() API — HIGH confidence, official API
- RFC 4180 CSV standard — HIGH confidence
- recharts ResponsiveContainer behavior — MEDIUM confidence (verified against known recharts patterns)

*Confidence: HIGH for SQLite-specific pitfalls (FTS5 mechanics, schema constraints, cascade behavior). HIGH for CSV generation (directly observed in codebase). MEDIUM for recharts performance patterns (training knowledge, no live doc verification available).*
