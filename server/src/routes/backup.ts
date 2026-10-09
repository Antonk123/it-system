import { Router, Response, Request, NextFunction } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { db, closeDatabase } from '../db/connection.js';
import type { Database as DatabaseType } from 'better-sqlite3';
import { ZipArchive } from 'archiver';
import { join, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync, mkdirSync, createReadStream, createWriteStream, copyFileSync, cpSync, rmSync, openSync, readSync, closeSync, chmodSync, renameSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import multer from 'multer';
import unzipper from 'unzipper';
import { logger } from '../lib/logger.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import {
  getBackupConfig,
  getBackupDir,
  runBackup,
  isBackupRunning,
  reconfigureBackupScheduler,
  BACKUP_ZIP_NAME_RE,
  type BackupConfig,
} from '../lib/backupScheduler.js';
import { getOffsiteFailureCount } from '../lib/offsiteBackup.js';
import { logAudit } from '../lib/auditLog.js';
import { rebuildFts } from '../lib/fts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/database.sqlite');
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

// Fynd 3: Använd diskStorage för restore-uppladdning för att undvika OOM vid stora ZIP:ar.
// Filen sparas till OS:ets tmp-katalog och refereras sedan via req.file.path.
const restoreTmpDir = tmpdir();
const MAX_RESTORE_UPLOAD_BYTES = 500 * 1024 * 1024;

// Multer-fel (fel filtyp, för stor fil) är klientfel: 400/413 i stället för att
// falla igenom till Expressens 500-hanterare. Fabrik så att testerna kan använda en liten gräns.
export function createRestoreUpload(maxBytes: number = MAX_RESTORE_UPLOAD_BYTES) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, restoreTmpDir),
      filename: (_req, _file, cb) => cb(null, `restore-upload-${randomUUID()}.zip`),
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
        cb(null, true);
      } else {
        cb(new Error('Endast ZIP-filer är tillåtna'));
      }
    },
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    upload.single('file')(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Filen är för stor. Max 500 MB.' });
        return;
      }
      res.status(400).json({ error: err instanceof multer.MulterError ? 'Uppladdningen misslyckades.' : 'Endast ZIP-filer är tillåtna.' });
    });
  };
}

const restoreUpload = createRestoreUpload();

// Tak för extraktionen: en liten ZIP kan expandera till långt mer än disken rymmer.
// Exporterat objekt (inte konstanter) så testerna kan sänka taken i stället för att bygga 2 GB.
export const restoreLimits = { maxExtractedBytes: 2 * 1024 * 1024 * 1024, maxEntries: 100_000 };

// Fynd 6: Rate limit för backup-download (max 10 nedladdningar per 15 min per IP).
const backupDownloadLimiter = createRateLimiter(15 * 60 * 1000, 10);

// Fynd restore-missing-rate-limit: Rate limit för restore (max 5 försök per 15 min per IP).
const restoreLimiter = createRateLimiter(15 * 60 * 1000, 5);

// Fynd M14: swap-logiken för restore utbruten ur route-handlern så att den lyckade
// vägen kan testas direkt (process.exit(0) stannar kvar i handlern). Invariant:
// pre-restore-kopiorna (DB via WAL-säker snapshot, uploads via omdöpning) tas FÖRE
// closeDb och varje fel efter den punkten återställer BÅDE DB och uploads — inget
// lämnas halvbytt. pre-restore-artefakterna raderas inte här: de städas först av
// cleanupPreRestoreArtifacts efter nästa lyckade uppstart (migrationer + schemakontroll).
export async function performRestoreSwap(opts: {
  restoredDbPath: string;
  dbPath: string;
  uploadsSrc: string;
  uploadsDest: string;
  // WAL-säker snapshot av live-DB:n (db.backup). copyFileSync av en WAL-DB missar
  // allt som ännu bara finns i -wal och kan ge en inkonsistent kopia.
  snapshotDb: (destPath: string) => Promise<unknown>;
  // Körs efter pre-restore-kopian men före filbytet. Route-handlern skickar
  // WAL-checkpoint + closeDatabase här; testerna kan utelämna eller kasta.
  closeDb?: () => void;
}): Promise<void> {
  const { restoredDbPath, dbPath, uploadsSrc, uploadsDest, snapshotDb, closeDb } = opts;

  const dbBackup = `${dbPath}.pre-restore`;
  const uploadsBackup = `${uploadsDest}.pre-restore`;
  const walFile = `${dbPath}-wal`;
  const shmFile = `${dbPath}-shm`;

  // Rester av en tidigare restore ska inte blandas ihop med den nya rollback-kopian.
  rmSync(dbBackup, { force: true });
  rmSync(uploadsBackup, { recursive: true, force: true });
  await snapshotDb(dbBackup);

  let uploadsMovedAside = false;
  try {
    closeDb?.();

    copyFileSync(restoredDbPath, dbPath);
    if (existsSync(walFile)) unlinkSync(walFile);
    if (existsSync(shmFile)) unlinkSync(shmFile);

    if (existsSync(uploadsSrc)) {
      // Fynd 4: uploads-katalogen ska exakt spegla backupen. Den gamla flyttas undan
      // (inte raderas) så att den kan återställas om kopieringen faller halvvägs.
      if (existsSync(uploadsDest)) {
        renameSync(uploadsDest, uploadsBackup);
        uploadsMovedAside = true;
      }
      mkdirSync(uploadsDest, { recursive: true });
      cpSync(uploadsSrc, uploadsDest, { recursive: true });
    }
  } catch (restoreError) {
    copyFileSync(dbBackup, dbPath);
    // Sidofiler från den nya DB:n får inte följa med den gamla filen.
    rmSync(walFile, { force: true });
    rmSync(shmFile, { force: true });
    if (uploadsMovedAside) {
      rmSync(uploadsDest, { recursive: true, force: true });
      renameSync(uploadsBackup, uploadsDest);
    }
    throw restoreError;
  }
}

// Raderar uploads.pre-restore när servern har startat OK på den återställda datan
// (anropas efter migrationer + schemakontroll). Bara artefakter som är äldre än
// aktuell uppstart tas bort. DB-kopian (database.sqlite.pre-restore) behålls medvetet
// som sista skyddsnät tills nästa restore skriver över den.
export function cleanupPreRestoreArtifacts(bootedAtMs: number, uploadsDir: string = UPLOAD_DIR): void {
  const uploadsBackup = `${uploadsDir}.pre-restore`;
  try {
    if (existsSync(uploadsBackup) && statSync(uploadsBackup).mtimeMs < bootedAtMs) {
      rmSync(uploadsBackup, { recursive: true, force: true });
      logger.info('Raderade uploads.pre-restore efter lyckad uppstart', { path: uploadsBackup });
    }
  } catch (err) {
    logger.warn('Kunde inte städa uploads.pre-restore (non-fatal)', { path: uploadsBackup, error: String(err) });
  }
}

// Fynd F1: audit-raden för 'backup_restore' fick tidigare aldrig persisteras.
// Den skrevs EFTER performRestoreSwap, men swappens closeDb-callback (ovan)
// hinner köra closeDatabase() innan filbytet — så den delade `db`-anslutningen
// är redan stängd när logAudit skulle kört sin INSERT (kastar tyst i sitt eget
// catch-block, fire-and-forget). Även med ett öppet handtag hade raden hamnat
// fel: `db` pekar fortfarande mot filen som precis ersattes av den återställda
// backupen.
//
// Lösning: öppna en egen, kortlivad anslutning direkt mot dbPath (= filen som
// performRestoreSwap just skrev den återställda backupen till) och skriv raden
// där, sedan stäng anslutningen igen. Detta är EN separat anslutning fristående
// från den delade `db`-singleton i db/connection.ts — helt avsiktligt, eftersom
// hela poängen är att skriva i den NYA filen efter att den gamla anslutningen
// stängts.
//
// Fallback: om den återställda backupen är äldre än migration 066 saknar
// audit_log kolumnen api_key_id (migrationskedjan körs först vid nästa
// serverstart, inte här) — testa med PRAGMA table_info och skriv utan kolumnen
// i så fall, så att raden inte går förlorad helt i det fallet heller.
//
// Får aldrig kasta (precis som logAudit): en misslyckad audit-skrivning är
// non-fatal och ska bara loggas, aldrig fälla en i övrigt lyckad restore.
export async function logRestoreAudit(
  dbPath: string,
  userId: string | null,
  ipAddress: string | string[] | undefined,
  apiKeyId: string | null,
): Promise<void> {
  const resolvedIp = Array.isArray(ipAddress) ? ipAddress[0] : ipAddress;
  let conn: DatabaseType | undefined;
  try {
    const Database = (await import('better-sqlite3')).default;
    conn = new Database(dbPath);
    conn.pragma('foreign_keys = ON');
    conn.pragma('busy_timeout = 5000');
    const columns = conn.prepare('PRAGMA table_info(audit_log)').all() as { name: string }[];
    const hasApiKeyId = columns.some((c) => c.name === 'api_key_id');
    if (hasApiKeyId) {
      conn.prepare(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details, ip_address, api_key_id, created_at)
         VALUES (?, ?, 'backup_restore', 'backup', NULL, NULL, ?, ?, ?)`
      ).run(randomUUID(), userId, resolvedIp ?? null, apiKeyId ?? null, new Date().toISOString());
    } else {
      // Pre-066-backup: kolumnen finns inte än (kommer efter nästa migrering) —
      // skriv raden utan den i stället för att tappa den helt.
      conn.prepare(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details, ip_address, created_at)
         VALUES (?, ?, 'backup_restore', 'backup', NULL, NULL, ?, ?)`
      ).run(randomUUID(), userId, resolvedIp ?? null, new Date().toISOString());
    }
  } catch (err) {
    logger.error('Kunde inte skriva backup_restore-audit-raden i den återställda databasen (non-fatal)', { error: String(err) });
  } finally {
    try { conn?.close(); } catch { /* ignore */ }
  }
}

// FTS5-indexen är contentless och ligger i databasfilen, men en backup kan vara tagen
// med inaktuella eller saknade index. Bygg om dem i den återställda filen innan
// omstarten så sökningen inte ger tomma/föråldrade träffar. Får aldrig kasta: en
// backup äldre än FTS-migrationerna saknar tabellerna, och bootens migrationer
// bygger dem då själva.
export async function rebuildRestoredFts(dbPath: string): Promise<void> {
  let conn: DatabaseType | undefined;
  try {
    const Database = (await import('better-sqlite3')).default;
    conn = new Database(dbPath);
    conn.pragma('foreign_keys = ON');
    conn.pragma('busy_timeout = 5000');
    const counts = rebuildFts(conn);
    logger.info('FTS-index ombyggda efter restore', counts);
  } catch (err) {
    logger.warn('Kunde inte bygga om FTS-index efter restore (non-fatal)', { error: String(err) });
  } finally {
    try { conn?.close(); } catch { /* ignore */ }
  }
}

const router = Router();

router.get('/', authenticate, requireAdmin, backupDownloadLimiter, async (req: AuthRequest, res: Response) => {
  // Temp-dumpen ligger i backup-katalogen (samma volym som övriga backuper, 0o700),
  // inte i världsläsbara /tmp. Prefixet tmp- gör att retention och fillistan ignorerar den.
  const backupDir = getBackupDir();
  const tmpFile = join(backupDir, `tmp-download-${randomUUID()}.sqlite`);

  try {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    await db.backup(tmpFile);

    // Backup-dumpen innehåller hela databasen (inkl. hemligheter) → minsta-rättighet 0o600.
    try {
      chmodSync(tmpFile, 0o600);
    } catch (chmodErr) {
      logger.warn('Kunde inte sätta läsrättigheter (0o600) på temporär backup-fil', { path: tmpFile, error: String(chmodErr) });
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `it-ticket-backup-${dateStr}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Fynd F2: logga FÖRE strömningen börjar, inte efter finalize(). database.sqlite
    // läggs i arkivet och strömmas till klienten redan under finalize — en klient
    // som avbryter anslutningen sent kan i praktiken ha fått hela databasen utan
    // att en audit-rad skrivits, om loggningen väntar på att strömmen ska bli klar.
    // Logga alltså avsikten så snart requireAdmin + rate-limitern har passerats,
    // oavsett om klienten sedan fullföljer nedladdningen eller avbryter den.
    logAudit(req.user!.id, 'backup_download', 'backup', null, null, req.ip, req.apiKey?.id ?? null);

    const archive = new ZipArchive({ zlib: { level: 6 } });

    archive.pipe(res);

    archive.file(tmpFile, { name: 'data/database.sqlite' });

    if (existsSync(UPLOAD_DIR)) {
      archive.directory(UPLOAD_DIR, 'data/uploads');
    }

    // Fynd 5: Rensa tmpfil även vid 'close' (avbruten anslutning) och 'error'.
    const cleanupTmpFile = () => {
      try { unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
    };
    res.on('finish', cleanupTmpFile);
    res.on('close', cleanupTmpFile);
    res.on('error', cleanupTmpFile);

    archive.on('error', () => {
      try { unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
      if (!res.headersSent) {
        res.status(500).json({ error: 'Backup failed' });
      }
    });

    await archive.finalize();
  } catch (err) {
    try { unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
    if (!res.headersSent) {
      res.status(500).json({ error: 'Backup failed' });
    }
  }
});

// Lagrade backuper på servern (backup-katalogen) — så en admin kan hämta en
// tidigare automatisk backup utan SSH/Portainer-åtkomst.
router.get('/files', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  const backupDir = getBackupDir();
  if (!existsSync(backupDir)) {
    return res.json([]);
  }
  const files = readdirSync(backupDir)
    .filter((name) => BACKUP_ZIP_NAME_RE.test(name))
    .map((name) => {
      const stat = statSync(join(backupDir, name));
      return { name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
  return res.json(files);
});

router.get('/files/:name', authenticate, requireAdmin, backupDownloadLimiter, (req: AuthRequest, res: Response) => {
  const name = String(req.params.name);
  if (!BACKUP_ZIP_NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Ogiltigt backup-filnamn' });
  }
  const backupDir = resolve(getBackupDir());
  const filePath = resolve(backupDir, name);
  if (!filePath.startsWith(backupDir + sep) || !existsSync(filePath)) {
    return res.status(404).json({ error: 'Backupen hittades inte' });
  }

  logAudit(req.user!.id, 'backup_download', 'backup', null, name, req.ip, req.apiKey?.id ?? null);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
});

router.post('/restore', authenticate, requireAdmin, restoreLimiter, restoreUpload, async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ingen fil skickades. Ladda upp en backup-ZIP.' });
  }

  // Fynd 3: req.file.path används (diskStorage) — ingen buffer i minnet.
  const uploadedZip = req.file.path;

  // Uppladdad backup-ZIP innehåller hela databasen (inkl. hemligheter) → minsta-rättighet 0o600.
  try {
    chmodSync(uploadedZip, 0o600);
  } catch (chmodErr) {
    logger.warn('Kunde inte sätta läsrättigheter (0o600) på uppladdad backup-fil', { path: uploadedZip, error: String(chmodErr) });
  }

  const tmpDir = join(tmpdir(), `restore-${randomUUID()}`);
  const extractDir = join(tmpDir, 'extracted');

  // Normalisera extractDir med avslutande separator för zip-slip-kontroll
  const extractDirNorm = resolve(extractDir) + '/';

  // Spåra om vi hunnit stänga DB-handtaget. Om något fel inträffar EFTER
  // closeDatabase() är det delade `db`-handtaget permanent stängt → varje
  // efterföljande request kastar "database connection is not open". Då måste
  // vi tvinga omstart (Docker restart: unless-stopped) i stället för att lämna
  // servern brickad — rollbacken nedan har redan återställt pre-restore-DB:n.
  let dbClosed = false;

  // Fynd backup-audit-2: Markera valideringsfel så att den yttre catchen kan svara 400
  // (ogiltig uppladdning) i stället för 500 (serverfel).
  const validationError = (msg: string): Error => {
    const e = new Error(msg) as Error & { isValidationError?: boolean };
    e.isValidationError = true;
    return e;
  };

  try {
    mkdirSync(extractDir, { recursive: true });

    // Extraherad backup innehåller hela databasen (inkl. hemligheter) → minsta-rättighet 0o700 på katalogen.
    try {
      chmodSync(tmpDir, 0o700);
    } catch (chmodErr) {
      logger.warn('Kunde inte sätta läsrättigheter (0o700) på temporär restore-katalog', { path: tmpDir, error: String(chmodErr) });
    }

    // Fynd 2: Zip-slip-skydd — validera varje entry innan extraktion.
    // Fynd unzipper-pipe-close-race: Samla finish-löften per entry och awaita
    // Promise.all innan vi resolvear, så att copyFileSync inte racear mot
    // ännu-skrivande WriteStreams (Parse 'close' kommer före sista 'finish').
    await new Promise<void>((resolveP, rejectP) => {
      const writeFinishPromises: Promise<void>[] = [];
      let rejected = false;
      let entryCount = 0;
      let extractedBytes = 0;
      const source = createReadStream(uploadedZip);

      const reject = (err: Error) => {
        if (!rejected) {
          rejected = true;
          source.destroy();
          rejectP(err);
        }
      };

      source
        .pipe(unzipper.Parse())
        .on('entry', (entry: unzipper.Entry) => {
          if (rejected) {
            entry.autodrain();
            return;
          }
          if (++entryCount > restoreLimits.maxEntries) {
            entry.autodrain();
            reject(validationError(`För många poster i backup-ZIP (max ${restoreLimits.maxEntries})`));
            return;
          }
          // Fynd backup-audit-2: Validera varje entry innan extraktion.
          // (a) Zip-slip / path-traversal: normaliserad sökväg måste ligga under extractDir
          //     och får inte vara absolut eller innehålla '..'-segment.
          const rawPath = entry.path;
          const normalizedRel = rawPath.replace(/\\/g, '/');
          const isAbsolute = normalizedRel.startsWith('/');
          const hasDotDot = normalizedRel.split('/').includes('..');
          const entryPath = resolve(extractDir, entry.path);
          if (isAbsolute || hasDotDot || !entryPath.startsWith(extractDirNorm)) {
            // Skadlig entry — avbryt och städa
            entry.autodrain();
            reject(validationError(`Zip-slip-försök detekterat: ${entry.path}`));
            return;
          }
          // (b) Allowlist: backupen skapas med exakt 'data/database.sqlite' och 'data/uploads/*'
          //     (se GET '/' och backupScheduler runBackup). Avvisa allt annat.
          const relForCheck = normalizedRel.replace(/\/+$/, ''); // ta bort ev. avslutande '/'
          const isAllowed =
            relForCheck === 'data' ||
            relForCheck === 'data/database.sqlite' ||
            relForCheck === 'data/uploads' ||
            relForCheck.startsWith('data/uploads/');
          if (!isAllowed) {
            entry.autodrain();
            reject(validationError(`Oväntad entry i backup-ZIP: ${entry.path}`));
            return;
          }
          // Säker entry — extrahera till korrekt sökväg
          const entryDir = dirname(entryPath);
          mkdirSync(entryDir, { recursive: true });
          if (entry.type === 'Directory') {
            mkdirSync(entryPath, { recursive: true });
            entry.autodrain();
          } else {
            const ws = createWriteStream(entryPath);
            // Spåra varje streams finish-händelse så att 'close' på Parse
            // inte resolvear innan alla filer har skrivits klart till disk.
            const finishP = new Promise<void>((res, rej) => {
              ws.on('finish', res);
              ws.on('error', rej);
            });
            writeFinishPromises.push(finishP);
            // Löpande räkning av faktiskt extraherade bytes (ZIP-headerns storleksfält går att förfalska).
            entry.on('data', (chunk: Buffer) => {
              extractedBytes += chunk.length;
              if (extractedBytes > restoreLimits.maxExtractedBytes) {
                reject(validationError('Backup-ZIP expanderar till mer än 2 GB'));
                entry.unpipe(ws);
                ws.destroy();
              }
            });
            entry.pipe(ws).on('error', reject);
          }
        })
        .on('close', () => {
          // Vänta tills alla WriteStreams har skrivit klart innan vi fortsätter.
          Promise.all(writeFinishPromises).then(() => resolveP(), reject);
        })
        .on('error', reject);
    });

    const restoredDb = join(extractDir, 'data', 'database.sqlite');
    if (!existsSync(restoredDb)) {
      try { unlinkSync(uploadedZip); } catch { /* ignore */ }
      return res.status(400).json({ error: 'Ogiltig backup: data/database.sqlite saknas i ZIP-filen.' });
    }

    // Fynd backup-audit-2: Verifiera SQLite-magic-header ("SQLite format 3\0", 16 bytes)
    // innan vi ens öppnar den med better-sqlite3 och sedan ersätter live-DB:n.
    {
      const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1'); // 16 bytes
      const header = Buffer.alloc(16);
      const fd = openSync(restoredDb, 'r');
      let bytesRead = 0;
      try {
        bytesRead = readSync(fd, header, 0, 16, 0);
      } finally {
        closeSync(fd);
      }
      if (bytesRead < 16 || !header.equals(SQLITE_MAGIC)) {
        try { unlinkSync(uploadedZip); } catch { /* ignore */ }
        return res.status(400).json({ error: 'Ogiltig backup: data/database.sqlite är inte en giltig SQLite-databas.' });
      }
    }

    const Database = (await import('better-sqlite3')).default;
    const testDb = new Database(restoredDb, { readonly: true });
    try {
      // quick_check fångar trasiga sidor/index som magic-header och tabellkontrollen missar —
      // en korrupt DB ska avvisas INNAN live-databasen byts ut.
      let quickCheckOk = false;
      try {
        const quickCheck = testDb.pragma('quick_check') as Array<{ quick_check: string }>;
        quickCheckOk = quickCheck.length === 1 && quickCheck[0].quick_check === 'ok';
      } catch {
        // SQLite kastar SQLITE_CORRUPT på vissa skador i stället för att returnera felrader.
      }
      if (!quickCheckOk) {
        try { unlinkSync(uploadedZip); } catch { /* ignore */ }
        return res.status(400).json({ error: 'Ogiltig backup: databasen klarade inte integritetskontrollen.' });
      }
      const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = new Set(tables.map(t => t.name));
      if (!tableNames.has('tickets') || !tableNames.has('users')) {
        try { unlinkSync(uploadedZip); } catch { /* ignore */ }
        return res.status(400).json({ error: 'Ogiltig backup: databasen saknar nödvändiga tabeller (tickets, users).' });
      }
    } finally {
      testDb.close();
    }

    // Fynd M14: hela swap-sekvensen (pre-restore-kopia → checkpoint/close → filbyte →
    // sidofiler → uploads, med rollback) ligger i performRestoreSwap så den är testbar.
    await performRestoreSwap({
      restoredDbPath: restoredDb,
      dbPath: DB_PATH,
      uploadsSrc: join(extractDir, 'data', 'uploads'),
      uploadsDest: UPLOAD_DIR,
      snapshotDb: (destPath) => db.backup(destPath),
      closeDb: () => {
        // Fynd backup-audit-1: RESTART (inte TRUNCATE) väntar in pågående läsare/skrivare
        // innan checkpointen slutförs. Det undviker att vi skriver över DB-filen mitt i en
        // annan transaktions partiella skrivning → korruption under restore.
        db.pragma('wal_checkpoint(RESTART)');

        // Stäng databashandtaget innan vi skriver över filen — process.exit(0)
        // nedan startar om processen med ett nytt handtag mot den återställda DB:n.
        closeDatabase();
        dbClosed = true;
      },
    });

    rmSync(tmpDir, { recursive: true, force: true });
    try { unlinkSync(uploadedZip); } catch { /* ignore */ }

    // Fynd F1: skriv audit-raden i den ÅTERSTÄLLDA databasen (DB_PATH pekar nu
    // mot den, eftersom performRestoreSwap redan bytt filen och den delade
    // `db`-anslutningen redan stängts av closeDb-callbacken ovan). logAudit
    // (som skriver mot den delade anslutningen) fungerar inte här — den är
    // stängd och skulle ändå träffat fel fil. Se logRestoreAudit ovan.
    await logRestoreAudit(DB_PATH, req.user!.id, req.ip, req.apiKey?.id ?? null);
    await rebuildRestoredFts(DB_PATH);

    // Fynd 1: Skicka svar och schemalägg process.exit(0) så Docker (restart: unless-stopped)
    // startar om containern med den nya DB:n i ett rent tillstånd.
    res.json({
      success: true,
      message: 'Backup återställd. Servern startas om automatiskt för att aktivera den återställda databasen.',
      restartRequired: true,
    });

    setTimeout(() => {
      logger.info('Restore klar — initierar omstart av process för att ladda ny DB.');
      process.exit(0);
    }, 1500);

  } catch (error) {
    rmSync(tmpDir, { recursive: true, force: true });
    try { unlinkSync(uploadedZip); } catch { /* ignore */ }

    // Fynd backup-audit-2: Valideringsfel (zip-slip, oväntad entry) är klientfel → 400.
    // Dessa kastas innan DB-handtaget stängts, så ingen omstart behövs.
    if ((error as { isValidationError?: boolean })?.isValidationError) {
      logger.warn('Restore avvisad: ogiltig backup-ZIP', { error: String(error) });
      return res.status(400).json({ error: 'Ogiltig backup-ZIP: filen innehåller oväntade, osäkra eller för många/stora poster.' });
    }

    logger.error('Restore failed:', { error: String(error) });
    res.status(500).json({ error: 'Återställning misslyckades. Kontrollera att ZIP-filen är en giltig backup.' });

    // Om felet inträffade efter att DB-handtaget stängts är processen oanvändbar
    // (inläsningar mot stängt handtag). Rollbacken har återställt pre-restore-DB:n,
    // så starta om så Docker reser servern med ett rent handtag i stället för att
    // lämna den brickad tills någon SSH:ar in.
    if (dbClosed) {
      logger.error('Restore failed efter closeDatabase() — tvingar omstart för att återställa DB-handtaget.');
      setTimeout(() => process.exit(1), 1500);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Backup-schema (config) — paus/tid/retention + manuell "kör nu".
// Källa till sanning: backup_config-raden (migration 061). Alla admin-only.
// ─────────────────────────────────────────────────────────────────────────────

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Nästa körning härleds ur tid + enabled (lokaltid). null om pausad.
// Fynd backup-audit-3: garantera att returvärdet alltid ligger STRIKT i framtiden.
// setHours arbetar i lokaltid; vid DST-övergångar (vår/höst) kan en dag vara 23/25h
// och en enkel "+1 dag" räcker inte alltid för att passera now. Vi loopar därför tills
// tiden är > now (max ett par iterationer) så att ingen körning schemaläggs i det
// förflutna eller dubbelt på samma UTC-dag.
function computeNextRunAt(cfg: BackupConfig): string | null {
  if (!cfg.enabled) return null;
  const [h, m] = cfg.time.split(':').map(Number);
  const next = new Date();
  next.setHours(h, m, 0, 0);
  while (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

// Fynd M13: räknarna (consecutiveFailures/lastError ur cfg, offsiteFailureCount) exponeras
// så admin-UI:t kan varna vid upprepade fel — tidigare syntes fel bara som en passiv ikon.
function configResponse(cfg: BackupConfig) {
  return {
    ...cfg,
    nextRunAt: computeNextRunAt(cfg),
    offsiteFailureCount: getOffsiteFailureCount(),
  };
}

router.get('/config', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  res.json(configResponse(getBackupConfig()));
});

router.put('/config', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { enabled, time, retentionDays } = (req.body ?? {}) as Partial<{ enabled: boolean; time: string; retentionDays: number }>;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled måste vara en boolean' });
  }
  if (typeof time !== 'string' || !TIME_RE.test(time)) {
    return res.status(400).json({ error: 'time måste vara HH:MM (00:00–23:59)' });
  }
  if (!Number.isInteger(retentionDays) || (retentionDays as number) < 1 || (retentionDays as number) > 3650) {
    return res.status(400).json({ error: 'retentionDays måste vara ett heltal mellan 1 och 3650' });
  }

  db.prepare('UPDATE backup_config SET enabled = ?, time = ?, retention_days = ?, updated_at = ? WHERE id = 1')
    .run(enabled ? 1 : 0, time, retentionDays, new Date().toISOString());

  // Slå igenom utan omstart: stoppa gammal task, schemalägg ny (eller ingen om pausad).
  reconfigureBackupScheduler();

  // Samma svar som GET — hooken ersätter cachen med PUT-svaret (setQueryData),
  // så räknarna måste med här också för att inte försvinna efter "Spara".
  return res.json(configResponse(getBackupConfig()));
});

router.post('/run-now', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  if (isBackupRunning()) {
    return res.status(409).json({ error: 'En backup pågår redan' });
  }
  const result = await runBackup();
  if (result.status === 'failed') {
    return res.status(500).json({ status: 'failed', error: 'Backup misslyckades' });
  }
  const cfg = getBackupConfig();

  // Manuell backup-körning lyckades — logga efter genomförd körning.
  logAudit(req.user!.id, 'backup_run_now', 'backup', null, null, req.ip, req.apiKey?.id ?? null);

  return res.json({ status: result.status, lastRunAt: cfg.lastRunAt, lastSizeBytes: cfg.lastSizeBytes });
});

export default router;
