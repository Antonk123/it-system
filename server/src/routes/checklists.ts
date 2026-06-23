import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { canAccessTicket } from '../lib/ticketAccess.js';
import { logger } from '../lib/logger.js';

const router = Router();

interface ChecklistRow {
  id: string;
  ticket_id: string;
  label: string;
  completed: number;
  position: number;
  parent_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

const mapItem = (item: ChecklistRow) => ({
  ...item,
  completed: item.completed === 1,
});

// Get checklist progress for multiple tickets (batch)
router.post('/progress', authenticate, (req: AuthRequest, res: Response) => {
  const { ticketIds } = req.body;

  if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
    return res.status(400).json({ error: 'ticketIds array is required' });
  }

  try {
    // Authz: only expose progress for tickets the caller may access. Reusing the
    // shared canAccessTicket (admin short-circuits without a DB hit) closes the
    // batch-IDOR where any logged-in user could probe checklist counts of any
    // ticket. Inaccessible ids are silently dropped — batch semantics, and the
    // client only ever sends ids from an already access-scoped ticket list.
    // The typeof guard also hardens against non-string ids reaching the query.
    const accessibleIds = (ticketIds as unknown[]).filter(
      (id): id is string => typeof id === 'string' && canAccessTicket(req.user!, id)
    );

    if (accessibleIds.length === 0) {
      return res.json({});
    }

    const placeholders = accessibleIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT ticket_id, COUNT(*) as total, SUM(completed) as completed
      FROM ticket_checklists
      WHERE ticket_id IN (${placeholders})
      GROUP BY ticket_id
    `).all(...accessibleIds) as { ticket_id: string; total: number; completed: number }[];

    const result: Record<string, { total: number; completed: number }> = {};
    rows.forEach(row => {
      result[row.ticket_id] = { total: row.total, completed: row.completed };
    });

    res.json(result);
  } catch (error) {
    logger.error('Error fetching batch checklist progress:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch checklist progress' });
  }
});

// Get checklists for a ticket
router.get('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    if (!canAccessTicket(req.user!, req.params.ticketId as string)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }
    const items = db.prepare(`
      SELECT * FROM ticket_checklists WHERE ticket_id = ? ORDER BY position ASC
    `).all(req.params.ticketId) as ChecklistRow[];
    res.json(items.map(mapItem));
  } catch (error) {
    logger.error('Error fetching checklists:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch checklists' });
  }
});

// Add checklist item
router.post('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  const { label, parent_id, due_date } = req.body;

  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    return res.status(400).json({ error: 'Label is required' });
  }

  try {
    // Verify ticket exists
    const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    if (!canAccessTicket(req.user!, req.params.ticketId as string)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }

    // Get max position
    const maxPos = db.prepare(`
      SELECT MAX(position) as maxPosition FROM ticket_checklists WHERE ticket_id = ?
    `).get(req.params.ticketId) as { maxPosition: number | null };

    const position = (maxPos.maxPosition ?? -1) + 1;
    const id = uuidv4();

    db.prepare(`
      INSERT INTO ticket_checklists (id, ticket_id, label, position, parent_id, due_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.params.ticketId, label.trim(), position, parent_id || null, due_date || null);

    const item = db.prepare('SELECT * FROM ticket_checklists WHERE id = ?').get(id) as ChecklistRow;
    res.status(201).json(mapItem(item));
  } catch (error) {
    logger.error('Error creating checklist item:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create checklist item' });
  }
});

// Bulk add checklist items
router.post('/ticket/:ticketId/bulk', authenticate, (req: AuthRequest, res: Response) => {
  const { labels, items: itemObjects } = req.body;

  // Support both plain string array (labels) and object array (items)
  const rawItems: { label: string; parent_id?: string | null; due_date?: string | null }[] = [];

  if (Array.isArray(itemObjects)) {
    for (const item of itemObjects) {
      if (typeof item === 'string' && item.trim().length > 0) {
        rawItems.push({ label: item });
      } else if (item && typeof item.label === 'string' && item.label.trim().length > 0) {
        rawItems.push({ label: item.label, parent_id: item.parent_id || null, due_date: item.due_date || null });
      }
    }
  } else if (Array.isArray(labels)) {
    for (const label of labels) {
      if (typeof label === 'string' && label.trim().length > 0) {
        rawItems.push({ label });
      }
    }
  }

  if (rawItems.length === 0) {
    return res.status(400).json({ error: 'Labels array is required' });
  }

  try {
    // Verify ticket exists
    const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    if (!canAccessTicket(req.user!, req.params.ticketId as string)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }

    const insertStmt = db.prepare(`
      INSERT INTO ticket_checklists (id, ticket_id, label, position, parent_id, due_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const createdIds: string[] = [];

    const insertMany = db.transaction((items: typeof rawItems) => {
      items.forEach((item, index) => {
        const id = uuidv4();
        insertStmt.run(id, req.params.ticketId, item.label.trim(), index, item.parent_id ?? null, item.due_date ?? null);
        createdIds.push(id);
      });
    });

    insertMany(rawItems);

    if (createdIds.length === 0) {
      return res.status(201).json([]);
    }

    const createdItems = db.prepare(`
      SELECT * FROM ticket_checklists WHERE id IN (${createdIds.map(() => '?').join(',')})
    `).all(...createdIds) as ChecklistRow[];

    res.status(201).json(createdItems.map(mapItem));
  } catch (error) {
    logger.error('Error bulk creating checklist items:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create checklist items' });
  }
});

// Update checklist item
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { label, completed, due_date, parent_id } = req.body;
  const itemId = req.params.id as string;

  try {
    const existing = db.prepare('SELECT * FROM ticket_checklists WHERE id = ?').get(itemId) as ChecklistRow | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Checklist item not found' });
    }
    if (!canAccessTicket(req.user!, existing.ticket_id)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (label !== undefined) {
      updates.push('label = ?');
      values.push(label);
    }
    if (completed !== undefined) {
      updates.push('completed = ?');
      values.push(completed ? 1 : 0);
    }
    if (due_date !== undefined) {
      updates.push('due_date = ?');
      values.push(due_date || null);
    }
    if (parent_id !== undefined) {
      updates.push('parent_id = ?');
      values.push(parent_id || null);
    }

    if (updates.length > 0) {
      values.push(itemId);
      db.prepare(`UPDATE ticket_checklists SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const item = db.prepare('SELECT * FROM ticket_checklists WHERE id = ?').get(itemId) as ChecklistRow;
    res.json(mapItem(item));
  } catch (error) {
    logger.error('Error updating checklist item:', { error: String(error) });
    res.status(500).json({ error: 'Failed to update checklist item' });
  }
});

// Delete checklist item
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT ticket_id FROM ticket_checklists WHERE id = ?').get(req.params.id) as { ticket_id: string } | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Checklist item not found' });
    }
    if (!canAccessTicket(req.user!, existing.ticket_id)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }

    db.prepare('DELETE FROM ticket_checklists WHERE id = ?').run(req.params.id);

    res.json({ message: 'Checklist item deleted' });
  } catch (error) {
    logger.error('Error deleting checklist item:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete checklist item' });
  }
});

export default router;
