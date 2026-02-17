import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

interface TicketLinkRow {
  id: string;
  source_ticket_id: string;
  target_ticket_id: string;
  link_type: string;
  created_by: string | null;
  created_at: string;
}

interface LinkedTicketDetails {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
}

interface TicketLinkWithDetails {
  id: string;
  sourceTicketId: string;
  targetTicketId: string;
  linkType: string;
  createdBy: string | null;
  createdAt: string;
  linkedTicket: LinkedTicketDetails;
}

// GET /api/links/ticket/:ticketId - Fetch all links for a ticket (bidirectional)
router.get('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    // Get links where ticket is either source or target
    const links = db.prepare(`
      SELECT
        tl.*,
        CASE
          WHEN tl.source_ticket_id = ? THEN t2.id
          ELSE t1.id
        END as linked_ticket_id,
        CASE
          WHEN tl.source_ticket_id = ? THEN t2.title
          ELSE t1.title
        END as linked_ticket_title,
        CASE
          WHEN tl.source_ticket_id = ? THEN t2.status
          ELSE t1.status
        END as linked_ticket_status,
        CASE
          WHEN tl.source_ticket_id = ? THEN t2.priority
          ELSE t1.priority
        END as linked_ticket_priority,
        CASE
          WHEN tl.source_ticket_id = ? THEN t2.created_at
          ELSE t1.created_at
        END as linked_ticket_created_at
      FROM ticket_links tl
      LEFT JOIN tickets t1 ON tl.source_ticket_id = t1.id
      LEFT JOIN tickets t2 ON tl.target_ticket_id = t2.id
      WHERE tl.source_ticket_id = ? OR tl.target_ticket_id = ?
      ORDER BY tl.created_at DESC
    `).all(
      req.params.ticketId,
      req.params.ticketId,
      req.params.ticketId,
      req.params.ticketId,
      req.params.ticketId,
      req.params.ticketId,
      req.params.ticketId
    ) as (TicketLinkRow & {
      linked_ticket_id: string;
      linked_ticket_title: string;
      linked_ticket_status: string;
      linked_ticket_priority: string;
      linked_ticket_created_at: string;
    })[];

    const mapped: TicketLinkWithDetails[] = links.map((link) => ({
      id: link.id,
      sourceTicketId: link.source_ticket_id,
      targetTicketId: link.target_ticket_id,
      linkType: link.link_type,
      createdBy: link.created_by,
      createdAt: link.created_at,
      linkedTicket: {
        id: link.linked_ticket_id,
        title: link.linked_ticket_title,
        status: link.linked_ticket_status,
        priority: link.linked_ticket_priority,
        created_at: link.linked_ticket_created_at,
      },
    }));

    res.json(mapped);
  } catch (error) {
    console.error('Error fetching ticket links:', error);
    res.status(500).json({ error: 'Failed to fetch ticket links' });
  }
});

// POST /api/links/ticket/:ticketId - Create new link
router.post('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  const { targetTicketId, linkType = 'related' } = req.body;

  if (!targetTicketId || typeof targetTicketId !== 'string') {
    return res.status(400).json({ error: 'Target ticket ID is required' });
  }

  if (!req.user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  // Prevent linking ticket to itself
  if (req.params.ticketId === targetTicketId) {
    return res.status(400).json({ error: 'Cannot link a ticket to itself' });
  }

  try {
    // Verify both tickets exist
    const sourceTicket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.ticketId);
    if (!sourceTicket) {
      return res.status(404).json({ error: 'Source ticket not found' });
    }

    const targetTicket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(targetTicketId);
    if (!targetTicket) {
      return res.status(404).json({ error: 'Target ticket not found' });
    }

    // Check if link already exists in either direction
    const existingLink = db.prepare(`
      SELECT id FROM ticket_links
      WHERE (source_ticket_id = ? AND target_ticket_id = ?)
         OR (source_ticket_id = ? AND target_ticket_id = ?)
    `).get(req.params.ticketId, targetTicketId, targetTicketId, req.params.ticketId);

    if (existingLink) {
      return res.status(409).json({ error: 'Link already exists between these tickets' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO ticket_links (id, source_ticket_id, target_ticket_id, link_type, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.params.ticketId, targetTicketId, linkType, req.user.id, now);

    // Fetch the created link with ticket details
    const link = db.prepare(`
      SELECT
        tl.*,
        t.id as linked_ticket_id,
        t.title as linked_ticket_title,
        t.status as linked_ticket_status,
        t.priority as linked_ticket_priority,
        t.created_at as linked_ticket_created_at
      FROM ticket_links tl
      LEFT JOIN tickets t ON tl.target_ticket_id = t.id
      WHERE tl.id = ?
    `).get(id) as TicketLinkRow & {
      linked_ticket_id: string;
      linked_ticket_title: string;
      linked_ticket_status: string;
      linked_ticket_priority: string;
      linked_ticket_created_at: string;
    };

    const response: TicketLinkWithDetails = {
      id: link.id,
      sourceTicketId: link.source_ticket_id,
      targetTicketId: link.target_ticket_id,
      linkType: link.link_type,
      createdBy: link.created_by,
      createdAt: link.created_at,
      linkedTicket: {
        id: link.linked_ticket_id,
        title: link.linked_ticket_title,
        status: link.linked_ticket_status,
        priority: link.linked_ticket_priority,
        created_at: link.linked_ticket_created_at,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating ticket link:', error);
    res.status(500).json({ error: 'Failed to create ticket link' });
  }
});

// DELETE /api/links/:id - Delete link
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  try {
    const existing = db.prepare('SELECT * FROM ticket_links WHERE id = ?').get(req.params.id) as TicketLinkRow | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Link not found' });
    }

    db.prepare('DELETE FROM ticket_links WHERE id = ?').run(req.params.id);

    res.json({ message: 'Link deleted' });
  } catch (error) {
    console.error('Error deleting ticket link:', error);
    res.status(500).json({ error: 'Failed to delete ticket link' });
  }
});

export default router;
