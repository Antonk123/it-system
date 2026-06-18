/* eslint-disable no-console -- CLI repair script: console is the intended output channel. */
/**
 * One-off repair script: rebuild broken GFM tables in KB articles.
 *
 * BACKGROUND
 * ----------
 * Before commit 7fd56c7 (2026-06-17) the KB bulk-import markdown→HTML converter
 * (`src/lib/contentMigration.ts`, frontend) was a hand-rolled regex with NO table
 * support. GFM tables in `.md` files imported between ~2026-05-14 and 2026-06-17
 * were baked into the DB as broken HTML: the raw pipe rows survive verbatim inside
 * a single <p>, separated by <br>, e.g.
 *
 *   <h2>Blad1</h2><p>| Namn | Roll |<br>| --- | --- |<br>| Bo | Chef |</p>
 *
 * The new-import path is already fixed (it now uses markdown-it). This script ONLY
 * repairs pre-existing rows by reconstructing the table HTML from the recoverable
 * raw markdown still present in the stored HTML.
 *
 * SAFETY
 * ------
 * - DRY RUN is the default. Nothing is written unless `--apply` is passed.
 * - On --apply every change runs inside a single transaction and the FTS5 index is
 *   kept in sync EXACTLY as the PUT /api/kb/articles/:id handler does (delete + insert).
 * - Idempotent: repaired rows contain "<table" and are excluded by detection, so a
 *   second run is a no-op.
 *
 * USAGE
 * -----
 *   # dry run (default) — reports what WOULD change, writes nothing
 *   DB_PATH=/path/to/database.sqlite npx tsx src/scripts/repair-kb-tables.ts
 *
 *   # apply — writes the repair (take a DB backup first!)
 *   DB_PATH=/path/to/database.sqlite npx tsx src/scripts/repair-kb-tables.ts --apply
 *
 * See docs/kb-table-repair-runbook.md for the full operator runbook.
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { stripHtml } from '../lib/htmlUtils.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pure reconstruction logic (no DB) — exported so it can be unit-tested directly.
// ─────────────────────────────────────────────────────────────────────────────

/** HTML-escape cell text. Matches the safe-output expectation for table cells. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Is this a GFM table separator row? e.g. "| --- | --- |", "|---|", ":---", "---:".
 * Every non-empty pipe-delimited cell must consist only of dashes and optional
 * leading/trailing colons (alignment markers), with at least two dashes.
 */
export function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  // Split on pipes, drop the empty leading/trailing cells created by border pipes.
  const cells = trimmed
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * Split a single GFM table row into trimmed cells.
 * Leading/trailing border pipes produce empty edge cells, which we drop.
 */
function splitRow(line: string): string[] {
  const cells = line.split('|').map((c) => c.trim());
  // Drop a single empty leading cell (border pipe) and a single empty trailing cell.
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/**
 * Does the inner text of a <p> block clearly contain a GFM table?
 * Requires at least one separator row AND a non-separator (header/data) row,
 * with rows joined by <br> / <br/>.
 */
export function looksLikeTableParagraph(inner: string): boolean {
  const lines = inner.split(/<br\s*\/?>/i).map((l) => l.trim());
  const hasSeparator = lines.some((l) => isSeparatorRow(l));
  if (!hasSeparator) return false;
  // Must also have at least one pipe-bearing, non-separator content row.
  const hasContentRow = lines.some((l) => l.includes('|') && !isSeparatorRow(l));
  return hasContentRow;
}

/**
 * Convert the inner text of a single mangled <p>...</p> (rows joined by <br>) into
 * a proper <table>. The FIRST non-separator row is the header (<th>); subsequent
 * non-separator rows are body rows (<td>). The separator row(s) are dropped.
 * Returns null if the block does not clearly contain a table (caller skips it).
 */
export function buildTableFromParagraphInner(inner: string): string | null {
  if (!looksLikeTableParagraph(inner)) return null;

  const rawLines = inner
    .split(/<br\s*\/?>/i)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.includes('|'));

  const rows: string[][] = [];
  for (const line of rawLines) {
    if (isSeparatorRow(line)) continue; // drop the --- separator row(s)
    rows.push(splitRow(line));
  }
  if (rows.length === 0) return null;

  const [headerCells, ...bodyRows] = rows;

  const thead =
    '<thead><tr>' +
    headerCells.map((c) => `<th>${escapeHtml(c)}</th>`).join('') +
    '</tr></thead>';

  const tbody =
    '<tbody>' +
    bodyRows
      .map(
        (cells) =>
          '<tr>' + cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>'
      )
      .join('') +
    '</tbody>';

  return `<table>${thead}${tbody}</table>`;
}

/**
 * Repair an entire article's HTML content: locate every <p>...</p> block whose inner
 * text clearly contains a GFM table and replace ONLY that block with a proper <table>.
 * All other HTML is left untouched. If nothing changes, returns the input unchanged.
 *
 * Conservative: a <p> without a clear separator row is skipped (returned verbatim).
 */
export function repairArticleContent(content: string): string {
  if (!content || typeof content !== 'string') return content;
  // Match each <p ...>...</p> block (non-greedy, allow attributes on the opening tag).
  return content.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (whole, inner: string) => {
    const table = buildTableFromParagraphInner(inner);
    return table ?? whole;
  });
}

/**
 * True if an article's stored content matches the broken-table signature:
 * contains a markdown separator row and does NOT already contain a <table>.
 * Mirrors the detection SQL so the in-memory check and DB check agree.
 */
export function hasBrokenTable(content: string): boolean {
  if (!content) return false;
  if (/<table/i.test(content)) return false;
  return content.includes('| ---') || content.includes('|---');
}

// ─────────────────────────────────────────────────────────────────────────────
// DB plumbing
// ─────────────────────────────────────────────────────────────────────────────

interface ArticleRow {
  id: string;
  title: string;
  content: string;
  rowid: number;
}

/**
 * Resolve the DB path EXACTLY like the app (server/src/db/connection.ts):
 *   process.env.DB_PATH || <server>/data/database.sqlite
 * connection.ts resolves its default relative to server/src/db/. This script lives
 * in server/src/scripts/, so we walk up the same number of levels to land on the
 * identical absolute default. (../../data from src/db == ../../data is wrong here;
 * from src/scripts the same physical file is ../../data/database.sqlite too, since
 * both src/db and src/scripts are one level under src.)
 */
export function resolveDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename); // .../server/src/scripts
  // connection.ts default is join(<server/src/db>, '../../data/database.sqlite')
  // == <server>/data/database.sqlite. From src/scripts the same relative path
  // ('../../data/database.sqlite') resolves to the same <server>/data file.
  return join(__dirname, '../../data/database.sqlite');
}

/** Select broken-table articles, matching the read-only detection SQL in the runbook. */
export function findBrokenArticles(db: DatabaseType): ArticleRow[] {
  return db
    .prepare(
      `SELECT rowid, id, title, content
       FROM kb_articles
       WHERE (content LIKE '%| ---%' OR content LIKE '%|---%')
         AND content NOT LIKE '%<table%'
       ORDER BY title ASC`
    )
    .all() as ArticleRow[];
}

/**
 * Apply the repair to one article inside the caller's transaction, replicating the
 * EXACT FTS5 sync from PUT /api/kb/articles/:id (server/src/routes/kb.ts ~348-355):
 *   1. delete old FTS row (using OLD title + OLD stripHtml(content))
 *   2. UPDATE kb_articles.content (+ updated_at)
 *   3. insert new FTS row (using same title + NEW stripHtml(content))
 */
export function applyRepairToArticle(
  db: DatabaseType,
  article: ArticleRow,
  newContent: string,
  now: string
): void {
  // 1. delete the stale FTS entry (contentless FTS5 requires the old values)
  db.prepare(
    "INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content_plain) VALUES('delete', ?, ?, ?)"
  ).run(article.rowid, article.title, stripHtml(article.content));

  // 2. update the article content (title is unchanged by this repair)
  db.prepare('UPDATE kb_articles SET content = ?, updated_at = ? WHERE id = ?').run(
    newContent,
    now,
    article.id
  );

  // 3. insert the refreshed FTS entry
  db.prepare(
    'INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)'
  ).run(article.rowid, article.title, stripHtml(newContent));
}

/** Truncate a snippet for console display. */
function snippet(s: string, max = 240): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────────────────────

export function run(argv: string[]): void {
  const apply = argv.includes('--apply');
  const dbPath = resolveDbPath();

  console.log('─'.repeat(72));
  console.log('KB table repair');
  console.log(`Mode:    ${apply ? 'APPLY (writes to DB)' : 'DRY RUN (no changes)'}`);
  console.log(`DB_PATH: ${dbPath}`);
  console.log('─'.repeat(72));

  if (apply) {
    console.log('');
    console.log('!! APPLY MODE — TAKE A DATABASE BACKUP BEFORE RUNNING THIS ON PROD !!');
    console.log('   e.g.  cp "$DB_PATH" "$DB_PATH.bak-$(date +%Y%m%d-%H%M%S)"');
    console.log('');
  }

  const db: DatabaseType = new Database(dbPath);
  try {
    const broken = findBrokenArticles(db);

    console.log(`Detected ${broken.length} article(s) with broken GFM tables:`);
    for (const a of broken) {
      console.log(`  - ${a.id}  ${a.title}`);
    }
    console.log('');

    if (broken.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    // Compute repairs and report before/after for each.
    const repairs: { article: ArticleRow; newContent: string }[] = [];
    for (const article of broken) {
      const newContent = repairArticleContent(article.content);
      if (newContent === article.content) {
        // Detection matched but the conservative reconstruction did not change
        // anything (e.g. separator text not inside a <p>). Skip — do not touch.
        console.log(`SKIP  ${article.id} (${article.title}): no clear <p>-table block to rebuild`);
        continue;
      }
      repairs.push({ article, newContent });
      console.log(`WOULD REPAIR  ${article.id}  ${article.title}`);
      console.log(`  before: ${snippet(article.content)}`);
      console.log(`  after:  ${snippet(newContent)}`);
      console.log('');
    }

    if (repairs.length === 0) {
      console.log('No repairable rows after conservative reconstruction. Nothing written.');
      return;
    }

    if (!apply) {
      console.log(
        `DRY RUN complete. ${repairs.length} row(s) WOULD be repaired. Re-run with --apply to write.`
      );
      return;
    }

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const { article, newContent } of repairs) {
        applyRepairToArticle(db, article, newContent, now);
      }
    });
    tx();

    console.log(`APPLIED. Repaired ${repairs.length} row(s) and synced FTS index.`);
  } finally {
    db.close();
  }
}

// Run only when executed directly (not when imported by the test).
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  run(process.argv.slice(2));
}
