import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runMigrations } from '../db/runner.js';
import { rebuildFts, checkFtsDrift } from './fts.js';

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../db/schema.sql'), 'utf-8');

describe('fts helpers (migration 081 kb_articles_fts + tickets_fts)', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(schema);
    runMigrations(db);
    db.prepare("INSERT INTO tickets (id, title, description, notes) VALUES ('t1', 'Skrivare trasig', 'Papper fastnar', 'ring Anna')").run();
    db.prepare("INSERT INTO tickets (id, title, description) VALUES ('t2', 'VPN', 'Kan inte ansluta')").run();
    const kb = db.prepare('INSERT INTO kb_articles (id, title, content) VALUES (?, ?, ?)');
    kb.run('a1', 'Återställ lösenord', '<p>Gå till <b>portalen</b></p>');
    kb.run('a2', 'Fördelar med far', '<p>Ett får betar</p>');
    // kb_articles_fts synkas manuellt av routes/kb.ts — gör det här som routen.
    const insert = db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) SELECT rowid, title, ? FROM kb_articles WHERE id = ?');
    insert.run('Gå till portalen', 'a1');
    insert.run('Ett får betar', 'a2');
  });
  afterEach(() => db.close());

  const kbHits = (term: string) =>
    (db.prepare('SELECT rowid FROM kb_articles_fts WHERE kb_articles_fts MATCH ?').all(term) as { rowid: number }[]).length;

  it('kb_articles_fts supports plain DELETE (contentless_delete=1) and rejects the old delete command', () => {
    const rowid = (db.prepare("SELECT rowid FROM kb_articles WHERE id = 'a1'").get() as { rowid: number }).rowid;
    expect(() => db.prepare('DELETE FROM kb_articles_fts WHERE rowid = ?').run(rowid)).not.toThrow();
    expect(checkFtsDrift(db).kbArticles).toEqual({ rows: 2, fts: 1 });
    expect(() =>
      db.prepare("INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content_plain) VALUES('delete', 1, 'x', 'y')").run()
    ).toThrow(/contentless_delete/);
  });

  it('keeps å/ä/ö distinct from a/o (remove_diacritics 0)', () => {
    expect(kbHits('får')).toBe(1);
    expect(kbHits('far')).toBe(1);
    expect(kbHits('portalen')).toBe(1);
    // "får" ska inte matcha "far"-artikeln och tvärtom
    const hits = db.prepare("SELECT rowid FROM kb_articles_fts WHERE kb_articles_fts MATCH 'content_plain:får'").all();
    expect(hits).toHaveLength(1);
  });

  it('checkFtsDrift reports row counts for both tables', () => {
    expect(checkFtsDrift(db)).toEqual({
      tickets: { rows: 2, fts: 2 },
      kbArticles: { rows: 2, fts: 2 },
    });
  });

  it('checkFtsDrift reveals drift', () => {
    db.exec('DELETE FROM tickets_fts');
    db.prepare("INSERT INTO kb_articles (id, title, content) VALUES ('a3', 'Ny', 'x')").run();
    expect(checkFtsDrift(db)).toEqual({
      tickets: { rows: 2, fts: 0 },
      kbArticles: { rows: 3, fts: 2 },
    });
  });

  it('rebuildFts restores both indexes from the source tables and strips HTML', () => {
    db.exec('DELETE FROM tickets_fts');
    db.exec('DELETE FROM kb_articles_fts');
    db.prepare("INSERT INTO kb_articles (id, title, content) VALUES ('a3', 'Ny', '<p>unikord</p>')").run();

    expect(rebuildFts(db)).toEqual({ tickets: 2, kbArticles: 3 });
    expect(checkFtsDrift(db)).toEqual({ tickets: { rows: 2, fts: 2 }, kbArticles: { rows: 3, fts: 3 } });
    expect(kbHits('unikord')).toBe(1);
    expect(kbHits('"<p>"')).toBe(0);
    const ticketHits = db.prepare("SELECT rowid FROM tickets_fts WHERE tickets_fts MATCH 'skrivare'").all();
    expect(ticketHits).toHaveLength(1);
    // Ticket-triggrarna fungerar fortfarande efter ombyggnaden.
    db.prepare("UPDATE tickets SET title = 'Plotter' WHERE id = 't1'").run();
    expect(db.prepare("SELECT rowid FROM tickets_fts WHERE tickets_fts MATCH 'skrivare'").all()).toHaveLength(0);
  });

  it('rebuildFts is idempotent', () => {
    rebuildFts(db);
    expect(rebuildFts(db)).toEqual({ tickets: 2, kbArticles: 2 });
    expect(checkFtsDrift(db)).toEqual({ tickets: { rows: 2, fts: 2 }, kbArticles: { rows: 2, fts: 2 } });
  });
});
