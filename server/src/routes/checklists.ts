import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

interface ChecklistRow {
  id: string;
  ticket_id: string;
  label: string;
  completed: number;
  position: number;
  created_at: string;
  updated_at: string;
}

// Get checklists for a ticket
router.get('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const items = db.prepare(`
      SELECT * FROM ticket_checklists WHERE ticket_id = ? ORDER BY position ASC
    `).all(req.params.ticketId) as ChecklistRow[];
    
    // Convert completed from integer to boolean
    const mapped = items.map(item => ({
      ...item,
      completed: item.completed === 1,
    }));
    
    res.json(mapped);
  } catch (error) {
    console.error('Error fetching checklists:', error);
    res.status(500).json({ error: 'Failed to fetch checklists' });
  }
});

// Add checklist item
router.post('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  const { label } = req.body;

  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    return res.status(400).json({ error: 'Label is required' });
  }

  try {
    // Verify ticket exists
    const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Get max position
    const maxPos = db.prepare(`
      SELECT MAX(position) as maxPosition FROM ticket_checklists WHERE ticket_id = ?
    `).get(req.params.ticketId) as { maxPosition: number | null };
    
    const position = (maxPos.maxPosition ?? -1) + 1;
    const id = uuidv4();

    db.prepare(`
      INSERT INTO ticket_checklists (id, ticket_id, label, position)
      VALUES (?, ?, ?, ?)
    `).run(id, req.params.ticketId, label.trim(), position);

    const item = db.prepare('SELECT * FROM ticket_checklists WHERE id = ?').get(id) as ChecklistRow;
    
    res.status(201).json({
      ...item,
      completed: item.completed === 1,
    });
  } catch (error) {
    console.error('Error creating checklist item:', error);
    res.status(500).json({ error: 'Failed to create checklist item' });
  }
});

// Bulk add checklist items
router.post('/ticket/:ticketId/bulk', authenticate, (req: AuthRequest, res: Response) => {
  const { labels } = req.body;

  if (!Array.isArray(labels) || labels.length === 0) {
    return res.status(400).json({ error: 'Labels array is required' });
  }

  try {
    // Verify ticket exists
    const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const insertStmt = db.prepare(`
      INSERT INTO ticket_checklists (id, ticket_id, label, position)
      VALUES (?, ?, ?, ?)
    `);

    const createdIds: string[] = [];

    const insertMany = db.transaction((items: string[]) => {
      items.forEach((label, index) => {
        if (typeof label === 'string' && label.trim().length > 0) {
          const id = uuidv4();
          insertStmt.run(id, req.params.ticketId, label.trim(), index);
          createdIds.push(id);
        }
      });
    });

    insertMany(labels);

    const createdItems = db.prepare(`
      SELECT * FROM ticket_checklists WHERE id IN (${createdIds.map(() => '?').join(',')})
    `).all(...createdIds) as ChecklistRow[];

    const mapped = createdItems.map(item => ({
      ...item,
      completed: item.completed === 1,
    }));

    res.status(201).json(mapped);
  } catch (error) {
    console.error('Error bulk creating checklist items:', error);
    res.status(500).json({ error: 'Failed to create checklist items' });
  }
});

// Update checklist item
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { label, completed } = req.body;

  try {
    const existing = db.prepare('SELECT * FROM ticket_checklists WHERE id = ?').get(req.params.id) as ChecklistRow | undefined;
    
    if (!existing) {
      return res.status(404).json({ error: 'Checklist item not found' });
    }

    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (label !== undefined) {
      updates.push('label = ?');
      values.push(label);
    }
    if (completed !== undefined) {
      updates.push('completed = ?');
      values.push(completed ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE ticket_checklists SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const item = db.prepare('SELECT * FROM ticket_checklists WHERE id = ?').get(req.params.id) as ChecklistRow;
    
    res.json({
      ...item,
      completed: item.completed === 1,
    });
  } catch (error) {
    console.error('Error updating checklist item:', error);
    res.status(500).json({ error: 'Failed to update checklist item' });
  }
});

// Delete checklist item
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM ticket_checklists WHERE id = ?').run(req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Checklist item not found' });
    }
    
    res.json({ message: 'Checklist item deleted' });
  } catch (error) {
    console.error('Error deleting checklist item:', error);
    res.status(500).json({ error: 'Failed to delete checklist item' });
  }
});

export default router;
