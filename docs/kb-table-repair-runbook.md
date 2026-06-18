# Runbook: Repair broken GFM tables in KB articles

One-off operator procedure for `server/src/scripts/repair-kb-tables.ts`.

## What the bug was

Knowledge-base articles are stored as HTML in the `kb_articles` table. Before commit
`7fd56c7` (2026-06-17) the KB bulk-import markdown→HTML converter
(`src/lib/contentMigration.ts`, frontend) was a hand-rolled regex with **no table
support**. GFM tables in `.md` files imported between **~2026-05-14 and 2026-06-17**
were baked into the DB as broken HTML: the raw pipe rows survive verbatim inside a
single `<p>`, joined by `<br>`. Example of a broken row's stored content:

```html
<h2>Blad1</h2><p>| Namn | Roll |<br>| --- | --- |<br>| Bo | Chef |</p>
```

The new-import path is already fixed (it now uses `markdown-it`, which renders proper
`<table>` HTML). This script **only repairs pre-existing rows**. The raw markdown is
fully recoverable from the stored HTML, so the repair is an in-place backfill —
no re-import needed.

## How the repair works

For each affected article the script finds every `<p>...</p>` block whose inner text
clearly contains a GFM table (a pipe row plus a `| --- |` separator row, rows joined
by `<br>`/`<br/>`) and rewrites **only that block** into a proper
`<table><thead>…</thead><tbody>…</tbody></table>`. The separator row is dropped, the
first row becomes `<th>` headers, the rest become `<td>` cells, and all cell text is
HTML-escaped. Everything else in the article is left untouched.

On `--apply`, each rewrite runs inside a single transaction and the FTS5 search index
(`kb_articles_fts`) is kept in sync exactly as the `PUT /api/kb/articles/:id` handler
does: delete the old FTS row, `UPDATE` the content, insert the refreshed FTS row.

The script is **idempotent**: repaired rows contain `<table>` and are excluded by
detection, so a second run is a no-op.

## Step 0 — Read-only detection (run on prod FIRST)

Before running the script, confirm how many rows are affected with a read-only query.
This does not modify anything.

```sql
SELECT id, title
FROM kb_articles
WHERE (content LIKE '%| ---%' OR content LIKE '%|---%')
  AND content NOT LIKE '%<table%'
ORDER BY title;
```

On the server you can run it read-only against the prod DB, e.g.:

```bash
sqlite3 -readonly "$DB_PATH" \
  "SELECT id, title FROM kb_articles \
   WHERE (content LIKE '%| ---%' OR content LIKE '%|---%') \
     AND content NOT LIKE '%<table%' ORDER BY title;"
```

If the count is 0, there is nothing to repair — stop here.

## Step 1 — Test in dev first

This is a destructive write to article content. **Run it in dev before prod.** Dev has
its own DB volume and checkout (see `docs/dev-db-isolation-runbook.md`), so it is the
correct test surface. Run the dry run and then `--apply` against the dev DB and verify
a repaired article renders correctly in the KB UI.

## Step 2 — Dry run (default, writes nothing)

Always dry-run first. The default mode reports what *would* change and prints a
before/after snippet for every row, but changes nothing.

```bash
cd server
DB_PATH=/path/to/database.sqlite npx tsx src/scripts/repair-kb-tables.ts
```

Review the detected list and the before/after snippets. Confirm only the intended
articles are listed and the reconstructed `<table>` looks right.

> `DB_PATH` resolution matches the app: if `DB_PATH` is unset the script falls back to
> the same default the server uses (`<server>/data/database.sqlite`). Set `DB_PATH`
> explicitly in container/prod environments to be safe.

## Step 3 — MANDATORY backup before --apply

**Take a database backup before applying.** The script also prints this reminder in
`--apply` mode.

```bash
cp "$DB_PATH" "$DB_PATH.bak-$(date +%Y%m%d-%H%M%S)"
```

For a WAL-mode DB, prefer a consistent online backup:

```bash
sqlite3 "$DB_PATH" ".backup '$DB_PATH.bak-$(date +%Y%m%d-%H%M%S)'"
```

## Step 4 — Apply

```bash
cd server
DB_PATH=/path/to/database.sqlite npx tsx src/scripts/repair-kb-tables.ts --apply
```

The script prints the number of rows repaired and confirms the FTS index was synced.

## Step 5 — Verify

- Re-run the Step 0 detection query — it should now return **0 rows**.
- Open a repaired article in the KB UI and confirm the table renders.
- Search for a term that appears in a table cell and confirm the article is returned
  (FTS sync sanity check).

## Notes

- Prod execution is a **manual operator step** (SSH to the server, run with the prod
  `DB_PATH`). It is not part of any automated deploy.
- The script adds **no npm dependencies** — reconstruction is dependency-free and does
  not pull in a markdown parser on the server.
- Safe to re-run: idempotent, and the dry-run default means an accidental run without
  `--apply` changes nothing.
