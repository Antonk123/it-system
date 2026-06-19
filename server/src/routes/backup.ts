import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { db, closeDatabase } from '../db/connection.js';
import archiver from 'archiver';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync, mkdirSync, createReadStream, createWriteStream, copyFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import multer from 'multer';
import unzipper from 'unzipper';
import { logger } from '../lib/logger.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/database.sqlite');
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

// Fynd 3: Använd diskStorage för restore-uppladdning för att undvika OOM vid stora ZIP:ar.
// Filen sparas till OS:ets tmp-katalog och refereras sedan via req.file.path.
const restoreTmpDir = tmpdir();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, restoreTmpDir),
    filename: (_req, _file, cb) => cb(null, `restore-upload-${randomUUID()}.zip`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'));
    }
  },
});

// Fynd 6: Rate limit för backup-download (max 10 nedladdningar per 15 min per IP).
const backupDownloadLimiter = createRateLimiter(15 * 60 * 1000, 10);

// Fynd restore-missing-rate-limit: Rate limit för restore (max 5 försök per 15 min per IP).
const restoreLimiter = createRateLimiter(15 * 60 * 1000, 5);

const router = Router();

router.get('/', authenticate, requireAdmin, backupDownloadLimiter, async (req: AuthRequest, res: Response) => {
  const tmpFile = join(tmpdir(), `backup-${randomUUID()}.sqlite`);

  try {
    await db.backup(tmpFile);

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `it-ticket-backup-${dateStr}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });

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

    archive.on('error', (err) => {
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

router.post('/restore', authenticate, requireAdmin, restoreLimiter, upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ingen fil skickades. Ladda upp en backup-ZIP.' });
  }

  // Fynd 3: req.file.path används (diskStorage) — ingen buffer i minnet.
  const uploadedZip = req.file.path;
  const tmpDir = join(tmpdir(), `restore-${randomUUID()}`);
  const extractDir = join(tmpDir, 'extracted');

  // Normalisera extractDir med avslutande separator för zip-slip-kontroll
  const extractDirNorm = resolve(extractDir) + '/';

  try {
    mkdirSync(extractDir, { recursive: true });

    // Fynd 2: Zip-slip-skydd — validera varje entry innan extraktion.
    // Fynd unzipper-pipe-close-race: Samla finish-löften per entry och awaita
    // Promise.all innan vi resolvear, så att copyFileSync inte racear mot
    // ännu-skrivande WriteStreams (Parse 'close' kommer före sista 'finish').
    await new Promise<void>((resolveP, rejectP) => {
      const writeFinishPromises: Promise<void>[] = [];
      let rejected = false;

      const reject = (err: Error) => {
        if (!rejected) {
          rejected = true;
          rejectP(err);
        }
      };

      createReadStream(uploadedZip)
        .pipe(unzipper.Parse())
        .on('entry', (entry: unzipper.Entry) => {
          const entryPath = resolve(extractDir, entry.path);
          if (!entryPath.startsWith(extractDirNorm)) {
            // Skadlig entry — avbryt och städa
            entry.autodrain();
            reject(new Error(`Zip-slip-försök detekterat: ${entry.path}`));
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

    const Database = (await import('better-sqlite3')).default;
    const testDb = new Database(restoredDb, { readonly: true });
    try {
      const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = new Set(tables.map(t => t.name));
      if (!tableNames.has('tickets') || !tableNames.has('users')) {
        try { unlinkSync(uploadedZip); } catch { /* ignore */ }
        return res.status(400).json({ error: 'Ogiltig backup: databasen saknar nödvändiga tabeller (tickets, users).' });
      }
    } finally {
      testDb.close();
    }

    const dbBackup = `${DB_PATH}.pre-restore`;
    copyFileSync(DB_PATH, dbBackup);

    try {
      const walFile = `${DB_PATH}-wal`;
      const shmFile = `${DB_PATH}-shm`;

      db.pragma('wal_checkpoint(TRUNCATE)');

      // Stäng databashandtaget innan vi skriver över filen — process.exit(0)
      // nedan startar om processen med ett nytt handtag mot den återställda DB:n.
      closeDatabase();

      copyFileSync(restoredDb, DB_PATH);
      if (existsSync(walFile)) unlinkSync(walFile);
      if (existsSync(shmFile)) unlinkSync(shmFile);

      const restoredUploads = join(extractDir, 'data', 'uploads');
      if (existsSync(restoredUploads)) {
        // Fynd 4: Rensa UPLOAD_DIR innan återställning så att det exakt speglar backupen.
        rmSync(UPLOAD_DIR, { recursive: true, force: true });
        mkdirSync(UPLOAD_DIR, { recursive: true });
        const { cpSync } = await import('fs');
        cpSync(restoredUploads, UPLOAD_DIR, { recursive: true });
      }
    } catch (restoreError) {
      copyFileSync(dbBackup, DB_PATH);
      throw restoreError;
    }

    rmSync(tmpDir, { recursive: true, force: true });
    try { unlinkSync(uploadedZip); } catch { /* ignore */ }

    // Fynd pre-restore-backup-not-cleaned-up: Ta bort rollback-filen efter lyckad
    // återställning så att den inte ligger kvar och tar diskutrymme i onödan.
    try { unlinkSync(dbBackup); } catch { /* ignore — filen kanske redan är borta */ }

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
    logger.error('Restore failed:', { error: String(error) });
    rmSync(tmpDir, { recursive: true, force: true });
    try { unlinkSync(uploadedZip); } catch { /* ignore */ }
    res.status(500).json({ error: 'Återställning misslyckades. Kontrollera att ZIP-filen är en giltig backup.' });
  }
});

export default router;
