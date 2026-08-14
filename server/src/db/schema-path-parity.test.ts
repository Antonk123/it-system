import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { migrations } from './migrations.js';

/**
 * Fresh install ↔ uppgraderad install: landar de i SAMMA schema?
 *
 * Det finns två vägar till en databas i drift:
 *
 *   FRESH       dagens schema.sql (som redan innehåller de retrofittade
 *               kolumnerna) → migrationerna, vars guards no-op:ar.
 *   UPPGRADERAD en form som byggts upp migration för migration sedan februari
 *               2026 → dagens schema.sql (no-op på det som finns) → de
 *               migrationer som ännu inte är applicerade.
 *
 * PROD ÄR UPPGRADERAD. CI, dev-volymen och varje ny installation är FRESH.
 * migration-parity.test.ts bygger bara FRESH och kan därför inte se när de två
 * vägarna glider ifrån varandra. Driften hade redan hunnit bita tre gånger:
 *
 *   · migration 059 lappar i sin egen kommentar "fresh-installs där schema.sql
 *     skapade refresh_tokens utan last_used_at + utan index (migration 027
 *     hoppade över pga tableExists)" — upptäckt i drift, inte av ett test.
 *   · nio index fanns bara på uppgraderade databaser: sju skapades inuti
 *     `if (!columnExists(...))` (fresh hoppar över hela blocket, inklusive
 *     CREATE INDEX) och två kom från ett standalone-script som kördes manuellt
 *     mot prod och sedan raderades. Åtgärdat av migration 069.
 *   · kb_article_tags behöll en legacy-kolumn `tag TEXT NOT NULL` på
 *     uppgraderade databaser medan fresh fick den nya formen — appens
 *     `INSERT OR IGNORE ... (id, article_id, tag_id)` bröt NOT NULL och taggen
 *     försvann TYST. Åtgärdat av migration 070.
 *
 * Jämförelsen är SEMANTISK och ordningsokänslig (kolumner via PRAGMA
 * table_info, index och unikhet via index_list, främmande nycklar via
 * foreign_key_list, CHECK-villkor som mängd, triggers och vyer via normaliserad
 * SQL) — den fäller på riktiga skillnader: en saknad kolumn, ett index som bara
 * finns på en väg, ett DEFAULT/NOT NULL/CHECK/FK som skiljer sig.
 *
 * Kolumn-ORDNINGEN jämförs separat, eftersom SQLite bara kan lägga till
 * kolumner sist: en kolumn som står inline mitt i schema.sql men läggs till med
 * ALTER i en migration hamnar olika. Det är kosmetiskt så länge ingen kod är
 * positionsberoende — men `INSERT INTO ny SELECT * FROM gammal`
 * (12-stegs-rebuild, se migration 039) ÄR positionsberoende och skulle blanda
 * om kolumnerna bara i prod.
 *
 * Kvarvarande skillnader ligger i explicita listor nedan, var och en med skäl.
 * Listorna kan inte ruttna: en post som slutat avvika fäller också testet.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const currentSchema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
const upgradedInstallSnapshot = readFileSync(
  join(__dirname, 'fixtures', 'upgraded-install-2026-08.sql'),
  'utf-8'
);

// ── riggen: samma runner, två utgångslägen ─────────────────────────────────

/** Speglar connection.ts:s helpers — columnExists svarar false (kastar inte) när tabellen saknas. */
function migrationHelpers(db: DatabaseType) {
  const tableExists = (name: string) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
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

/** Speglar runMigrations() i connection.ts: arrayordning, en transaktion per migration, bokförd id. */
function runMigrations(db: DatabaseType) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id)
  );
  const markApplied = db.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)'
  );
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      migration.up(db, migrationHelpers(db));
      markApplied.run(migration.id, migration.name, new Date().toISOString());
    })();
  }
}

/** Det en riktig serverstart gör: exec schema.sql, sedan de migrationer som återstår. */
function boot(db: DatabaseType) {
  db.exec(currentSchema);
  runMigrations(db);
}

function newDb(): DatabaseType {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON'); // som connection.ts
  return db;
}

// ── introspektion ──────────────────────────────────────────────────────────

interface ColumnRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexListRow {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface ForeignKeyRow {
  from: string;
  table: string;
  to: string | null;
  on_update: string;
  on_delete: string;
}

const collapse = (sql: string | null) =>
  (sql ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\bIF NOT EXISTS\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/;$/, '')
    .trim();

const objectNames = (db: DatabaseType, type: 'table' | 'view' | 'trigger' | 'index') =>
  (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all(type) as { name: string }[]
  ).map((r) => r.name);

const objectSql = (db: DatabaseType, type: 'trigger' | 'view') =>
  Object.fromEntries(
    (
      db
        .prepare(
          `SELECT name, sql FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`
        )
        .all(type) as { name: string; sql: string | null }[]
    ).map((r) => [r.name, collapse(r.sql)])
  );

const columnRows = (db: DatabaseType, table: string) =>
  db.prepare(`PRAGMA table_info("${table}")`).all() as ColumnRow[];

/** Kolumnattribut per namn — ordningsokänsligt, jämför typ/NOT NULL/DEFAULT/PK. */
const columnAttributes = (db: DatabaseType, table: string) =>
  Object.fromEntries(
    columnRows(db, table).map((c) => [
      c.name,
      `type=${c.type} notnull=${c.notnull} default=${c.dflt_value ?? '∅'} pk=${c.pk}`,
    ])
  );

const columnOrder = (db: DatabaseType, table: string) => columnRows(db, table).map((c) => c.name);

/**
 * Alla index på tabellen inklusive dem SQLite skapar själv för UNIQUE och
 * PRIMARY KEY (origin 'u'/'pk') — så ett unikhetsvillkor som bara finns på en
 * väg fälls även om det aldrig fick ett eget namngivet index. Autoindexens
 * genererade namn (sqlite_autoindex_<tabell>_<n>) är positionsberoende och
 * ingår därför inte i nyckeln; det är kolumnerna och unikheten som jämförs.
 */
const indexSignatures = (db: DatabaseType, table: string) =>
  (db.prepare(`PRAGMA index_list("${table}")`).all() as IndexListRow[])
    .map((idx) => {
      const cols = (
        db.prepare(`PRAGMA index_info("${idx.name}")`).all() as { name: string | null }[]
      )
        .map((c) => c.name ?? '<expr>')
        .join(',');
      const where = idx.partial
        ? collapse(
            (
              db
                .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`)
                .get(idx.name) as { sql: string | null } | undefined
            )?.sql ?? ''
          ).replace(/^.*?\bWHERE\b/i, 'WHERE')
        : '';
      const label = idx.origin === 'c' ? idx.name : `<${idx.origin}>`;
      return `${label} unique=${idx.unique} (${cols})${where ? ` ${where}` : ''}`;
    })
    .sort();

const foreignKeys = (db: DatabaseType, table: string) =>
  (db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as ForeignKeyRow[])
    .map(
      (fk) =>
        `${fk.from} → ${fk.table}.${fk.to ?? 'rowid'} on_delete=${fk.on_delete} on_update=${fk.on_update}`
    )
    .sort();

/**
 * CHECK-villkor som mängd. Inget PRAGMA exponerar dem, så de plockas ur
 * CREATE TABLE-texten — utan dem skulle ett borttappat CHECK(status IN (…))
 * passera obemärkt. Blanksteg efter komma normaliseras bort: ('a', 'b') och
 * ('a','b') är samma villkor.
 */
const checkConstraints = (db: DatabaseType, table: string) => {
  const sql =
    (
      db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
        | { sql: string | null }
        | undefined
    )?.sql ?? '';
  const found: string[] = [];
  const re = /\bCHECK\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
      i++;
    }
    found.push(collapse(sql.slice(match.index, i)).replace(/,\s+/g, ','));
  }
  return found.sort();
};

// ── godtagna avvikelser ────────────────────────────────────────────────────

/**
 * Kolumnordning som skiljer sig mellan vägarna: kolumnen står inline i
 * schema.sql (fresh får den på sin deklarerade plats) men lades till med ALTER
 * TABLE i en migration (uppgraderad har den sist). Att räta ut det kräver en
 * tabell-rebuild i prod — inte värt risken för en ordning ingen kod läser.
 *
 * Lägg INTE till en tabell här utan att först kontrollera att inget gör
 * `INSERT INTO … SELECT *` eller `INSERT INTO <tabell> VALUES (…)` mot den:
 * båda är positionsberoende och skulle träffa fel kolumn i prod.
 */
const ACCEPTED_COLUMN_ORDER: Record<string, string> = {
  categories: 'position lades till med ALTER av en migration, står inline i schema.sql',
  companies: 'sla_disabled lades till av migration 045, står inline i schema.sql',
  contacts: 'company_id + department lades till med ALTER, står inline i schema.sql',
  refresh_tokens: 'revoked resp. last_used_at tillkom i olika ordning i schema.sql och migration',
  ticket_templates: 'template_type lades till av migration 046, står inline i den äldre formen',
  users: 'display_name fanns inte i den äldsta formen och lades till med ALTER',
};

/**
 * Kolumnattribut som skiljer sig och som inte går att rätta utan tabell-
 * rebuild (SQLite kan inte ändra NOT NULL eller DEFAULT med ALTER). Nyckeln är
 * `tabell.kolumn`. Varje post ska ange varför skillnaden är ofarlig — annars
 * hör den inte hit utan i en rebuild-migration.
 */
const ACCEPTED_COLUMN_ATTRIBUTES: Record<string, string> = {
  'tags.color':
    'uppgraderad: NOT NULL DEFAULT #6366f1, fresh: nullable DEFAULT #3b82f6. Ofarligt — ' +
    'routes/tags.ts skickar alltid color explicit, så defaulten används aldrig.',
  'ticket_templates.description_template':
    'uppgraderad: nullable, fresh: NOT NULL. Ofarligt — routes/templates.ts skriver ' +
    "`description_template || ''`, aldrig NULL.",
  'refresh_tokens.last_used_at':
    'uppgraderad: DEFAULT CURRENT_TIMESTAMP, fresh: utan default. Ofarligt — kolumnen ' +
    'skrivs alltid explicit av den som uppdaterar den.',
};

/**
 * Främmande nycklar och CHECK-villkor som skiljer sig. ticket_templates skapades
 * i den uppgraderade formen av ett äldre schema.sql (med template_type + dess
 * CHECK, utan FK på created_by); fresh får migration 006:s form (FK på
 * created_by, template_type via ALTER och därmed utan CHECK).
 *
 * Rebuild är MEDVETET inte gjord: template_fields hänger på ticket_templates med
 * ON DELETE CASCADE, och migrationsrunnern kör varje migration i en transaktion
 * där `PRAGMA foreign_keys = OFF` inte biter. En DROP TABLE på förälder hade
 * därmed cascade-raderat alla template_fields-rader. Kräver en migration med
 * egen pragma-hantering utanför transaktionen — eget, riskbedömt pass.
 */
const ACCEPTED_FOREIGN_KEYS: Record<string, string> = {
  ticket_templates: 'created_by → users saknas i den uppgraderade formen (äldre CREATE TABLE)',
};

const ACCEPTED_CHECKS: Record<string, string> = {
  ticket_templates:
    "CHECK(template_type IN ('standard','dynamic')) finns bara i den uppgraderade formen — " +
    'ALTER TABLE ADD COLUMN kan inte lägga till ett CHECK, så fresh saknar det',
};

// ── testerna ───────────────────────────────────────────────────────────────

describe('schema-vägar: fresh install ↔ uppgraderad install', () => {
  let fresh: DatabaseType;
  let upgraded: DatabaseType;

  beforeAll(() => {
    fresh = newDb();
    boot(fresh);

    upgraded = newDb();
    upgraded.exec(upgradedInstallSnapshot); // formen en uppgraderad instans har
    boot(upgraded); // dagens start ovanpå den formen
  });

  afterAll(() => {
    fresh?.close();
    upgraded?.close();
  });

  /**
   * Jämför en dimension tabell för tabell och skiljer nya avvikelser från de
   * godtagna. Returnerar även godtaganden som inte längre behövs — de ska bort,
   * annars döljer de nästa gång samma tabell faktiskt glider isär.
   */
  const diffByTable = (
    extract: (db: DatabaseType, table: string) => string[],
    accepted: Record<string, string>
  ) => {
    const unexpected: string[] = [];
    const stale = new Set(Object.keys(accepted));
    for (const table of objectNames(fresh, 'table')) {
      const a = extract(fresh, table);
      const b = extract(upgraded, table);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      if (table in accepted) {
        stale.delete(table);
        continue;
      }
      unexpected.push(
        `${table}:\n    fresh:       ${a.join('\n                 ')}\n    uppgraderad: ${b.join('\n                 ')}`
      );
    }
    return { unexpected, stale: [...stale] };
  };

  it('ögonblicksbilden är verkligen en AVVIKANDE form (annars bevisar testet ingenting)', () => {
    // Anti-tautologi: ersätts fixturen någon gång av dagens schema.sql blir de
    // två vägarna identiska av triviala skäl och testet slutar mäta något.
    const snapshotOnly = newDb();
    snapshotOnly.exec(upgradedInstallSnapshot);
    const usersOrder = columnOrder(snapshotOnly, 'users');
    const hasLegacyTagColumn = columnOrder(snapshotOnly, 'kb_article_tags').includes('tag');
    const indexNames = objectNames(snapshotOnly, 'index');
    const appliedCount = (
      snapshotOnly.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }
    ).n;
    snapshotOnly.close();

    // display_name står tidigt i schema.sql men efter last_login i den
    // uppgraderade formen — bevis på verklig ALTER-historik i fixturen.
    expect(usersOrder.indexOf('display_name')).toBeGreaterThan(usersOrder.indexOf('last_login'));
    // Legacy-kolumnen som migration 070 städar bort ska finnas i utgångsläget.
    expect(hasLegacyTagColumn).toBe(true);
    // Index som bara uppgraderade databaser fick (guard-missen migration 069 rättar).
    expect(indexNames).toContain('idx_tickets_sla_response');
    // Fixturen bär med sig vilka migrationer som redan var applicerade, annars
    // hade testet kört om alla mot en databas som redan har dem.
    expect(appliedCount).toBeGreaterThan(0);
    expect(appliedCount).toBeLessThan(migrations.length + 1);
  });

  it('båda vägarna har alla migrationer bokförda', () => {
    const idsIn = (db: DatabaseType) =>
      (db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as { id: string }[]).map(
        (r) => r.id
      );
    const expected = [...migrations.map((m) => m.id)].sort();
    expect(idsIn(fresh)).toEqual(expected);
    expect(idsIn(upgraded)).toEqual(expected);
  });

  it('samma tabeller och vyer finns på båda vägarna', () => {
    expect(objectNames(upgraded, 'table')).toEqual(objectNames(fresh, 'table'));
    expect(objectNames(upgraded, 'view')).toEqual(objectNames(fresh, 'view'));
  });

  it('varje tabell har samma kolumner med samma typ, NOT NULL, DEFAULT och PK', () => {
    const divergences: string[] = [];
    const stale = new Set(Object.keys(ACCEPTED_COLUMN_ATTRIBUTES));

    for (const table of objectNames(fresh, 'table')) {
      const a = columnAttributes(fresh, table);
      const b = columnAttributes(upgraded, table);
      for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[name] === b[name]) continue;
        const key = `${table}.${name}`;
        if (key in ACCEPTED_COLUMN_ATTRIBUTES) {
          stale.delete(key);
          continue;
        }
        divergences.push(
          `${key}: fresh[${a[name] ?? 'SAKNAS'}] ≠ uppgraderad[${b[name] ?? 'SAKNAS'}]`
        );
      }
    }

    expect(divergences).toEqual([]);
    expect([...stale]).toEqual([]);
  });

  it('varje tabell har samma index och unikhetsvillkor', () => {
    const { unexpected, stale } = diffByTable(indexSignatures, {});
    expect(unexpected).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('varje tabell har samma främmande nycklar', () => {
    const { unexpected, stale } = diffByTable(foreignKeys, ACCEPTED_FOREIGN_KEYS);
    expect(unexpected).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('varje tabell har samma CHECK-villkor', () => {
    const { unexpected, stale } = diffByTable(checkConstraints, ACCEPTED_CHECKS);
    expect(unexpected).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('samma triggers och vyer med samma definition', () => {
    expect(objectSql(upgraded, 'trigger')).toEqual(objectSql(fresh, 'trigger'));
    expect(objectSql(upgraded, 'view')).toEqual(objectSql(fresh, 'view'));
  });

  it('kolumnordningen skiljer sig bara där det är godtaget och dokumenterat', () => {
    const { unexpected, stale } = diffByTable(columnOrder, ACCEPTED_COLUMN_ORDER);
    expect(unexpected).toEqual([]);
    expect(stale).toEqual([]);
  });
});
