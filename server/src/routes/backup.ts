import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { db } from '../db/connection.js';
import archiver from 'archiver';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const tmpFile = join(tmpdir(), `backup-${randomUUID()}.sqlite`);

  try {
    // WAL-safe backup via better-sqlite3 .backup() — checkpoints WAL before copying
    await db.backup(tmpFile);

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `it-ticket-backup-${dateStr}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.pipe(res);

    // Add the SQLite snapshot at data/database.sqlite inside the ZIP
    archive.file(tmpFile, { name: 'data/database.sqlite' });

    // Add all uploaded files at data/uploads/ inside the ZIP
    if (existsSync(UPLOAD_DIR)) {
      archive.directory(UPLOAD_DIR, 'data/uploads');
    }

    // Clean up temp file after response finishes
    res.on('finish', () => {
      try { unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
    });

    // Handle archive errors
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

export default router;
