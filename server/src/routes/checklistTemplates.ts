import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { canAccessTicket } from '../lib/ticketAccess.js';
import { logger } from '../lib/logger.js';

const router = Router();

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface TemplateItemRow {
  id: string;
  template_id: string;
  label: string;
  parent_label: string | null;
  position: number;
}

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

// GET /api/checklist-templates — list all templates with items
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const templates = db.prepare('SELECT * FROM checklist_templates ORDER BY name ASC').all() as TemplateRow[];
    const items = db.prepare('SELECT * FROM checklist_template_items ORDER BY position ASC').all() as TemplateItemRow[];
    const result = templates.map(t => ({
      ...t,
      items: items.filter(i => i.template_id === t.id),
    }));
    res.json(result);
  } catch (error) {
    logger.error('Error fetching checklist templates:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch checklist templates' });
  }
});

// POST /api/checklist-templates — create template
router.post('/', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { name, description, items } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  try {
    const id = uuidv4();
    db.prepare('INSERT INTO checklist_templates (id, name, description) VALUES (?, ?, ?)').run(
      id, name.trim(), description?.trim() || null
    );

    const insertItem = db.prepare(
      'INSERT INTO checklist_template_items (id, template_id, label, parent_label, position) VALUES (?, ?, ?, ?, ?)'
    );
    const insertAll = db.transaction((rows: { label: string; parent_label?: string }[]) => {
      rows.forEach((row, i) => {
        insertItem.run(uuidv4(), id, row.label.trim(), row.parent_label?.trim() || null, i);
      });
    });
    insertAll(items.filter((i: any) => typeof i.label === 'string' && i.label.trim().length > 0));

    const template = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(id) as TemplateRow;
    const templateItems = db.prepare(
      'SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY position ASC'
    ).all(id) as TemplateItemRow[];

    res.status(201).json({ ...template, items: templateItems });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A template with that name already exists' });
    }
    logger.error('Error creating checklist template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create checklist template' });
  }
});

// PUT /api/checklist-templates/:id — update template
router.put('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { name, description, items } = req.body;

  try {
    const existing = db.prepare('SELECT id FROM checklist_templates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    if (name !== undefined) {
      db.prepare(
        'UPDATE checklist_templates SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(name.trim(), description?.trim() || null, req.params.id);
    }

    if (Array.isArray(items)) {
      db.prepare('DELETE FROM checklist_template_items WHERE template_id = ?').run(req.params.id);
      const insertItem = db.prepare(
        'INSERT INTO checklist_template_items (id, template_id, label, parent_label, position) VALUES (?, ?, ?, ?, ?)'
      );
      const insertAll = db.transaction((rows: { label: string; parent_label?: string }[]) => {
        rows.forEach((row, i) => {
          insertItem.run(uuidv4(), req.params.id, row.label.trim(), row.parent_label?.trim() || null, i);
        });
      });
      insertAll(items.filter((i: any) => typeof i.label === 'string' && i.label.trim().length > 0));
    }

    const template = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(req.params.id) as TemplateRow;
    const templateItems = db.prepare(
      'SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY position ASC'
    ).all(req.params.id) as TemplateItemRow[];

    res.json({ ...template, items: templateItems });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A template with that name already exists' });
    }
    logger.error('Error updating checklist template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to update checklist template' });
  }
});

// DELETE /api/checklist-templates/:id
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM checklist_templates WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ message: 'Template deleted' });
  } catch (error) {
    logger.error('Error deleting checklist template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete checklist template' });
  }
});

// POST /api/checklist-templates/:id/apply — apply template items to a ticket
router.post('/:id/apply', authenticate, (req: AuthRequest, res: Response) => {
  const { ticketId } = req.body;
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });

  try {
    const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!canAccessTicket(req.user!, ticketId as string)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }

    const template = db.prepare('SELECT id FROM checklist_templates WHERE id = ?').get(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const templateItems = db.prepare(
      'SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY position ASC'
    ).all(req.params.id) as TemplateItemRow[];

    // Get current max position
    const maxPos = db.prepare(
      'SELECT MAX(position) as mp FROM ticket_checklists WHERE ticket_id = ?'
    ).get(ticketId) as { mp: number | null };
    let pos = (maxPos.mp ?? -1) + 1;

    // Insert parent items first, track label→id mapping for nesting
    const labelToId: Record<string, string> = {};
    const parentItems = templateItems.filter(i => !i.parent_label);
    const insertItem = db.prepare(
      'INSERT INTO ticket_checklists (id, ticket_id, label, position, parent_id) VALUES (?, ?, ?, ?, ?)'
    );

    const doInsert = db.transaction(() => {
      for (const item of parentItems) {
        const newId = uuidv4();
        insertItem.run(newId, ticketId, item.label, pos++, null);
        labelToId[item.label] = newId;
      }
      for (const item of templateItems.filter(i => i.parent_label)) {
        const parentId = labelToId[item.parent_label!] || null;
        insertItem.run(uuidv4(), ticketId, item.label, pos++, parentId);
      }
    });
    doInsert();

    const created = db.prepare(
      'SELECT * FROM ticket_checklists WHERE ticket_id = ? ORDER BY position ASC'
    ).all(ticketId) as ChecklistRow[];

    res.status(201).json(created.map(r => ({ ...r, completed: r.completed === 1 })));
  } catch (error) {
    logger.error('Error applying checklist template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to apply template' });
  }
});

export default router;
