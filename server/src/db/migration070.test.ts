import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { migrations } from './migrations.js';

/**
 * Migration 070: rebuild_kb_article_tags_drop_legacy_tag.
 *
 * På en uppgraderad databas har kb_article_tags en legacy-kolumn
 * `tag TEXT NOT NULL` (utan default) kvar, eftersom migration 017 bara kunde
 * LÄGGA TILL tag_id med ALTER — inte ta bort den gamla kolumnen eller
 * UNIQUE(article_id, tag). Appen skriver
 * `INSERT OR IGNORE INTO kb_article_tags (id, article_id, tag_id)`
 * (routes/kb.ts:333 och :392), vilket bryter NOT NULL på `tag`. OR IGNORE
 * sväljer felet ⇒ taggen försvinner TYST och läsvägen (som joinar på tag_id)
 * visar artikeln som otaggad.
 *
 * Det avgörande testfallet är därför inte "schemat ser rätt ut" utan att exakt
 * appens sats går från 0 till 1 sparad rad över migrationen.
 */

const migration070 = migrations.find((m) => m.id === '070');

function realHelpers(db: DatabaseType) {
  const tableExists = (name: string) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  return {
    tableExists,
    columnExists: (table: string, column: string) => {
      if (!tableExists(table)) return false;
      return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
        (c) => c.name === column
      );
    },
  };
}

/** Föräldratabeller — främmande nycklar är PÅ, så raderna måste finnas. */
function setupParents(db: DatabaseType) {
  db.exec(`
    CREATE TABLE kb_articles (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO kb_articles (id, title) VALUES ('art-1', 'Artikel'), ('art-2', 'Annan');
    INSERT INTO tags (id, name) VALUES ('tag-a', 'Outlook'), ('tag-b', 'VPN');
  `);
}

/** Formen en uppgraderad databas har efter migration 017 (legacy `tag` kvar). */
function setupUpgradedForm(db: DatabaseType) {
  db.exec(`CREATE TABLE kb_article_tags (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
    UNIQUE(article_id, tag)
  )`);
  db.exec(`CREATE INDEX idx_kb_article_tags_article ON kb_article_tags(article_id)`);
  db.exec(`CREATE INDEX idx_kb_article_tags_tag ON kb_article_tags(tag)`);
  db.exec(`CREATE INDEX idx_kb_article_tags_tag_id ON kb_article_tags(tag_id)`);
}

/** Formen migration 016 ger en fresh install. */
function setupCanonicalForm(db: DatabaseType) {
  db.exec(`CREATE TABLE kb_article_tags (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(article_id, tag_id)
  )`);
  db.exec(`CREATE INDEX idx_kb_article_tags_article ON kb_article_tags(article_id)`);
  db.exec(`CREATE INDEX idx_kb_article_tags_tag ON kb_article_tags(tag_id)`);
}

const run = (db: DatabaseType) => migration070!.up(db, realHelpers(db));

const columns = (db: DatabaseType) =>
  (db.prepare('PRAGMA table_info(kb_article_tags)').all() as { name: string; notnull: number }[]);

const schemaOf = (db: DatabaseType) =>
  db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'kb_article_tags' AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
    )
    .all();

/** Exakt satsen från routes/kb.ts:333 och :392. */
const appInsert = (db: DatabaseType, id: string, articleId: string, tagId: string) =>
  db
    .prepare('INSERT OR IGNORE INTO kb_article_tags (id, article_id, tag_id) VALUES (?, ?, ?)')
    .run(id, articleId, tagId).changes;

describe('migration 070: rebuild av kb_article_tags', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON'); // som connection.ts
    setupParents(db);
  });

  afterEach(() => db.close());

  it('finns i arrayen med rätt id och namn', () => {
    expect(migration070).toBeDefined();
    expect(migration070!.name).toBe('rebuild_kb_article_tags_drop_legacy_tag');
  });

  it('appens INSERT går från TYST BORTKASTAD till sparad över migrationen', () => {
    setupUpgradedForm(db);

    // FÖRE: NOT NULL på legacy-kolumnen bryts, OR IGNORE sväljer felet.
    expect(appInsert(db, 'row-1', 'art-1', 'tag-a')).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM kb_article_tags').get() as { n: number }).n).toBe(0);

    run(db);

    // EFTER: samma sats sparar raden, och läsvägen (JOIN på tag_id) ser den.
    expect(appInsert(db, 'row-1', 'art-1', 'tag-a')).toBe(1);
    const readBack = db
      .prepare(
        'SELECT t.name FROM kb_article_tags kat JOIN tags t ON t.id = kat.tag_id WHERE kat.article_id = ?'
      )
      .all('art-1') as { name: string }[];
    expect(readBack.map((r) => r.name)).toEqual(['Outlook']);
  });

  it('slutformen är exakt migration 016:s form (kolumner, unikhet, index)', () => {
    setupUpgradedForm(db);
    run(db);

    expect(columns(db).map((c) => c.name)).toEqual(['id', 'article_id', 'tag_id', 'created_at']);
    expect(columns(db).find((c) => c.name === 'tag_id')!.notnull).toBe(1);

    // Unikheten flyttad från (article_id, tag) till (article_id, tag_id).
    const uniques = (db.prepare('PRAGMA index_list(kb_article_tags)').all() as {
      name: string;
      unique: number;
      origin: string;
    }[]).filter((i) => i.unique === 1 && i.origin === 'u');
    const uniqueCols = uniques.flatMap((i) =>
      (db.prepare(`PRAGMA index_info("${i.name}")`).all() as { name: string }[]).map((c) => c.name)
    );
    expect(uniqueCols.sort()).toEqual(['article_id', 'tag_id']);

    // Samma namngivna index som en fresh install — den uppgraderade formens
    // extra idx_kb_article_tags_tag_id ska INTE återskapas.
    const named = (db.prepare('PRAGMA index_list(kb_article_tags)').all() as {
      name: string;
      origin: string;
    }[])
      .filter((i) => i.origin === 'c')
      .map((i) => i.name)
      .sort();
    expect(named).toEqual(['idx_kb_article_tags_article', 'idx_kb_article_tags_tag']);
    const tagIndexCols = (
      db.prepare('PRAGMA index_info(idx_kb_article_tags_tag)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(tagIndexCols).toEqual(['tag_id']); // pekade förut på legacy-kolumnen
  });

  it('bevarar rader som har tag_id — id, artikel, tagg och tidsstämpel oförändrade', () => {
    setupUpgradedForm(db);
    db.prepare(
      'INSERT INTO kb_article_tags (id, article_id, tag, created_at, tag_id) VALUES (?, ?, ?, ?, ?)'
    ).run('keep-1', 'art-1', 'Outlook', '2026-03-01T10:00:00.000Z', 'tag-a');
    db.prepare(
      'INSERT INTO kb_article_tags (id, article_id, tag, created_at, tag_id) VALUES (?, ?, ?, ?, ?)'
    ).run('keep-2', 'art-2', 'VPN', '2026-03-02T10:00:00.000Z', 'tag-b');

    run(db);

    expect(db.prepare('SELECT * FROM kb_article_tags ORDER BY id').all()).toEqual([
      { id: 'keep-1', article_id: 'art-1', tag_id: 'tag-a', created_at: '2026-03-01T10:00:00.000Z' },
      { id: 'keep-2', article_id: 'art-2', tag_id: 'tag-b', created_at: '2026-03-02T10:00:00.000Z' },
    ]);
  });

  it('slår ihop dubbletter som den gamla unikheten tillät, och behåller den äldsta raden', () => {
    setupUpgradedForm(db);
    // Migration 017 mappade text-taggar skiftlägesokänsligt → 'Outlook' och
    // 'outlook' fick SAMMA tag_id. Gamla UNIQUE(article_id, tag) tillät båda
    // raderna; nya UNIQUE(article_id, tag_id) gör det inte.
    db.prepare(
      'INSERT INTO kb_article_tags (id, article_id, tag, created_at, tag_id) VALUES (?, ?, ?, ?, ?)'
    ).run('first', 'art-1', 'Outlook', '2026-03-01T10:00:00.000Z', 'tag-a');
    db.prepare(
      'INSERT INTO kb_article_tags (id, article_id, tag, created_at, tag_id) VALUES (?, ?, ?, ?, ?)'
    ).run('second', 'art-1', 'outlook', '2026-05-01T10:00:00.000Z', 'tag-a');

    expect(() => run(db)).not.toThrow(); // naiv kopia hade brutit UNIQUE

    const rows = db.prepare('SELECT id FROM kb_article_tags').all() as { id: string }[];
    expect(rows).toEqual([{ id: 'first' }]); // äldsta raden vinner, deterministiskt
  });

  it('rader utan tag_id flyttas inte över, och antalet varnas ut', () => {
    setupUpgradedForm(db);
    db.prepare('INSERT INTO kb_article_tags (id, article_id, tag) VALUES (?, ?, ?)').run(
      'orphan-1',
      'art-1',
      'Gammal'
    );
    db.prepare('INSERT INTO kb_article_tags (id, article_id, tag) VALUES (?, ?, ?)').run(
      'orphan-2',
      'art-2',
      'Också gammal'
    );
    db.prepare(
      'INSERT INTO kb_article_tags (id, article_id, tag, tag_id) VALUES (?, ?, ?, ?)'
    ).run('keep', 'art-1', 'Outlook', 'tag-a');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    run(db);
    // Läs av FÖRE mockRestore() — den nollar mock.calls.
    const msg = warn.mock.calls.map((c) => String(c[0])).join(' ');
    warn.mockRestore();

    expect((db.prepare('SELECT id FROM kb_article_tags').all() as { id: string }[])).toEqual([
      { id: 'keep' },
    ]);
    expect(msg).toContain('2'); // antalet rader som inte kunde flyttas
    expect(msg).toMatch(/tag_id/); // varför
    expect(msg).toContain('1'); // antalet migrerade
  });

  it('är en no-op på en fresh install (kanonisk form) — rör inte schemat', () => {
    setupCanonicalForm(db);
    appInsert(db, 'row-1', 'art-1', 'tag-a');
    const before = schemaOf(db);

    expect(() => run(db)).not.toThrow();

    expect(schemaOf(db)).toEqual(before);
    expect((db.prepare('SELECT COUNT(*) AS n FROM kb_article_tags').get() as { n: number }).n).toBe(1);
  });

  it('är idempotent — andra körningen ändrar ingenting', () => {
    setupUpgradedForm(db);
    db.prepare(
      'INSERT INTO kb_article_tags (id, article_id, tag, tag_id) VALUES (?, ?, ?, ?)'
    ).run('keep', 'art-1', 'Outlook', 'tag-a');

    run(db);
    const after = schemaOf(db);
    const rows = db.prepare('SELECT * FROM kb_article_tags').all();

    expect(() => run(db)).not.toThrow();

    expect(schemaOf(db)).toEqual(after);
    expect(db.prepare('SELECT * FROM kb_article_tags').all()).toEqual(rows);
  });

  it('lämnar föräldratabellernas rader orörda (ingen cascade från DROP TABLE)', () => {
    setupUpgradedForm(db);
    db.prepare(
      'INSERT INTO kb_article_tags (id, article_id, tag, tag_id) VALUES (?, ?, ?, ?)'
    ).run('keep', 'art-1', 'Outlook', 'tag-a');

    run(db);

    expect((db.prepare('SELECT COUNT(*) AS n FROM kb_articles').get() as { n: number }).n).toBe(2);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }).n).toBe(2);
    expect((db.pragma('foreign_key_check') as unknown[]).length).toBe(0);
  });

  it('främmande nycklarna finns kvar efter rebuilden', () => {
    setupUpgradedForm(db);
    run(db);

    const fks = (db.prepare('PRAGMA foreign_key_list(kb_article_tags)').all() as {
      from: string;
      table: string;
      on_delete: string;
    }[])
      .map((fk) => `${fk.from}→${fk.table}:${fk.on_delete}`)
      .sort();
    expect(fks).toEqual(['article_id→kb_articles:CASCADE', 'tag_id→tags:CASCADE']);

    // Och de biter: en tagg som inte finns kan inte länkas.
    expect(() => appInsert(db, 'bad', 'art-1', 'finns-inte')).toThrow(/FOREIGN KEY/i);
  });
});
