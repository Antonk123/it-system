import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { db } from '../db/connection.js';
import archiver from 'archiver';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync, mkdirSync, createReadStream, copyFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import multer from 'multer';
import unzipper from 'unzipper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/database.sqlite');
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'));
    }
  },
});

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
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

    res.on('finish', () => {
      try { unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
    });

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

router.post('/restore', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ingen fil skickades. Ladda upp en backup-ZIP.' });
  }

  const tmpDir = join(tmpdir(), `restore-${randomUUID()}`);
  const tmpZip = join(tmpDir, 'backup.zip');
  const extractDir = join(tmpDir, 'extracted');

  try {
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(extractDir, { recursive: true });

    const { writeFileSync } = await import('fs');
    writeFileSync(tmpZip, req.file.buffer);

    await new Promise<void>((resolve, reject) => {
      createReadStream(tmpZip)
        .pipe(unzipper.Extract({ path: extractDir }))
        .on('close', resolve)
        .on('error', reject);
    });

    const restoredDb = join(extractDir, 'data', 'database.sqlite');
    if (!existsSync(restoredDb)) {
      return res.status(400).json({ error: 'Ogiltig backup: data/database.sqlite saknas i ZIP-filen.' });
    }

    const Database = (await import('better-sqlite3')).default;
    const testDb = new Database(restoredDb, { readonly: true });
    try {
      const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = new Set(tables.map(t => t.name));
      if (!tableNames.has('tickets') || !tableNames.has('users')) {
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

      copyFileSync(restoredDb, DB_PATH);
      if (existsSync(walFile)) unlinkSync(walFile);
      if (existsSync(shmFile)) unlinkSync(shmFile);

      const restoredUploads = join(extractDir, 'data', 'uploads');
      if (existsSync(restoredUploads)) {
        mkdirSync(UPLOAD_DIR, { recursive: true });
        const { cpSync } = await import('fs');
        cpSync(restoredUploads, UPLOAD_DIR, { recursive: true });
      }
    } catch (restoreError) {
      copyFileSync(dbBackup, DB_PATH);
      throw restoreError;
    }

    rmSync(tmpDir, { recursive: true, force: true });

    res.json({
      success: true,
      message: 'Backup återställd. Servern måste startas om för att ändringarna ska träda i kraft.',
      restartRequired: true,
    });
  } catch (error) {
    console.error('Restore failed:', error);
    rmSync(tmpDir, { recursive: true, force: true });
    res.status(500).json({ error: 'Återställning misslyckades. Kontrollera att ZIP-filen är en giltig backup.' });
  }
});

export default router;
