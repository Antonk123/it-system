import cron from 'node-cron';
import { ZipArchive } from 'archiver';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import unzipper from 'unzipper';
import { existsSync, mkdirSync, unlinkSync, createWriteStream, statSync, readdirSync, chmodSync, renameSync, statfsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { db as defaultDb } from '../db/connection.js';
import { uploadBackupOffsite } from './offsiteBackup.js';
import { sendPushToAllSubscriptions } from './push.js';
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
  // Persisteras i backup_config så räknaren överlever omstart (annars nollas den
  // av varje deploy och larmet efter 3 fel kan aldrig nås vid restart-loopar).
  consecutiveFailures: number;
  lastError: string | null;
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
  consecutive_failures: number;
  last_error: string | null;
}

// backup-YYYY-MM-DD[-HHMM].zip — samma mönster används för listning/nedladdning i routes/backup.ts.
export const BACKUP_ZIP_NAME_RE = /^backup-\d{4}-\d{2}-\d{2}(-\d{4})?\.zip$/;
const BACKUP_FILE_DATE_RE = /^backup-(\d{4}-\d{2}-\d{2})(?:-\d{4})?\.(?:zip|sqlite)$/;

// Lägsta lediga utrymme som krävs för en backup-körning, oavsett datamängd.
const MIN_FREE_BYTES = 500 * 1024 * 1024;

export function getBackupDir(): string {
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
      'SELECT enabled, time, retention_days, last_run_at, last_status, last_size_bytes, consecutive_failures, last_error FROM backup_config WHERE id = 1',
    )
    .get() as ConfigRow | undefined;

  // Säkerhetsfallback om raden saknas (bör inte hända efter migration 061).
  if (!row) {
    return {
      enabled: true, time: '04:00', retentionDays: 7, lastRunAt: null, lastStatus: null, lastSizeBytes: null,
      consecutiveFailures: 0, lastError: null,
    };
  }

  return {
    enabled: row.enabled === 1,
    time: row.time,
    retentionDays: row.retention_days,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status as BackupRunStatus | null,
    lastSizeBytes: row.last_size_bytes,
    consecutiveFailures: row.consecutive_failures,
    lastError: row.last_error,
  };
}

// In-flight-guard så cron och manuell "kör nu" inte överlappar.
let running = false;
export function isBackupRunning(): boolean {
  return running;
}

/**
 * Väntar (max timeoutMs) tills en pågående backup är klar. Returnerar true om ingen
 * körning pågår längre. Används vid shutdown så closeDatabase() inte stänger
 * handtaget under en pågående database.backup().
 */
export async function waitForBackup(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !running;
}

// Fynd M13: larm efter N konsekutiva HELT misslyckade körningar (lokalt backup-fel).
// Räknaren ligger i backup_config.consecutive_failures så den överlever omstart.
// 'offsite_failed' nollställer — den lokala pipelinen är då frisk och offsite har
// egen räknare (offsiteBackup.ts).
const BACKUP_FAILURE_ALERT_THRESHOLD = 3;

async function notifyAdminsOfBackupFailure(database: DatabaseType, failures: number): Promise<void> {
  const admins = database.prepare("SELECT id FROM users WHERE role = 'admin'").all() as { id: string }[];
  for (const admin of admins) {
    await sendPushToAllSubscriptions(
      {
        type: 'backup_failed',
        ticketId: '',
        url: '/settings',
        title: 'Backup misslyckades',
        body: `Den automatiska backupen har misslyckats ${failures} gånger i rad. Kontrollera Inställningar > Backup.`,
      },
      admin.id,
    );
  }
}

function recordRun(database: DatabaseType, status: BackupRunStatus, sizeBytes: number | null, error: string | null = null): void {
  let previousFailures: number;
  let failures: number;
  try {
    previousFailures = getBackupConfig(database).consecutiveFailures;
    const now = new Date().toISOString();
    database
      .prepare(
        `UPDATE backup_config
         SET last_run_at = ?, last_status = ?, last_size_bytes = ?, last_error = ?,
             consecutive_failures = CASE WHEN ? = 'failed' THEN consecutive_failures + 1 ELSE 0 END,
             updated_at = ?
         WHERE id = 1`,
      )
      .run(now, status, sizeBytes, error?.slice(0, 500) ?? null, status, now);
    failures = getBackupConfig(database).consecutiveFailures;
  } catch (e) {
    logger.error('Failed to record backup status', { error: String(e) });
    return;
  }

  if (status === 'failed') {
    if (failures >= BACKUP_FAILURE_ALERT_THRESHOLD) {
      logger.error('BACKUP ALERT: consecutive backup failures — investigate immediately', {
        consecutiveFailures: failures,
        threshold: BACKUP_FAILURE_ALERT_THRESHOLD,
      });
    }
    if (failures === BACKUP_FAILURE_ALERT_THRESHOLD) {
      void notifyAdminsOfBackupFailure(database, failures).catch((e) => {
        logger.error('Kunde inte skicka push om misslyckad backup', { error: String(e) });
      });
    }
  } else if (previousFailures >= BACKUP_FAILURE_ALERT_THRESHOLD) {
    logger.info('Backup recovered after consecutive failures', { count: previousFailures });
  }
}

function dirSizeBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

/** Kastar om lediga bytes inte räcker till 2 × datamängden (och minst 500 MB). Exporterad för test. */
export function assertEnoughDiskSpace(freeBytes: number, dataBytes: number): void {
  const required = Math.max(2 * dataBytes, MIN_FREE_BYTES);
  if (freeBytes < required) {
    throw new Error(`Otillräckligt diskutrymme för backup: ${freeBytes} byte lediga, ${required} krävs`);
  }
}

// ZIP-filen öppnas på nytt efter skrivning: ett arkiv som inte går att läsa eller
// saknar databasen får aldrig räknas som en lyckad backup.
async function verifyBackupZip(zipPath: string): Promise<void> {
  const directory = await unzipper.Open.file(zipPath);
  const dbEntry = directory.files.find((f) => f.path === 'data/database.sqlite');
  if (directory.files.length === 0 || !dbEntry || dbEntry.uncompressedSize <= 0) {
    throw new Error('Backup-ZIP:en är ofullständig: data/database.sqlite saknas eller är tom');
  }
}

// Retention i dagar: datumet tolkas ur filnamnet (inte mtime, som ändras av kopiering/restore).
// Kvarlämnade *.zip.tmp (krasch mitt i en körning) städas också — in-flight-guarden
// garanterar att ingen annan körning skriver en sådan fil just nu.
function purgeOldBackups(backupDir: string, retentionDays: number): void {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const file of readdirSync(backupDir)) {
    const match = BACKUP_FILE_DATE_RE.exec(file);
    const isStaleTmp = /^backup-.*\.zip\.tmp$/.test(file);
    if (!isStaleTmp && (!match || Date.parse(`${match[1]}T00:00:00Z`) >= cutoffMs)) continue;
    try {
      unlinkSync(join(backupDir, file));
      logger.info('Deleted old backup', { file });
    } catch { /* ignore */ }
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
  const backupDir = opts.backupDir ?? getBackupDir();
  const uploadDir = opts.uploadDir ?? defaultUploadDir();
  const tmpDbPath = join(backupDir, `tmp-${Date.now()}.sqlite`);
  let tmpZipPath: string | null = null;

  // Städar tmp-snapshot + dess -wal/-shm/-journal-sidecars (tidigare läcka:
  // unlink tog bara .sqlite och lämnade kvar -shm/-wal per körning) samt en
  // halvskriven ZIP.
  const cleanupTmp = () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { unlinkSync(tmpDbPath + suffix); } catch { /* redan borta */ }
    }
    if (tmpZipPath) {
      try { unlinkSync(tmpZipPath); } catch { /* redan borta eller omdöpt */ }
    }
  };

  try {
    // 0o700: backup-katalogen innehåller fulla DB-dumpar → endast ägaren.
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    // Fynd backup-audit-6: logga att backup-katalogen är redo (skapad/verifierad).
    logger.info('Backup directory ready', { path: backupDir });

    // Diskkontroll före första skrivningen: en full disk ger annars en halv ZIP och
    // riskerar att fylla volymen som databasen själv ligger på.
    const dataBytes = statSync(database.name).size + dirSizeBytes(uploadDir);
    const fsStats = statfsSync(backupDir);
    assertEnoughDiskSpace(fsStats.bavail * fsStats.bsize, dataBytes);

    // HHMM i namnet så flera körningar samma dag (catch-up + cron) inte skriver över varandra.
    const stamp = new Date().toISOString();
    const backupPath = join(backupDir, `backup-${stamp.slice(0, 10)}-${stamp.slice(11, 13)}${stamp.slice(14, 16)}.zip`);
    tmpZipPath = `${backupPath}.tmp`;

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

    // 3. Bunta DB + uploads till ZIP (samma struktur som manuell download → direkt restorebar).
    // Skrivs till *.tmp och döps om först när arkivet är komplett och verifierat, så att
    // en krasch eller full disk aldrig lämnar en trasig fil under ett riktigt backup-namn.
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(tmpZipPath!);
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

    await verifyBackupZip(tmpZipPath);

    // Fynd backup-audit-5 + commit-säkerhetsgranskning: arkivet är nu fullständigt
    // skrivet (output 'close' har triggat ovan). Backup-ZIP:en innehåller HELA
    // databasen (inkl. hemligheter) → minsta-rättighet 0o600 (endast ägaren).
    // OFFSITE_BACKUP_CMD spawnas av samma Node-process (samma uid) och kan läsa
    // 0o600. Gör INTE filen world-readable. Icke-fatalt — logga bara vid fel.
    try {
      chmodSync(tmpZipPath, 0o600);
    } catch (chmodErr) {
      logger.warn('Kunde inte sätta läsrättigheter (0o600) på backup-filen', { path: backupPath, error: String(chmodErr) });
    }

    renameSync(tmpZipPath, backupPath);
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
    let offsiteError: string | null = null;
    try {
      await uploadBackupOffsite(backupPath);
    } catch (offSiteErr) {
      offsiteError = String(offSiteErr);
      logger.error('Off-site backup failed — local backup kept, run marked offsite_failed', { error: offsiteError });
    }

    // 4. Retention — radera backuper äldre än retention_days (datum ur filnamnet).
    purgeOldBackups(backupDir, getBackupConfig(database).retentionDays);

    const status: BackupRunStatus = offsiteError ? 'offsite_failed' : 'success';
    recordRun(database, status, sizeBytes, offsiteError);
    return { status, path: backupPath, sizeBytes };
  } catch (error) {
    cleanupTmp();
    logger.error('Automatic backup failed', { error: String(error) });
    recordRun(database, 'failed', null, String(error));
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
  const backupDir = opts.backupDir ?? getBackupDir();
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
