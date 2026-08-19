import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { migrations } from './migrations.js';

// Migration 071: add_comment_email_sender — flyttar avsändaren från en
// "**Från:** Namn (adress)"-rad först i content till egna kolumner. Raden var
// redundant med kommentarhuvudet i UI:t och gjorde citerade mejlsvar
// dubbelt brusiga.

const migration071 = migrations.find((m) => m.id === '071');

function realHelpers(db: DatabaseType) {
  return {
    tableExists: (name: string) =>
      !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name),
    columnExists: (table: string, column: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
        (c) => c.name === column
      ),
  };
}

/** ticket_comments som den ser ut på en uppgraderad DB FÖRE 071. */
function setupBaseTables(db: DatabaseType) {
  db.exec(`CREATE TABLE ticket_comments (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    is_internal INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT DEFAULT NULL)`);
  // Samma trigger som migration 060 lämnar efter sig i prod.
  db.exec(`CREATE TRIGGER update_comment_updated_at
    AFTER UPDATE ON ticket_comments FOR EACH ROW BEGIN
      UPDATE ticket_comments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
    END`);
}

function insertComment(db: DatabaseType, id: string, content: string) {
  db.prepare(
    `INSERT INTO ticket_comments (id, ticket_id, user_id, content, is_internal, created_at, updated_at)
     VALUES (?, 't1', 'system-user', ?, 0, '2026-05-10 16:20:10', '2026-05-10 16:20:10')`
  ).run(id, content);
}

const readComment = (db: DatabaseType, id: string) =>
  db
    .prepare('SELECT content, email_from_name, email_from_address FROM ticket_comments WHERE id = ?')
    .get(id) as { content: string; email_from_name: string | null; email_from_address: string | null };

describe('migration 071: ticket_comments email sender', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    setupBaseTables(db);
  });
  afterEach(() => db.close());

  it('finns i arrayen med rätt id/namn', () => {
    expect(migration071).toBeDefined();
    expect(migration071!.name).toBe('add_comment_email_sender');
  });

  it('lägger till båda kolumnerna', () => {
    migration071!.up(db, realHelpers(db));
    expect(realHelpers(db).columnExists('ticket_comments', 'email_from_name')).toBe(true);
    expect(realHelpers(db).columnExists('ticket_comments', 'email_from_address')).toBe(true);
  });

  it('är idempotent — en andra körning kastar inte', () => {
    migration071!.up(db, realHelpers(db));
    expect(() => migration071!.up(db, realHelpers(db))).not.toThrow();
  });

  it('läker en halvt applicerad DB där bara den första kolumnen hann läggas till', () => {
    // Egen guard per kolumn: nästlade guards hade lämnat den andra kolumnen
    // saknad för alltid på en DB som kraschat mitt i.
    db.exec('ALTER TABLE ticket_comments ADD COLUMN email_from_name TEXT DEFAULT NULL');
    migration071!.up(db, realHelpers(db));
    expect(realHelpers(db).columnExists('ticket_comments', 'email_from_address')).toBe(true);
  });

  it('flyttar attributionsraden till kolumnerna och ur brödtexten', () => {
    insertComment(db, 'c1', '**Från:** Anna Svensson (anna@kund.se)\n\nJa, det är godkänt.');
    migration071!.up(db, realHelpers(db));

    const row = readComment(db, 'c1');
    expect(row.email_from_name).toBe('Anna Svensson');
    expect(row.email_from_address).toBe('anna@kund.se');
    expect(row.content).toBe('Ja, det är godkänt.');
  });

  it('bevarar flerradig brödtext under attributionen', () => {
    insertComment(db, 'c1', '**Från:** A (a@x.se)\n\nRad ett.\n\nRad två.');
    migration071!.up(db, realHelpers(db));
    expect(readComment(db, 'c1').content).toBe('Rad ett.\n\nRad två.');
  });

  it('lämnar kommentaren orörd när attributionsraden är allt som finns', () => {
    // Hellre en kommentar som ser gammal ut än en tom.
    const only = '**Från:** A (a@x.se)\n\n';
    insertComment(db, 'c1', only);
    migration071!.up(db, realHelpers(db));

    const row = readComment(db, 'c1');
    expect(row.content).toBe(only);
    expect(row.email_from_address).toBeNull();
  });

  it('rör inte agentkommentarer (TipTap-HTML)', () => {
    const html = '<p>Vi har beställt licenserna.</p>';
    insertComment(db, 'c1', html);
    migration071!.up(db, realHelpers(db));

    const row = readComment(db, 'c1');
    expect(row.content).toBe(html);
    expect(row.email_from_name).toBeNull();
    expect(row.email_from_address).toBeNull();
  });

  it('rör inte en kommentar som bara nämner "**Från:**" utan adress i parentes', () => {
    const text = '**Från:** vad jag förstod är det inte godkänt än.';
    insertComment(db, 'c1', text);
    migration071!.up(db, realHelpers(db));
    expect(readComment(db, 'c1').content).toBe(text);
  });

  it('städar bort den citerade tråden ur befintliga kommentarer', () => {
    insertComment(
      db,
      'c1',
      [
        '**Från:** Anton Kaarle (anton.kaarle@prefabmastarna.se)',
        '',
        'Ja, jag har kollat med min chef. Vi har slut på licenser..',
        '',
        'Från: Prefabmästarna Sverige AB <noreply@prefabmastarna.se>',
        'Datum: onsdag, 19 augusti 2026 08:36',
        'Till: Anton Kaarle <anton.kaarle@prefabmastarna.se>',
        'Ämne: [#4D684770] Beställning av licens',
        '',
        'Är detta godkänt? Kolla om chefen godkänner inköp först',
      ].join('\n')
    );
    migration071!.up(db, realHelpers(db));

    const row = readComment(db, 'c1');
    expect(row.email_from_name).toBe('Anton Kaarle');
    expect(row.content).toBe('Ja, jag har kollat med min chef. Vi har slut på licenser..');
    expect(row.content).not.toContain('Är detta godkänt?');
  });

  it('lämnar kommentaren orörd när kunden svarade utan egen text (bara citat)', () => {
    // Verkligt fall ur prod. Hellre hela citatet än en tom kommentar.
    const onlyQuote = [
      '**Från:** IT (it@prefabmastarna.se)',
      '',
      '----------------------------------------',
      '',
      'Från: Prefabmästarna Sverige AB <noreply@prefabmastarna.se>',
      'Skickat: torsdag 4 juni 2026 08:59:51',
      'Till: IT <it@prefabmastarna.se>',
      'Ämne: [#53014AFB] Ärende mottaget',
    ].join('\n');
    insertComment(db, 'c1', onlyQuote);
    migration071!.up(db, realHelpers(db));

    const row = readComment(db, 'c1');
    expect(row.email_from_address).toBe('it@prefabmastarna.se');
    expect(row.content).toContain('Ärende mottaget');
  });

  it('rör inte updated_at — backfillen får inte se ut som en redigering', () => {
    // update_comment_updated_at fyrar på alla UPDATE. Utan att den släpps under
    // backfillen får varje kommentar en färsk updated_at och UI:t visar
    // "(redigerad)" på något ingen rört.
    insertComment(db, 'c1', '**Från:** A (a@x.se)\n\nJa.');
    migration071!.up(db, realHelpers(db));

    const row = db
      .prepare('SELECT created_at, updated_at FROM ticket_comments WHERE id = ?')
      .get('c1') as { created_at: string; updated_at: string };
    expect(row.updated_at).toBe('2026-05-10 16:20:10');
    expect(row.updated_at).toBe(row.created_at);
  });

  it('återskapar updated_at-triggern efter backfillen', () => {
    insertComment(db, 'c1', '**Från:** A (a@x.se)\n\nJa.');
    migration071!.up(db, realHelpers(db));

    const trigger = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='update_comment_updated_at'")
      .get() as { sql: string } | undefined;
    expect(trigger).toBeDefined();

    // ...och den fyrar fortfarande på en riktig redigering.
    db.prepare("UPDATE ticket_comments SET content = 'Nej.' WHERE id = 'c1'").run();
    const row = db.prepare('SELECT updated_at FROM ticket_comments WHERE id = ?').get('c1') as {
      updated_at: string;
    };
    expect(row.updated_at).not.toBe('2026-05-10 16:20:10');
  });

  it('backfillar flera kommentarer i samma körning', () => {
    insertComment(db, 'c1', '**Från:** A (a@x.se)\n\nEtt.');
    insertComment(db, 'c2', '**Från:** B (b@x.se)\n\nTvå.');
    migration071!.up(db, realHelpers(db));

    expect(readComment(db, 'c1').email_from_address).toBe('a@x.se');
    expect(readComment(db, 'c2').email_from_address).toBe('b@x.se');
  });
});
