import cron from 'node-cron';
import { ZipArchive } from 'archiver';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { existsSync, mkdirSync, unlinkSync, createWriteStream, statSync, readdirSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { db as defaultDb } from '../db/connection.js';
import { uploadBackupOffsite } from './offsiteBackup.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fynd L14: 'offsite_failed' = lokal backup OK men offsite-uppladdningen misslyckades
// (bara möjligt när OFFSITE_BACKUP_REQUIRED=true). Ingen schemaändring — last_status är TEXT.
export type BackupRunStatus = 'success' | 'failed' | 'offsite_failed';

export interface BackupConfig {
  enabled: boolean;
  time: string; // 'HH:MM' 24h i containerns lokaltid (styrs av TZ-env; prod = Europe/Stockholm, kräver tzdata i imagen — annars UTC)
  retentionDays: number;
  lastRunAt: string | null;
  lastStatus: BackupRunStatus | null;
  lastSizeBytes: number | null;
}

export interface RunResult {
  status: BackupRunStatus | 'skipped';
  path?: string;
  sizeBytes?: number;
  error?: string;
}

interface ConfigRow {
  enabled: number;
  time: string;
  retention_days: number;
  last_run_at: string | null;
  last_status: string | null;
  last_size_bytes: number | null;
}

function defaultBackupDir(): string {
  const dbPath = process.env.DB_PATH || join(__dirname, '../../data/database.sqlite');
  return join(dirname(dbPath), 'backups');
}

function defaultUploadDir(): string {
  return process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');
}

// 'HH:MM' → node-cron 'M H * * *' (serverns lokaltid). parseInt tar bort ledande nollor.
export function timeToCron(time: string): string {
  const [hh, mm] = time.split(':');
  return `${parseInt(mm, 10)} ${parseInt(hh, 10)} * * *`;
}

export function getBackupConfig(database: DatabaseType = defaultDb): BackupConfig {
  const row = database
    .prepare(
      'SELECT enabled, time, retention_days, last_run_at, last_status, last_size_bytes FROM backup_config WHERE id = 1',
    )
    .get() as ConfigRow | undefined;

  // Säkerhetsfallback om raden saknas (bör inte hända efter migration 061).
  if (!row) {
    return { enabled: true, time: '04:00', retentionDays: 7, lastRunAt: null, lastStatus: null, lastSizeBytes: null };
  }

  return {
    enabled: row.enabled === 1,
    time: row.time,
    retentionDays: row.retention_days,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status as BackupRunStatus | null,
    lastSizeBytes: row.last_size_bytes,
  };
}

// In-flight-guard så cron och manuell "kör nu" inte överlappar.
let running = false;
export function isBackupRunning(): boolean {
  return running;
}

// Fynd M13: konsekutiva HELT misslyckade körningar (lokalt backup-fel). Speglar
// consecutiveFailures-mönstret i aiHelper.ts. 'offsite_failed' nollställer — den
// lokala pipelinen är då frisk och offsite har egen räknare (offsiteBackup.ts).
// Ingen generell mail-hjälpare finns i server/src/lib (email.ts är ticketmall-
// specifik), så larmet går via logg + exponeras i GET /api/backup/config.
let consecutiveBackupFailures = 0;
const BACKUP_FAILURE_ALERT_THRESHOLD = 3;

/** Antal konsekutiva misslyckade backup-körningar (in-memory, ingen DB). */
export function getConsecutiveBackupFailures(): number {
  return consecutiveBackupFailures;
}

function recordRun(database: DatabaseType, status: BackupRunStatus, sizeBytes: number | null): void {
  if (status === 'failed') {
    consecutiveBackupFailures++;
    if (consecutiveBackupFailures >= BACKUP_FAILURE_ALERT_THRESHOLD) {
      logger.error('BACKUP ALERT: consecutive backup failures — investigate immediately', {
        consecutiveFailures: consecutiveBackupFailures,
        threshold: BACKUP_FAILURE_ALERT_THRESHOLD,
      });
    }
  } else {
    if (consecutiveBackupFailures >= BACKUP_FAILURE_ALERT_THRESHOLD) {
      logger.info('Backup recovered after consecutive failures', { count: consecutiveBackupFailures });
    }
    consecutiveBackupFailures = 0;
  }

  try {
    const now = new Date().toISOString();
    database
      .prepare('UPDATE backup_config SET last_run_at = ?, last_status = ?, last_size_bytes = ?, updated_at = ? WHERE id = 1')
      .run(now, status, sizeBytes, now);
  } catch (e) {
    logger.error('Failed to record backup status', { error: String(e) });
  }
}

export async function runBackup(
  database: DatabaseType = defaultDb,
  opts: { backupDir?: string; uploadDir?: string } = {},
): Promise<RunResult> {
  // In-flight-guard: hoppa över en överlappande körning (cron-vs-manuell eller
  // cron-vs-cron). Annars öppnar två runBackup samma backup-<datum>.zip parallellt
  // → interfolierade writes → korrupt zip. Synkron check+set före första await
  // gör guarden race-fri i Nodes enkeltrådade modell.
  if (running) {
    logger.warn('Backup already in progress — skipping overlapping run');
    return { status: 'skipped' };
  }
  running = true;
  const backupDir = opts.backupDir ?? defaultBackupDir();
  const uploadDir = opts.uploadDir ?? defaultUploadDir();
  const tmpDbPath = join(backupDir, `tmp-${Date.now()}.sqlite`);

  // Städar tmp-snapshot + dess -wal/-shm/-journal-sidecars (tidigare läcka:
  // unlink tog bara .sqlite och lämnade kvar -shm/-wal per körning).
  const cleanupTmp = () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { unlinkSync(tmpDbPath + suffix); } catch { /* redan borta */ }
    }
  };

  try {
    // 0o700: backup-katalogen innehåller fulla DB-dumpar → endast ägaren.
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    // Fynd backup-audit-6: logga att backup-katalogen är redo (skapad/verifierad).
    logger.info('Backup directory ready', { path: backupDir });
    const dateStr = new Date().toISOString().slice(0, 10);
    const backupPath = join(backupDir, `backup-${dateStr}.zip`);

    // 1. WAL-säker online-snapshot
    await database.backup(tmpDbPath);

    // 2. Integritetskontroll — korrupt DB rullar aldrig in i retention
    const verifyDb = new Database(tmpDbPath, { readonly: true });
    try {
      const res = verifyDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (!(res.length === 1 && res[0].integrity_check === 'ok')) {
        throw new Error(`integrity_check failed: ${JSON.stringify(res)}`);
      }
    } finally {
      verifyDb.close();
    }

    // 3. Bunta DB + uploads till ZIP (samma struktur som manuell download → direkt restorebar)
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(backupPath);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      archive.file(tmpDbPath, { name: 'data/database.sqlite' });
      if (existsSync(uploadDir)) {
        archive.directory(uploadDir, 'data/uploads');
      }
      archive.finalize();
    });

    // Fynd backup-audit-5 + commit-säkerhetsgranskning: arkivet är nu fullständigt
    // skrivet (output 'close' har triggat ovan). Backup-ZIP:en innehåller HELA
    // databasen (inkl. hemligheter) → minsta-rättighet 0o600 (endast ägaren).
    // OFFSITE_BACKUP_CMD spawnas av samma Node-process (samma uid) och kan läsa
    // 0o600. Gör INTE filen world-readable. Icke-fatalt — logga bara vid fel.
    try {
      chmodSync(backupPath, 0o600);
    } catch (chmodErr) {
      logger.warn('Kunde inte sätta läsrättigheter (0o600) på backup-filen', { path: backupPath, error: String(chmodErr) });
    }

    cleanupTmp();
    const sizeBytes = statSync(backupPath).size;
    logger.info('Automatic backup completed', { path: backupPath, sizeBytes });

    // 3b. Off-site-upload (konfigureras via OFFSITE_BACKUP_CMD).
    // Fynd backup-audit-7 + L14: uploadBackupOffsite kastar bara när
    // OFFSITE_BACKUP_REQUIRED === 'true'. Den lokala backupen är då redan skriven och
    // verifierad, så körningen ska INTE markeras som helt 'failed' (det dolde att en
    // giltig lokal backup fanns och hoppade över retention för dagen). Vi fångar felet,
    // markerar 'offsite_failed' och låter retention köras ändå. Icke-required-fel har
    // funktionen själv redan loggat och returnerat normalt.
    let offsiteFailed = false;
    try {
      await uploadBackupOffsite(backupPath);
    } catch (offSiteErr) {
      offsiteFailed = true;
      logger.error('Off-site backup failed — local backup kept, run marked offsite_failed', { error: String(offSiteErr) });
    }

    // 4. Retention — behåll nyaste N, radera äldre .zip/.sqlite-snapshots.
    // Fynd backup-audit-4: läs retentionDays EN gång och ta EN ögonblicksbild av
    // fillistan i början av passet. Loopen itererar bara över denna frusna snapshot
    // (readdirSync görs aldrig om mitt i loopen), så en samtidig config-/filändring
    // kan inte ge inkonsekventa raderingsbeslut.
    const retentionDays = getBackupConfig(database).retentionDays;
    const retentionSnapshot = readdirSync(backupDir)
      .filter((f) => f.startsWith('backup-') && (f.endsWith('.zip') || f.endsWith('.sqlite')))
      .sort()
      .reverse();
    for (const old of retentionSnapshot.slice(retentionDays)) {
      try {
        unlinkSync(join(backupDir, old));
        logger.info('Deleted old backup', { file: old });
      } catch { /* ignore */ }
    }

    const status: BackupRunStatus = offsiteFailed ? 'offsite_failed' : 'success';
    recordRun(database, status, sizeBytes);
    return { status, path: backupPath, sizeBytes };
  } catch (error) {
    cleanupTmp();
    logger.error('Automatic backup failed', { error: String(error) });
    recordRun(database, 'failed', null);
    return { status: 'failed', error: String(error) };
  } finally {
    running = false;
  }
}

// ── Schemaläggning ──────────────────────────────────────────────────────────
let task: ReturnType<typeof cron.schedule> | null = null;

// Fynd M12: node-cron registrerar bara framåt — var servern nere vid klockslaget
// hoppades dagens backup över tyst. Catch-up behövs när senaste körningen saknas,
// har ett oparsebart timestamp eller är äldre än ~24h.
const CATCH_UP_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Exporterad för testbarhet — ren beslutsfunktion för M12-catch-up. */
export function isCatchUpNeeded(lastRunAt: string | null, nowMs: number = Date.now()): boolean {
  if (!lastRunAt) return true;
  const lastRunMs = Date.parse(lastRunAt);
  return !Number.isFinite(lastRunMs) || nowMs - lastRunMs > CATCH_UP_THRESHOLD_MS;
}

export function startBackupScheduler(
  database: DatabaseType = defaultDb,
  opts: { catchUp?: boolean; backupDir?: string; uploadDir?: string } = {},
): void {
  // Fynd backup-audit-6: säkerställ + logga backup-katalogen redan vid schedulerstart,
  // inte först vid första körningen.
  const backupDir = opts.backupDir ?? defaultBackupDir();
  try {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    logger.info('Backup directory ready', { path: backupDir });
  } catch (e) {
    logger.warn('Kunde inte skapa/verifiera backup-katalogen vid start', { path: backupDir, error: String(e) });
  }

  const cfg = getBackupConfig(database);
  if (!cfg.enabled) {
    logger.info('Automatic backup disabled (paused via UI)');
    return;
  }

  // Fynd M12: kör ikapp en missad backup direkt vid start (asynkront, icke-fatalt —
  // runBackup fångar egna fel; .catch är hängslen så schemaläggningen aldrig stoppas).
  if ((opts.catchUp ?? true) && isCatchUpNeeded(cfg.lastRunAt)) {
    logger.info('Backup catch-up: last run missing or older than 24h — running backup now', { lastRunAt: cfg.lastRunAt });
    void runBackup(database, { backupDir: opts.backupDir, uploadDir: opts.uploadDir }).catch((e) => {
      logger.error('Backup catch-up run failed unexpectedly', { error: String(e) });
    });
  }

  task = cron.schedule(timeToCron(cfg.time), () => {
    void runBackup(database);
  });
  logger.info(`Automatic backup scheduled (daily at ${cfg.time} ${process.env.TZ ?? 'UTC'}, retain ${cfg.retentionDays})`);
}

// Anropas efter config-PUT så tid/paus slår igenom utan omstart.
// catchUp: false — en config-ändring är ingen serverstart; utan gaten skulle varje
// PUT med gammal last_run_at trigga en omedelbar (oväntad) backup-körning.
export function reconfigureBackupScheduler(database: DatabaseType = defaultDb): void {
  if (task) {
    task.stop();
    task = null;
  }
  startBackupScheduler(database, { catchUp: false });
}

export function stopBackupScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
