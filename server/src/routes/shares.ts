import { Router, Request, Response } from 'express';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { canAccessTicket } from '../lib/ticketAccess.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../lib/logger.js';
import { logAudit } from '../lib/auditLog.js';
import { SHARE_DEFAULT_EXPIRY_DAYS, mintShareToken, getActiveShareByToken } from '../lib/shares.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

const router = Router();

/**
 * Rate limiter for public share endpoints.
 * 30 requests per minute per IP — prevents brute-force of share tokens.
 */
const sharePublicRateLimiter = createRateLimiter(60 * 1000, 30);

interface ShareRow {
  id: string;
  ticket_id: string;
  share_token: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
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
    if (!canAccessTicket(req.user!, req.params.ticketId as string)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }
    // Endast aktiva shares räknas — en utgången rad ska visas som "ingen
    // delning" tills en ny myntas (samma fail-closed-villkor som publika vyn).
    const share = db.prepare(
      "SELECT id, ticket_id, share_token, created_by, created_at, expires_at FROM ticket_shares WHERE ticket_id = ? AND expires_at > datetime('now')"
    ).get(req.params.ticketId) as ShareRow | undefined;
    res.json({ share_token: share?.share_token || null, expires_at: share?.expires_at || null });
  } catch (error) {
    logger.error('Error fetching share:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch share' });
  }
});

// Create share link
router.post('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    // Validera valfri expiresInDays innan något annat — 400 på ogiltig input,
    // oavsett om en aktiv share redan finns.
    let expiresInDays = SHARE_DEFAULT_EXPIRY_DAYS;
    if (req.body && req.body.expiresInDays !== undefined) {
      const raw = req.body.expiresInDays;
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 365) {
        return res.status(400).json({ error: 'expiresInDays must be an integer between 1 and 365' });
      }
      expiresInDays = raw;
    }

    // Verify ticket exists
    const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    // Behörighet FÖRE den idempotenta returen — annars kan en inloggad
    // användare utan åtkomst till ärendet hämta ut en redan myntad token.
    if (!canAccessTicket(req.user!, req.params.ticketId as string)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }

    // Finns en AKTIV share redan: returnera den oförändrad (idempotent, som
    // tidigare) — inklusive dess expires_at.
    const active = db.prepare(
      "SELECT id, ticket_id, share_token, created_by, created_at, expires_at FROM ticket_shares WHERE ticket_id = ? AND expires_at > datetime('now')"
    ).get(req.params.ticketId) as ShareRow | undefined;

    if (active) {
      return res.json({ share_token: active.share_token, expires_at: active.expires_at });
    }

    // Ingen aktiv share — ta bort en ev. UTGÅNGEN rad (ticket_id är inte
    // unikt-constrained, share_token är det) innan ny myntas.
    db.prepare('DELETE FROM ticket_shares WHERE ticket_id = ?').run(req.params.ticketId);

    const { shareToken, expiresAt } = mintShareToken(db, req.params.ticketId, req.user!.id, expiresInDays);

    logAudit(
      req.user!.id,
      'share_create',
      'ticket_share',
      req.params.ticketId,
      `ticket_id: ${req.params.ticketId}, expires_at: ${expiresAt}`,
      req.ip,
      req.apiKey?.id ?? null,
    );

    res.status(201).json({ share_token: shareToken, expires_at: expiresAt });
  } catch (error) {
    logger.error('Error creating share:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create share' });
  }
});

// Delete share link
router.delete('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    if (!canAccessTicket(req.user!, req.params.ticketId as string)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }
    const result = db.prepare('DELETE FROM ticket_shares WHERE ticket_id = ?').run(req.params.ticketId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Share not found' });
    }

    logAudit(req.user!.id, 'share_delete', 'ticket_share', req.params.ticketId, null, req.ip, req.apiKey?.id ?? null);

    res.json({ message: 'Share deleted' });
  } catch (error) {
    logger.error('Error deleting share:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete share' });
  }
});

// Get shared ticket (PUBLIC - no auth required)
router.get('/public/:token', sharePublicRateLimiter, (req: Request, res: Response) => {
  try {
    const share = getActiveShareByToken(db, req.params.token as string);

    if (!share) {
      return res.status(404).json({ error: 'Invalid or expired share link' });
    }

    const ticket = db.prepare(
      'SELECT id, title, description, status, priority, category_id, requester_id, notes, solution, created_at, updated_at, resolved_at, closed_at FROM tickets WHERE id = ?'
    ).get(share.ticket_id) as TicketRow | undefined;
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Get category
    let category: CategoryRow | null = null;
    if (ticket.category_id) {
      category = db.prepare('SELECT id, name, label FROM categories WHERE id = ?').get(ticket.category_id) as CategoryRow | undefined || null;
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

    // Filtrera bort interna anteckningar — `notes` är agent-internt och får
    // inte läcka till mottagaren av en publik delningslänk.
    const { notes: _internalNotes, ...ticketPublic } = ticket;
    void _internalNotes;

    res.json({
      ticket: {
        ...ticketPublic,
        category,
      },
      requester,
      attachments: attachmentsWithUrls,
      checklistItems: checklistItems.map(item => ({
        ...item,
        completed: item.completed === 1,
      })),
      share_expires_at: share.expires_at,
    });
  } catch (error) {
    logger.error('Error fetching shared ticket:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch shared ticket' });
  }
});

// Serve file for shared ticket (PUBLIC)
router.get('/public/file/:token/:attachmentId', sharePublicRateLimiter, (req: Request, res: Response) => {
  try {
    // Verify share token
    const share = getActiveShareByToken(db, req.params.token as string);

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
    
    const attachment = db.prepare(
      'SELECT id, ticket_id, file_name, file_path, file_type FROM ticket_attachments WHERE id = ? AND ticket_id = ?'
    ).get(req.params.attachmentId, share.ticket_id) as AttachmentFullRow | undefined;

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
    logger.error('Error serving shared file:', { error: String(error) });
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

export default router;
