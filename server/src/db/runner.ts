import type { Database as DatabaseType } from 'better-sqlite3';
import { copyFileSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import { migrations as allMigrations, type Migration, type MigrationHelpers } from './migrations.js';
import { logger } from '../lib/logger.js';

// SQLite-identifier whitelist regex: bokstäver, siffror, underscore — startar inte med siffra.
// Skyddar PRAGMA table_info(${tableName}) mot injection eftersom det inte går att parametrisera.
const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function tableExists(db: DatabaseType, name: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

export function columnExists(db: DatabaseType, tableName: string, columnName: string): boolean {
  if (!VALID_IDENTIFIER.test(tableName)) {
    throw new Error(`columnExists: invalid table name "${tableName}"`);
  }
  // Returnera false om tabellen inte finns istället för att kasta — migrations kan
  // legitimt kolla columnExists FÖRE tabellen skapas (defensiv idempotent kod).
  if (!tableExists(db, tableName)) return false;
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return columns.some((column) => column.name === columnName);
}

export function migrationHelpers(db: DatabaseType): MigrationHelpers {
  return {
    tableExists: (name) => tableExists(db, name),
    columnExists: (table, column) => columnExists(db, table, column),
  };
}

const SNAPSHOT_PREFIX = 'pre-migration-';
const SNAPSHOTS_KEPT = 3;

/**
 * Byte-trogen kopia av databasen innan väntande migrationer körs. Kopian tas med
 * wal_checkpoint(TRUNCATE) + filkopia: db.backup() är asynkron och kan inte
 * invänta i den synkrona uppstarten, och VACUUM INTO numrerar om rowid i tabeller
 * med TEXT-PK vilket skulle bryta FTS-kopplingen i kopian. Ligger i backup-
 * katalogen men utan prefixet `backup-`, så backupschemats retention rör den inte.
 */
export function takePreMigrationSnapshot(db: DatabaseType, backupDir: string, migrationId: string): string | null {
  if (db.memory || !db.name) return null;
  const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
  if (checkpoint[0]?.busy) {
    throw new Error('wal_checkpoint(TRUNCATE) was busy — snapshot would be incomplete');
  }
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  // Kraschar en migration varje uppstart skulle varje omstart annars skriva en ny
  // kopia (av ett redan halvbehandlat läge) och tränga ut den riktiga snapshoten
  // från före uppgraderingen. Första kopian per migrations-id räcker.
  const prefix = `${SNAPSHOT_PREFIX}${migrationId}-`;
  if (readdirSync(backupDir).some((f) => f.startsWith(prefix) && f.endsWith('.sqlite'))) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(backupDir, `${prefix}${timestamp}.sqlite`);
  try {
    copyFileSync(db.name, target);
  } catch (err) {
    // En halv kopia får aldrig ligga kvar och räknas som en giltig snapshot.
    rmSync(target, { force: true });
    logger.error('Pre-migration snapshot copy failed', { target, error: String(err) });
    return null;
  }

  const stale = readdirSync(backupDir)
    .filter((f) => f.startsWith(SNAPSHOT_PREFIX) && f.endsWith('.sqlite'))
    .sort()
    .slice(0, -SNAPSHOTS_KEPT);
  for (const old of stale) unlinkSync(join(backupDir, old));
  return target;
}

// Mängden brott (inte bara antalet): en migration som rättar ett gammalt brott men
// skapar ett nytt får annars samma antal och släpps igenom.
function foreignKeyViolations(db: DatabaseType): Set<string> {
  const rows = db.pragma('foreign_key_check') as { table: string; rowid: number | null; parent: string; fkid: number }[];
  return new Set(rows.map((r) => `${r.table}|${r.rowid}|${r.parent}|${r.fkid}`));
}

function applyMigration(db: DatabaseType, migration: Migration): void {
  const markApplied = db.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)'
  );
  const run = () => {
    migration.up(db, migrationHelpers(db));
    markApplied.run(migration.id, migration.name, new Date().toISOString());
  };

  if (!migration.disableForeignKeys) {
    db.transaction(run)();
    return;
  }

  // PRAGMA foreign_keys är en no-op inuti en transaktion, så den slås av FÖRE
  // den. Annars cascade-raderar DROP TABLE på en förälder alla barnrader.
  // Befintliga föräldralösa rader ska inte stoppa uppstarten — bara nya fel.
  const violationsBefore = foreignKeyViolations(db);
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      run();
      const introduced = [...foreignKeyViolations(db)].filter((key) => !violationsBefore.has(key));
      if (introduced.length > 0) {
        throw new Error(
          `foreign_key_check: migration ${migration.id} introduced ${introduced.length} foreign key violation(s)`
        );
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export interface RunMigrationsOptions {
  /** Katalog för pre-migration-snapshot. Utelämnad = ingen snapshot. */
  snapshotDir?: string;
}

export function runMigrations(
  db: DatabaseType,
  list: Migration[] = allMigrations,
  options: RunMigrationsOptions = {}
): void {
  db.prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id)
  );
  const pending = list.filter((m) => !applied.has(m.id));
  if (pending.length === 0) return;

  // En helt ny databas (inget applicerat än) har inget att skydda.
  if (options.snapshotDir && applied.size > 0 && !db.memory) {
    try {
      const path = takePreMigrationSnapshot(db, options.snapshotDir, pending[0].id);
      if (path) logger.info('Pre-migration snapshot written', { path });
    } catch (err) {
      logger.warn('Could not write pre-migration snapshot — continuing', { error: String(err) });
    }
  }

  for (const migration of pending) {
    logger.info(`Running migration ${migration.id}: ${migration.name}`);
    try {
      applyMigration(db, migration);
    } catch (err) {
      logger.error(`Migration ${migration.id} (${migration.name}) failed`, { error: String(err) });
      throw err; // Stop startup — don't run further migrations on partial state
    }
    logger.info(`Migration ${migration.id} applied`);
  }
}
