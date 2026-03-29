import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { computeNextRun } from '../lib/recurringScheduler.js';

const router = Router();

interface RecurringTemplateRow {
  id: string;
  name: string;
  title: string;
  description: string;
  priority: string;
  category_id: string | null;
  tags: string;
  interval_type: 'daily' | 'weekly' | 'monthly';
  interval_day: number | null;
  is_active: number;
  last_run: string | null;
  next_run: string;
  created_at: string;
  updated_at: string;
}

interface HistoryRow {
  id: string;
  ticket_id: string;
  created_at: string;
  ticket_title: string;
}

// GET /api/recurring — list all templates with last 10 history entries each
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const templates = db.prepare(
      'SELECT * FROM recurring_templates ORDER BY created_at DESC'
    ).all() as RecurringTemplateRow[];

    // Batch-load last 10 history entries per template in one query
    const allHistory = db.prepare(`
      SELECT rth.id, rth.template_id, rth.ticket_id, rth.created_at, tk.title AS ticket_title
      FROM recurring_ticket_history rth
      JOIN tickets tk ON tk.id = rth.ticket_id
      ORDER BY rth.created_at DESC
    `).all() as (HistoryRow & { template_id: string })[];
    const historyByTemplate = new Map<string, HistoryRow[]>();
    for (const h of allHistory) {
      const list = historyByTemplate.get(h.template_id) || [];
      if (list.length < 10) {
        list.push({ id: h.id, ticket_id: h.ticket_id, created_at: h.created_at, ticket_title: h.ticket_title });
        historyByTemplate.set(h.template_id, list);
      }
    }

    const result = templates.map(t => {
      let parsedTags: string[] = [];
      try {
        parsedTags = JSON.parse(t.tags || '[]');
      } catch {
        parsedTags = [];
      }

      return { ...t, tags: parsedTags, history: historyByTemplate.get(t.id) || [] };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching recurring templates:', error);
    res.status(500).json({ error: 'Failed to fetch recurring templates' });
  }
});

// POST /api/recurring — create a new template
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  const { name, title, description, priority, category_id, tags, interval_type, interval_day } = req.body;

  try {
    if (!name || !title) {
      return res.status(400).json({ error: 'name and title are required' });
    }

    if (!['daily', 'weekly', 'monthly'].includes(interval_type)) {
      return res.status(400).json({ error: "interval_type must be one of 'daily', 'weekly', 'monthly'" });
    }

    const id = uuidv4();
    const next_run = computeNextRun(interval_type, interval_day);
    const tagsJson = JSON.stringify(tags || []);

    db.prepare(`
      INSERT INTO recurring_templates (id, name, title, description, priority, category_id, tags, interval_type, interval_day, is_active, last_run, next_run)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)
    `).run(
      id,
      name,
      title,
      description || '',
      priority || 'medium',
      category_id || null,
      tagsJson,
      interval_type,
      interval_day ?? null,
      next_run
    );

    res.status(201).json({
      id,
      name,
      title,
      description: description || '',
      priority: priority || 'medium',
      category_id: category_id || null,
      tags: tags || [],
      interval_type,
      interval_day: interval_day ?? null,
      is_active: 1,
      last_run: null,
      next_run,
      history: []
    });
  } catch (error) {
    console.error('Error creating recurring template:', error);
    res.status(500).json({ error: 'Failed to create recurring template' });
  }
});

// PUT /api/recurring/:id — update a template
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { name, title, description, priority, category_id, tags, interval_type, interval_day, is_active } = req.body;

  try {
    const existing = db.prepare(
      'SELECT * FROM recurring_templates WHERE id = ?'
    ).get(req.params.id) as RecurringTemplateRow | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Recurring template not found' });
    }

    const newName = name !== undefined ? name : existing.name;
    const newTitle = title !== undefined ? title : existing.title;
    const newDescription = description !== undefined ? description : existing.description;
    const newPriority = priority !== undefined ? priority : existing.priority;
    const newCategoryId = category_id !== undefined ? (category_id || null) : existing.category_id;
    const newTagsJson = tags !== undefined ? JSON.stringify(tags) : existing.tags;
    const newIntervalType: 'daily' | 'weekly' | 'monthly' = interval_type !== undefined ? interval_type : existing.interval_type;
    const newIntervalDay = interval_day !== undefined ? interval_day : existing.interval_day;
    const newIsActive = is_active !== undefined ? is_active : existing.is_active;

    // Recompute next_run if interval changed, or if resuming from paused
    const intervalChanged = interval_type !== undefined || interval_day !== undefined;
    const resuming = is_active !== undefined && is_active === 1 && existing.is_active === 0;
    const newNextRun = (intervalChanged || resuming)
      ? computeNextRun(newIntervalType, newIntervalDay)
      : existing.next_run;

    db.prepare(`
      UPDATE recurring_templates
      SET name = ?, title = ?, description = ?, priority = ?, category_id = ?, tags = ?,
          interval_type = ?, interval_day = ?, is_active = ?, next_run = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      newName,
      newTitle,
      newDescription,
      newPriority,
      newCategoryId,
      newTagsJson,
      newIntervalType,
      newIntervalDay,
      newIsActive,
      newNextRun,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM recurring_templates WHERE id = ?').get(req.params.id) as RecurringTemplateRow;
    const history = db.prepare(`
      SELECT rth.id, rth.ticket_id, rth.created_at, tk.title AS ticket_title
      FROM recurring_ticket_history rth
      JOIN tickets tk ON tk.id = rth.ticket_id
      WHERE rth.template_id = ?
      ORDER BY rth.created_at DESC
      LIMIT 10
    `).all(req.params.id) as HistoryRow[];

    let parsedTags: string[] = [];
    try {
      parsedTags = JSON.parse(updated.tags || '[]');
    } catch {
      parsedTags = [];
    }

    res.json({ ...updated, tags: parsedTags, history });
  } catch (error) {
    console.error('Error updating recurring template:', error);
    res.status(500).json({ error: 'Failed to update recurring template' });
  }
});

// DELETE /api/recurring/:id — delete a template (cascades history)
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare(
      'SELECT id FROM recurring_templates WHERE id = ?'
    ).get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Recurring template not found' });
    }

    db.prepare('DELETE FROM recurring_templates WHERE id = ?').run(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting recurring template:', error);
    res.status(500).json({ error: 'Failed to delete recurring template' });
  }
});

// PATCH /api/recurring/:id/toggle — quick pause/resume toggle
router.patch('/:id/toggle', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare(
      'SELECT id, is_active, interval_type, interval_day FROM recurring_templates WHERE id = ?'
    ).get(req.params.id) as Pick<RecurringTemplateRow, 'id' | 'is_active' | 'interval_type' | 'interval_day'> | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Recurring template not found' });
    }

    const new_active = existing.is_active ? 0 : 1;
    const newNextRun = new_active === 1
      ? computeNextRun(existing.interval_type, existing.interval_day)
      : undefined;

    if (newNextRun !== undefined) {
      db.prepare(`
        UPDATE recurring_templates SET is_active = ?, next_run = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(new_active, newNextRun, req.params.id);
    } else {
      db.prepare(`
        UPDATE recurring_templates SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(new_active, req.params.id);
    }

    const updatedNextRun = newNextRun
      ?? (db.prepare('SELECT next_run FROM recurring_templates WHERE id = ?').get(req.params.id) as { next_run: string }).next_run;

    res.json({ id: req.params.id, is_active: new_active, next_run: updatedNextRun });
  } catch (error) {
    console.error('Error toggling recurring template:', error);
    res.status(500).json({ error: 'Failed to toggle recurring template' });
  }
});

export default router;
