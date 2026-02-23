import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

// Ensure upload directory exists
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Whitelist of allowed MIME types
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv',
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
const ALLOWED_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
  'pdf',
  'txt', 'csv',
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
    fileSize: 10 * 1024 * 1024, // 10MB limit
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

// Get attachments for a ticket
router.get('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const attachments = db.prepare(`
      SELECT * FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC
    `).all(req.params.ticketId) as AttachmentRow[];

    // Add URL for each attachment (authentication via Authorization header)
    const withUrls = attachments.map(a => ({
      ...a,
      url: `/api/attachments/file/${a.id}`,
    }));

    res.json(withUrls);
  } catch (error) {
    console.error('Error fetching attachments:', error);
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

// Upload attachment
router.post('/ticket/:ticketId', authenticate, upload.single('file'), (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
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

    const attachment = db.prepare('SELECT * FROM ticket_attachments WHERE id = ?').get(id) as AttachmentRow;
    
    res.status(201).json({
      ...attachment,
      url: `/api/attachments/file/${attachment.id}`,
    });
  } catch (error) {
    console.error('Error uploading attachment:', error);
    res.status(500).json({ error: 'Failed to upload attachment' });
  }
});

// Serve file (authenticated)
router.get('/file/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const attachment = db.prepare('SELECT * FROM ticket_attachments WHERE id = ?').get(req.params.id) as AttachmentRow | undefined;
    
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const filePath = join(UPLOAD_DIR, attachment.file_path);
    
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Sanitize filename to prevent header injection
    const safeFilename = attachment.file_name.replace(/["\r\n]/g, '');

    res.setHeader('Content-Type', attachment.file_type || 'application/octet-stream');
    // Use 'attachment' instead of 'inline' to force download and prevent execution
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// Delete attachment
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const attachment = db.prepare('SELECT * FROM ticket_attachments WHERE id = ?').get(req.params.id) as AttachmentRow | undefined;
    
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // Delete file from disk
    const filePath = join(UPLOAD_DIR, attachment.file_path);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }

    // Delete from database
    db.prepare('DELETE FROM ticket_attachments WHERE id = ?').run(req.params.id);
    
    res.json({ message: 'Attachment deleted' });
  } catch (error) {
    console.error('Error deleting attachment:', error);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

export default router;
