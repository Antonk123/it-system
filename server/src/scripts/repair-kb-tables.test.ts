import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  escapeHtml,
  isSeparatorRow,
  looksLikeTableParagraph,
  buildTableFromParagraphInner,
  repairArticleContent,
  hasBrokenTable,
  findBrokenArticles,
  applyRepairToArticle,
} from './repair-kb-tables.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// One BROKEN article: a mangled <p>-table as baked in by the old importer.
const BROKEN_CONTENT =
  '<h2>Blad1</h2><p>| Namn | Roll |<br>| --- | --- |<br>| Bo | Chef |</p>';

// One ALREADY-GOOD article: a proper <table> (new-import path).
const GOOD_CONTENT =
  '<table><thead><tr><th>Namn</th><th>Roll</th></tr></thead>' +
  '<tbody><tr><td>Bo</td><td>Chef</td></tr></tbody></table>';

// One NO-TABLE article: plain prose, no pipes.
const PLAIN_CONTENT = '<p>Detta är en vanlig artikel utan tabeller.</p>';

// ─────────────────────────────────────────────────────────────────────────────
// Pure reconstruction logic (no DB)
// ─────────────────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes the dangerous HTML characters', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });
});

describe('isSeparatorRow', () => {
  it('recognises plain and aligned separator rows', () => {
    expect(isSeparatorRow('| --- | --- |')).toBe(true);
    expect(isSeparatorRow('|---|---|')).toBe(true);
    expect(isSeparatorRow('| :--- | ---: | :---: |')).toBe(true);
  });
  it('rejects content rows and prose', () => {
    expect(isSeparatorRow('| Namn | Roll |')).toBe(false);
    expect(isSeparatorRow('| Bo | Chef |')).toBe(false);
    expect(isSeparatorRow('not a row at all')).toBe(false);
    expect(isSeparatorRow('| - | - |')).toBe(false); // single dash, not a GFM separator
  });
});

describe('looksLikeTableParagraph', () => {
  it('detects a mangled table block', () => {
    expect(
      looksLikeTableParagraph('| Namn | Roll |<br>| --- | --- |<br>| Bo | Chef |')
    ).toBe(true);
  });
  it('is conservative: no separator → not a table', () => {
    expect(looksLikeTableParagraph('| Namn | Roll |<br>| Bo | Chef |')).toBe(false);
    expect(looksLikeTableParagraph('just some prose with a | pipe')).toBe(false);
  });
});

describe('buildTableFromParagraphInner', () => {
  it('rebuilds a clean table, dropping the separator row', () => {
    const html = buildTableFromParagraphInner(
      '| Namn | Roll |<br>| --- | --- |<br>| Bo | Chef |'
    );
    expect(html).toBe(
      '<table><thead><tr><th>Namn</th><th>Roll</th></tr></thead>' +
        '<tbody><tr><td>Bo</td><td>Chef</td></tr></tbody></table>'
    );
  });

  it('handles <br/> self-closing separators and multiple body rows', () => {
    const html = buildTableFromParagraphInner(
      '| A | B |<br/>| --- | --- |<br/>| 1 | 2 |<br/>| 3 | 4 |'
    );
    expect(html).toBe(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
        '<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>'
    );
  });

  it('HTML-escapes cell text', () => {
    const html = buildTableFromParagraphInner(
      '| Tag | Note |<br>| --- | --- |<br>| <script> | a & b |'
    );
    expect(html).toContain('<td>&lt;script&gt;</td>');
    expect(html).toContain('<td>a &amp; b</td>');
    // no raw script tag survives
    expect(html).not.toContain('<script>');
  });

  it('returns null when there is no separator row (conservative)', () => {
    expect(buildTableFromParagraphInner('| Namn | Roll |<br>| Bo | Chef |')).toBeNull();
    expect(buildTableFromParagraphInner('plain prose')).toBeNull();
  });
});

describe('repairArticleContent', () => {
  it('rebuilds only the mangled <p>, leaving surrounding HTML intact', () => {
    const out = repairArticleContent(BROKEN_CONTENT);
    expect(out).toBe(
      '<h2>Blad1</h2><table><thead><tr><th>Namn</th><th>Roll</th></tr></thead>' +
        '<tbody><tr><td>Bo</td><td>Chef</td></tr></tbody></table>'
    );
  });

  it('leaves an already-good article untouched', () => {
    expect(repairArticleContent(GOOD_CONTENT)).toBe(GOOD_CONTENT);
  });

  it('leaves a no-table article untouched', () => {
    expect(repairArticleContent(PLAIN_CONTENT)).toBe(PLAIN_CONTENT);
  });

  it('does not touch a <p> that merely contains a pipe but no separator', () => {
    const prose = '<p>Use the | character as a delimiter.</p>';
    expect(repairArticleContent(prose)).toBe(prose);
  });

  it('is idempotent — running twice equals running once', () => {
    const once = repairArticleContent(BROKEN_CONTENT);
    const twice = repairArticleContent(once);
    expect(twice).toBe(once);
  });
});

describe('hasBrokenTable', () => {
  it('flags broken content and clears repaired/good/plain content', () => {
    expect(hasBrokenTable(BROKEN_CONTENT)).toBe(true);
    expect(hasBrokenTable(GOOD_CONTENT)).toBe(false);
    expect(hasBrokenTable(PLAIN_CONTENT)).toBe(false);
    expect(hasBrokenTable(repairArticleContent(BROKEN_CONTENT))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-backed: detection + apply + FTS sync + idempotency
// ─────────────────────────────────────────────────────────────────────────────

let db: InstanceType<typeof Database>;

function createSchema(d: InstanceType<typeof Database>) {
  d.exec(`
    CREATE TABLE kb_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE kb_articles_fts
      USING fts5(title, content_plain, content='', tokenize='unicode61');
  `);
}

function seedArticle(
  d: InstanceType<typeof Database>,
  id: string,
  title: string,
  content: string
) {
  const now = '2026-06-01T00:00:00.000Z';
  d.prepare(
    'INSERT INTO kb_articles (id, title, content, created_at, updated_at) VALUES (?,?,?,?,?)'
  ).run(id, title, content, now, now);
  const row = d.prepare('SELECT rowid FROM kb_articles WHERE id = ?').get(id) as {
    rowid: number;
  };
  // strip HTML the same crude way the app does for the FTS column
  const plain = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  d.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)').run(
    row.rowid,
    title,
    plain
  );
}

function ftsMatchIds(d: InstanceType<typeof Database>, query: string): string[] {
  const rows = d
    .prepare(
      `SELECT a.id FROM kb_articles_fts f JOIN kb_articles a ON a.rowid = f.rowid
       WHERE kb_articles_fts MATCH ?`
    )
    .all(query) as { id: string }[];
  return rows.map((r) => r.id);
}

beforeEach(() => {
  db = new Database(':memory:');
  createSchema(db);
  seedArticle(db, 'broken-1', 'Broken Table Article', BROKEN_CONTENT);
  seedArticle(db, 'good-1', 'Good Table Article', GOOD_CONTENT);
  seedArticle(db, 'plain-1', 'Plain Article', PLAIN_CONTENT);
});

afterEach(() => {
  db.close();
});

// Re-usable apply step mirroring the script's --apply transaction.
function applyAll() {
  const broken = findBrokenArticles(db as unknown as import('better-sqlite3').Database);
  const now = new Date().toISOString();
  const dbx = db as unknown as import('better-sqlite3').Database;
  const tx = dbx.transaction(() => {
    for (const article of broken) {
      const newContent = repairArticleContent(article.content);
      if (newContent === article.content) continue;
      applyRepairToArticle(dbx, article, newContent, now);
    }
  });
  tx();
  return broken;
}

describe('findBrokenArticles (DB detection)', () => {
  it('finds exactly the broken article', () => {
    const broken = findBrokenArticles(db as unknown as import('better-sqlite3').Database);
    expect(broken.map((a) => a.id)).toEqual(['broken-1']);
  });
});

describe('apply repair (DB write + FTS sync)', () => {
  it('rebuilds the broken article into valid <table> HTML', () => {
    applyAll();
    const row = db.prepare('SELECT content FROM kb_articles WHERE id = ?').get('broken-1') as {
      content: string;
    };
    expect(row.content).toContain('<table>');
    expect(row.content).toContain('<th>Namn</th>');
    expect(row.content).toContain('<td>Bo</td>');
    expect(row.content).not.toContain('| ---');
    expect(hasBrokenTable(row.content)).toBe(false);
  });

  it('leaves the good and plain articles byte-for-byte untouched', () => {
    applyAll();
    const good = db.prepare('SELECT content FROM kb_articles WHERE id = ?').get('good-1') as {
      content: string;
    };
    const plain = db.prepare('SELECT content FROM kb_articles WHERE id = ?').get('plain-1') as {
      content: string;
    };
    expect(good.content).toBe(GOOD_CONTENT);
    expect(plain.content).toBe(PLAIN_CONTENT);
  });

  it('keeps the FTS index in sync — new cell text is searchable', () => {
    // Before repair, "Chef" lived inside the mangled <p>; the crude strip kept it,
    // so search may already match. The real proof is that after repair the FTS row
    // still resolves to the article AND no stale duplicate FTS rows linger.
    applyAll();
    // "Chef" appears in both the repaired broken article and the good article,
    // so FTS legitimately returns both — the point is the repaired row is still
    // indexed and searchable after the delete+insert sync.
    expect(ftsMatchIds(db, 'Chef')).toContain('broken-1');
    expect(ftsMatchIds(db, 'Namn')).toContain('broken-1');
    // Exactly one FTS row per article (no orphan from the delete+insert cycle).
    const ftsRowCount = (
      db.prepare('SELECT COUNT(*) AS c FROM kb_articles_fts').get() as { c: number }
    ).c;
    expect(ftsRowCount).toBe(3);
  });

  it('is idempotent — a second apply changes nothing and detection is empty', () => {
    applyAll();
    const afterFirst = db
      .prepare('SELECT content FROM kb_articles WHERE id = ?')
      .get('broken-1') as { content: string };

    // Second run: detection must now find nothing.
    const brokenAgain = findBrokenArticles(
      db as unknown as import('better-sqlite3').Database
    );
    expect(brokenAgain).toEqual([]);

    applyAll();
    const afterSecond = db
      .prepare('SELECT content FROM kb_articles WHERE id = ?')
      .get('broken-1') as { content: string };
    expect(afterSecond.content).toBe(afterFirst.content);

    // FTS still has exactly one row per article.
    const ftsRowCount = (
      db.prepare('SELECT COUNT(*) AS c FROM kb_articles_fts').get() as { c: number }
    ).c;
    expect(ftsRowCount).toBe(3);
  });
});
