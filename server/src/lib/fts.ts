import type { Database } from 'better-sqlite3';
import { stripHtml } from './htmlUtils.js';

// Båda FTS-tabellerna är contentless och nycklade på rowid i tabeller med TEXT-PK.
// Kör ALDRIG VACUUM manuellt: SQLite får numrera om rowid i sådana tabeller och
// då pekar varje FTS-rad på fel post. Efter en olycka: rebuildFts().

/** Töm och fyll om tickets_fts — samma kolumnmappning som migration 052 och triggrarna. */
function rebuildTicketsFts(db: Database): number {
  db.exec('DELETE FROM tickets_fts');
  return db
    .prepare(
      `INSERT INTO tickets_fts(rowid, title, description, notes, solution)
       SELECT rowid, title, COALESCE(description, ''), COALESCE(notes, ''), COALESCE(solution, '')
       FROM tickets`
    )
    .run().changes;
}

/** Töm och fyll om kb_articles_fts — innehållet HTML-strippas som i routes/kb.ts. */
export function rebuildKbFts(db: Database): number {
  db.exec('DELETE FROM kb_articles_fts');
  const articles = db.prepare('SELECT rowid, title, content FROM kb_articles').all() as {
    rowid: number;
    title: string;
    content: string;
  }[];
  const insert = db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?, ?, ?)');
  for (const a of articles) insert.run(a.rowid, a.title, stripHtml(a.content ?? ''));
  return articles.length;
}

export function rebuildFts(db: Database): { tickets: number; kbArticles: number } {
  return db.transaction(() => ({
    tickets: rebuildTicketsFts(db),
    kbArticles: rebuildKbFts(db),
  }))();
}

const count = (db: Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/** Radantal i källtabell mot FTS-tabell; skiljer de sig har indexet glidit isär. */
export function checkFtsDrift(db: Database): {
  tickets: { rows: number; fts: number };
  kbArticles: { rows: number; fts: number };
} {
  return {
    tickets: { rows: count(db, 'tickets'), fts: count(db, 'tickets_fts') },
    kbArticles: { rows: count(db, 'kb_articles'), fts: count(db, 'kb_articles_fts') },
  };
}
