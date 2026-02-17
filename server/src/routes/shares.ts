import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

const router = Router();

interface ShareRow {
  id: string;
  ticket_id: string;
  share_token: string;
  created_by: string | null;
  created_at: string;
}

interface TicketRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category_id: string | null;
  requester_id: string | null;
  notes: string | null;
  solution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  label: string;
}

interface ContactRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
}

interface AttachmentRow {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number | null;
}

interface ChecklistRow {
  id: string;
  label: string;
  completed: number;
  position: number;
}

// Get existing share token for a ticket
router.get('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const share = db.prepare('SELECT * FROM ticket_shares WHERE ticket_id = ?').get(req.params.ticketId) as ShareRow | undefined;
    res.json({ share_token: share?.share_token || null });
  } catch (error) {
    console.error('Error fetching share:', error);
    res.status(500).json({ error: 'Failed to fetch share' });
  }
});

// Create share link
router.post('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    // Check if share already exists
    const existing = db.prepare('SELECT * FROM ticket_shares WHERE ticket_id = ?').get(req.params.ticketId) as ShareRow | undefined;
    
    if (existing) {
      return res.json({ share_token: existing.share_token });
    }

    // Verify ticket exists
    const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const id = uuidv4();
    const shareToken = randomBytes(12).toString('hex');

    db.prepare(`
      INSERT INTO ticket_shares (id, ticket_id, share_token, created_by)
      VALUES (?, ?, ?, ?)
    `).run(id, req.params.ticketId, shareToken, req.user!.id);

    res.status(201).json({ share_token: shareToken });
  } catch (error) {
    console.error('Error creating share:', error);
    res.status(500).json({ error: 'Failed to create share' });
  }
});

// Delete share link
router.delete('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM ticket_shares WHERE ticket_id = ?').run(req.params.ticketId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Share not found' });
    }
    
    res.json({ message: 'Share deleted' });
  } catch (error) {
    console.error('Error deleting share:', error);
    res.status(500).json({ error: 'Failed to delete share' });
  }
});

// Get shared ticket (PUBLIC - no auth required)
router.get('/public/:token', (req: Request, res: Response) => {
  try {
    const share = db.prepare('SELECT * FROM ticket_shares WHERE share_token = ?').get(req.params.token) as ShareRow | undefined;
    
    if (!share) {
      return res.status(404).json({ error: 'Invalid or expired share link' });
    }

    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(share.ticket_id) as TicketRow | undefined;
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Get category
    let category: CategoryRow | null = null;
    if (ticket.category_id) {
      category = db.prepare('SELECT * FROM categories WHERE id = ?').get(ticket.category_id) as CategoryRow | undefined || null;
    }

    // Get requester
    let requester: ContactRow | null = null;
    if (ticket.requester_id) {
      requester = db.prepare('SELECT id, name, email, company FROM contacts WHERE id = ?').get(ticket.requester_id) as ContactRow | undefined || null;
    }

    // Get attachments
    const attachments = db.prepare(`
      SELECT id, file_name, file_path, file_type, file_size FROM ticket_attachments WHERE ticket_id = ?
    `).all(share.ticket_id) as AttachmentRow[];

    // Add public URLs for attachments
    const attachmentsWithUrls = attachments.map(a => ({
      ...a,
      url: `/api/shares/public/file/${share.share_token}/${a.id}`,
    }));

    // Get checklists
    const checklistItems = db.prepare(`
      SELECT id, label, completed, position FROM ticket_checklists WHERE ticket_id = ? ORDER BY position ASC
    `).all(share.ticket_id) as ChecklistRow[];

    res.json({
      ticket: {
        ...ticket,
        category,
      },
      requester,
      attachments: attachmentsWithUrls,
      checklistItems: checklistItems.map(item => ({
        ...item,
        completed: item.completed === 1,
      })),
    });
  } catch (error) {
    console.error('Error fetching shared ticket:', error);
    res.status(500).json({ error: 'Failed to fetch shared ticket' });
  }
});

// Serve file for shared ticket (PUBLIC)
router.get('/public/file/:token/:attachmentId', (req: Request, res: Response) => {
  try {
    // Verify share token
    const share = db.prepare('SELECT * FROM ticket_shares WHERE share_token = ?').get(req.params.token) as ShareRow | undefined;
    
    if (!share) {
      return res.status(404).json({ error: 'Invalid share link' });
    }

    // Verify attachment belongs to the shared ticket
    interface AttachmentFullRow {
      id: string;
      ticket_id: string;
      file_name: string;
      file_path: string;
      file_type: string | null;
    }
    
    const attachment = db.prepare(`
      SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?
    `).get(req.params.attachmentId, share.ticket_id) as AttachmentFullRow | undefined;

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
    console.error('Error serving shared file:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

export default router;
