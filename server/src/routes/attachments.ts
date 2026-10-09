import { Router, Response } from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync, openSync, readSync, closeSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { writeRateLimiter } from '../middleware/rateLimit.js';
import { canAccessTicket } from '../lib/ticketAccess.js';
import { logger } from '../lib/logger.js';
import { attachmentDisposition } from '../lib/contentDisposition.js';
import { resolveUploadPath } from '../lib/uploadPath.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

// Ensure upload directory exists
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** Max accepted file size (bytes) — same limit enforced by multer */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Max number of attachments allowed per ticket */
const MAX_ATTACHMENTS_PER_TICKET = 50;

// Whitelist of allowed MIME types.
// SVG är medvetet BORTTAGET: en SVG kan bära <script>/onload och exekveras i appens
// origin om den någon gång renderas inline (även av misstag via en framtida ändring).
// Bilagor serveras visserligen alltid som attachment, men aktiva format hör inte
// hemma i en allowlist för ärendebilagor. Tidigare uppladdade SVG:er serveras fortsatt
// som nedladdning.
export const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'message/rfc822', // .eml
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/zip', 'application/x-zip-compressed',
  'application/x-rar-compressed', 'application/x-7z-compressed',
];

// Whitelist of allowed file extensions (as backup check)
export const ALLOWED_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  'pdf',
  'txt', 'csv', 'md', 'markdown', 'eml',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'rar', '7z',
];

// Markdown-ändelser vars MIME-typ webbläsare rapporterar inkonsekvent:
// text/markdown på macOS men ofta application/octet-stream (eller tom sträng)
// på Windows/Linux. För dessa normaliserar vi till text/markdown utifrån den
// betrodda ändelsen (se fileFilter nedan).
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
    cb(null, `${Date.now()}-${randomUUID()}.${ext}`);
  },
});

const upload = multer({
  storage,
  // Multipart-filnamn är UTF-8 i moderna webbläsare; standardvärdet latin1 förvanskar åäö.
  defParamCharset: 'utf8',
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';

    // Normalisera flakiga Markdown-MIME-typer till text/markdown så att
    // allowlist-kontrollen nyckas på den betrodda ändelsen i stället för
    // webbläsarens gissning. Säkert: bilagor serveras alltid som
    // Content-Disposition: attachment (aldrig inline) och text saknar
    // magic-byte-signatur (hasMagicByteMatch släpper igenom). Mutationen på
    // file.mimetype persisteras till req.file → korrekt lagrad/serverad typ.
    if (
      MARKDOWN_EXTENSIONS.has(ext) &&
      (file.mimetype === '' ||
        file.mimetype === 'application/octet-stream' ||
        file.mimetype === 'text/x-markdown')
    ) {
      file.mimetype = 'text/markdown';
    }

    // Check both MIME type and extension
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error(`File type ${file.mimetype} is not allowed. Allowed types: images, PDFs, Office documents, Markdown, archives.`));
    }

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error(`File extension .${ext} is not allowed.`));
    }

    cb(null, true);
  },
});

const router = Router();

interface AttachmentRow {
  id: string;
  ticket_id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  file_type: string | null;
  created_at: string;
}

/**
 * Lättvikts magic-byte-kontroll: läser de första bytena ur en redan sparad fil
 * och verifierar att de matchar den deklarerade MIME-typen.
 * Returnerar false (avvisa) endast om MIME är känd men signaturen inte matchar.
 * Okända/textbaserade MIME-typer släpps igenom utan kontroll.
 */
export function hasMagicByteMatch(filePath: string, declaredMime: string): boolean {
  // Signaturer för kända binära typer; varje signatur är en lista av (offset, bytes)
  // som alla måste matcha (WebP kräver både RIFF vid 0 och WEBP vid 8).
  const OLE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0]);
  const signatures: Array<{ mime: string | string[]; parts: Array<{ bytes: Buffer; offset: number }> }> = [
    { mime: 'application/pdf',  parts: [{ offset: 0, bytes: Buffer.from([0x25, 0x50, 0x44, 0x46]) }] }, // %PDF
    { mime: 'image/png',        parts: [{ offset: 0, bytes: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) }] }, // \x89PNG
    { mime: 'image/jpeg',       parts: [{ offset: 0, bytes: Buffer.from([0xFF, 0xD8, 0xFF]) }] },
    { mime: 'image/gif',        parts: [{ offset: 0, bytes: Buffer.from([0x47, 0x49, 0x46, 0x38]) }] }, // GIF8
    { mime: 'image/webp',       parts: [{ offset: 0, bytes: Buffer.from('RIFF') }, { offset: 8, bytes: Buffer.from('WEBP') }] },
    // Äldre Office-format (OLE2/CFB-container)
    { mime: ['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'],
      parts: [{ offset: 0, bytes: OLE }] },
    { mime: 'application/x-rar-compressed', parts: [{ offset: 0, bytes: Buffer.from('Rar!') }] },
    { mime: 'application/x-7z-compressed',  parts: [{ offset: 0, bytes: Buffer.from([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) }] }, // 7z\xBC\xAF'\x1C
    { mime: ['application/zip', 'application/x-zip-compressed',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
      parts: [{ offset: 0, bytes: Buffer.from([0x50, 0x4B, 0x03, 0x04]) }] }, // PK\x03\x04
  ];

  const matchingRule = signatures.find(s =>
    Array.isArray(s.mime) ? s.mime.includes(declaredMime) : s.mime === declaredMime
  );

  if (!matchingRule) {
    // Ingen känd signatur för denna MIME — släpp igenom
    return true;
  }

  // Läs bara de första bytena — öppna fd och läs exakt vad vi behöver
  const readLen = Math.max(...matchingRule.parts.map(p => p.offset + p.bytes.length), 16);
  const header = Buffer.alloc(readLen);
  try {
    const fd = openSync(filePath, 'r');
    try {
      readSync(fd, header, 0, readLen, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }

  return matchingRule.parts.every(({ bytes, offset }) => header.subarray(offset, offset + bytes.length).equals(bytes));
}

// Get attachments for a ticket
router.get('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const attachments = db.prepare(`
      SELECT id, ticket_id, file_name, file_path, file_size, file_type, created_at FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC
    `).all(req.params.ticketId) as AttachmentRow[];

    // Add URL for each attachment (authentication via Authorization header)
    const withUrls = attachments.map(a => ({
      ...a,
      url: `/api/attachments/file/${a.id}`,
    }));

    res.json(withUrls);
  } catch (error) {
    logger.error('Error fetching attachments:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

// Upload attachment with error handling
router.post('/ticket/:ticketId', writeRateLimiter, authenticate, (req: AuthRequest, res: Response) => {
  // Wrap upload.single to catch multer errors
  upload.single('file')(req, res, (err) => {
    if (err) {
      // Multer error (file validation failed)
      logger.error('File upload validation error:', err.message);
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Filen är redan skriven till disk av multer — varje tidig retur nedan måste ta bort den.
    const uploadedPath = join(UPLOAD_DIR, req.file.filename);
    const discardUpload = () => {
      try { unlinkSync(uploadedPath); } catch { /* ignore cleanup error */ }
    };

    // Magic-byte-kontroll: verifiera att filens faktiska innehåll matchar deklarerad MIME
    if (!hasMagicByteMatch(uploadedPath, req.file.mimetype)) {
      discardUpload();
      logger.warn('Magic-byte mismatch for uploaded file', {
        filename: req.file.originalname,
        declaredMime: req.file.mimetype,
      });
      return res.status(400).json({ error: 'File content does not match the declared file type.' });
    }

    try {
      // Verify ticket exists
      const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.ticketId);
      if (!ticket) {
        discardUpload();
        return res.status(404).json({ error: 'Ticket not found' });
      }

      if (!canAccessTicket(req, req.params.ticketId as string, { write: true })) {
        discardUpload();
        return res.status(403).json({ error: 'Forbidden: you do not have access to this ticket' });
      }

      // Enforce per-ticket attachment cap to prevent unbounded growth.
      const { c: attachmentCount } = db.prepare(
        'SELECT COUNT(*) AS c FROM ticket_attachments WHERE ticket_id = ?'
      ).get(req.params.ticketId) as { c: number };
      if (attachmentCount >= MAX_ATTACHMENTS_PER_TICKET) {
        discardUpload();
        return res.status(400).json({ error: 'Maximum attachments reached' });
      }

      const id = randomUUID();
      db.prepare(`
        INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path, file_size, file_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        req.params.ticketId,
        req.file.originalname,
        req.file.filename,
        req.file.size,
        req.file.mimetype,
        new Date().toISOString()
      );

      const attachment = db.prepare('SELECT id, ticket_id, file_name, file_path, file_size, file_type, created_at FROM ticket_attachments WHERE id = ?').get(id) as AttachmentRow;

      res.status(201).json({
        ...attachment,
        url: `/api/attachments/file/${attachment.id}`,
      });
    } catch (error) {
      discardUpload();
      logger.error('Error uploading attachment:', { error: String(error) });
      res.status(500).json({ error: 'Failed to upload attachment' });
    }
  });
});

// Serve file (authenticated)
router.get('/file/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const attachment = db.prepare('SELECT id, ticket_id, file_name, file_path, file_size, file_type, created_at FROM ticket_attachments WHERE id = ?').get(req.params.id) as AttachmentRow | undefined;
    
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // Läsning är öppen för alla inloggade. file_path ligger i DB:n, så kontrollera
    // att den löser sig innanför uppladdningskatalogen innan filen skickas.
    const filePath = resolveUploadPath(UPLOAD_DIR, attachment.file_path);

    if (!filePath || !existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', attachment.file_type || 'application/octet-stream');
    // SÄKERHETSINVARIANT: ALLA bilagor serveras med Content-Disposition: attachment
    // (aldrig 'inline'), ovillkorligt för varje filtyp. Det tvingar nedladdning i
    // stället för rendering i webbläsaren, så att en uppladdad fil aldrig kan köra
    // script i appens origin. Ändra ALDRIG detta till 'inline'.
    res.setHeader('Content-Disposition', attachmentDisposition(attachment.file_name));
    res.sendFile(filePath);
  } catch (error) {
    logger.error('Error serving file:', { error: String(error) });
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// Delete attachment
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const attachment = db.prepare('SELECT id, ticket_id, file_name, file_path, file_size, file_type, created_at FROM ticket_attachments WHERE id = ?').get(req.params.id) as AttachmentRow | undefined;

    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // Authorization: skrivbehörighet på det överordnade ärendet krävs
    if (!canAccessTicket(req, attachment.ticket_id, { write: true })) {
      return res.status(403).json({ error: 'Forbidden: you do not have access to this attachment' });
    }

    // IMPORTANT: Delete from database FIRST, then file
    // This prevents orphaned DB entries if file deletion fails
    // Orphaned files are acceptable, orphaned DB entries are not
    db.prepare('DELETE FROM ticket_attachments WHERE id = ?').run(req.params.id);

    // Delete file from disk after successful DB deletion
    const filePath = resolveUploadPath(UPLOAD_DIR, attachment.file_path);
    if (filePath && existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch (fileError) {
        // Log but don't fail the request - orphaned file is acceptable
        logger.warn('Failed to delete file from disk (orphaned file)', { filePath, error: String(fileError) });
      }
    }

    res.json({ message: 'Attachment deleted' });
  } catch (error) {
    logger.error('Error deleting attachment:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

export default router;
