import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync, openSync, readSync, closeSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

// Ensure upload directory exists
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** Max accepted file size (bytes) — same limit enforced by multer */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Whitelist of allowed MIME types
export const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv',
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
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
  'pdf',
  'txt', 'csv', 'eml',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'rar', '7z',
];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(2)}`;
    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
    cb(null, `${uniqueSuffix}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';

    // Check both MIME type and extension
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error(`File type ${file.mimetype} is not allowed. Allowed types: images, PDFs, Office documents, archives.`));
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

interface TicketOwnerRow {
  requester_id: string | null;
  assigned_to: string | null;
}

/**
 * Lättvikts magic-byte-kontroll: läser de första bytena ur en redan sparad fil
 * och verifierar att de matchar den deklarerade MIME-typen.
 * Returnerar false (avvisa) endast om MIME är känd men signaturen inte matchar.
 * Okända/textbaserade MIME-typer släpps igenom utan kontroll.
 */
export function hasMagicByteMatch(filePath: string, declaredMime: string): boolean {
  // Signaturer för kända binära typer
  const signatures: Array<{ mime: string | string[]; magic: Buffer; offset?: number }> = [
    { mime: 'application/pdf',                                                    magic: Buffer.from([0x25, 0x50, 0x44, 0x46]) }, // %PDF
    { mime: 'image/png',                                                          magic: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) }, // \x89PNG
    { mime: 'image/jpeg',                                                         magic: Buffer.from([0xFF, 0xD8, 0xFF]) },
    { mime: 'image/gif',                                                          magic: Buffer.from([0x47, 0x49, 0x46, 0x38]) }, // GIF8
    { mime: ['application/zip', 'application/x-zip-compressed',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
             magic: Buffer.from([0x50, 0x4B, 0x03, 0x04]) }, // PK\x03\x04
  ];

  const matchingRule = signatures.find(s =>
    Array.isArray(s.mime) ? s.mime.includes(declaredMime) : s.mime === declaredMime
  );

  if (!matchingRule) {
    // Ingen känd signatur för denna MIME — släpp igenom
    return true;
  }

  // Läs bara de första bytena — öppna fd och läs exakt vad vi behöver
  const readLen = Math.max(matchingRule.magic.length + (matchingRule.offset ?? 0), 16);
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

  const offset = matchingRule.offset ?? 0;
  for (let i = 0; i < matchingRule.magic.length; i++) {
    if (header[offset + i] !== matchingRule.magic[i]) return false;
  }
  return true;
}

/** Check if user is admin, ticket requester, or assigned agent */
function canAccessTicketAttachment(user: { id: string; role: string }, ticketId: string): boolean {
  if (user.role === 'admin') return true;

  const ticket = db.prepare(
    'SELECT requester_id, assigned_to FROM tickets WHERE id = ?'
  ).get(ticketId) as TicketOwnerRow | undefined;

  if (!ticket) return false;
  return ticket.requester_id === user.id || ticket.assigned_to === user.id;
}

// Get attachments for a ticket
router.get('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    // Authorization: verify user has access to the parent ticket before listing metadata
    if (!canAccessTicketAttachment(req.user!, req.params.ticketId as string)) {
      return res.status(403).json({ error: 'Forbidden: you do not have access to this ticket' });
    }

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
router.post('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
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

    // Magic-byte-kontroll: verifiera att filens faktiska innehåll matchar deklarerad MIME
    const uploadedPath = join(UPLOAD_DIR, req.file.filename);
    if (!hasMagicByteMatch(uploadedPath, req.file.mimetype)) {
      try { unlinkSync(uploadedPath); } catch { /* ignore cleanup error */ }
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
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path, file_size, file_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.params.ticketId,
      req.file.originalname,
      req.file.filename,
      req.file.size,
      req.file.mimetype
    );

    const attachment = db.prepare('SELECT id, ticket_id, file_name, file_path, file_size, file_type, created_at FROM ticket_attachments WHERE id = ?').get(id) as AttachmentRow;
    
      res.status(201).json({
        ...attachment,
        url: `/api/attachments/file/${attachment.id}`,
      });
    } catch (error) {
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

    // Authorization: verify user has access to the parent ticket
    if (!canAccessTicketAttachment(req.user!, attachment.ticket_id)) {
      return res.status(403).json({ error: 'Forbidden: you do not have access to this attachment' });
    }

    const filePath = join(UPLOAD_DIR, attachment.file_path);

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Sanitera filnamnet strikt: tillåt endast säkra ASCII-tecken i fallback-formen,
    // och skicka även RFC 5987-kodat namn (filename*) för korrekt hantering av
    // icke-ASCII, semikolon och andra specialtecken i moderna klienter.
    const safeAsciiFilename = attachment.file_name
      .replace(/[^\x20-\x7E]/g, '_')  // ersätt icke-ASCII med _
      .replace(/[";\\]/g, '_');         // ersätt semikolon, citattecken, backslash
    const encodedFilename = encodeURIComponent(attachment.file_name);

    res.setHeader('Content-Type', attachment.file_type || 'application/octet-stream');
    // Use 'attachment' instead of 'inline' to force download and prevent execution.
    // filename* (RFC 5987) hanterar icke-ASCII korrekt; filename= är fallback för äldre klienter.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeAsciiFilename}"; filename*=UTF-8''${encodedFilename}`
    );
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

    // Authorization: verify user has access to the parent ticket
    if (!canAccessTicketAttachment(req.user!, attachment.ticket_id)) {
      return res.status(403).json({ error: 'Forbidden: you do not have access to this attachment' });
    }

    // IMPORTANT: Delete from database FIRST, then file
    // This prevents orphaned DB entries if file deletion fails
    // Orphaned files are acceptable, orphaned DB entries are not
    db.prepare('DELETE FROM ticket_attachments WHERE id = ?').run(req.params.id);

    // Delete file from disk after successful DB deletion
    const filePath = join(UPLOAD_DIR, attachment.file_path);
    if (existsSync(filePath)) {
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
