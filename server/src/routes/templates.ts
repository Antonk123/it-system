import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import templateFieldsRouter from './template-fields.js';

const router = Router();

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  title_template: string;
  description_template: string;
  priority: string;
  category_id: string | null;
  notes_template: string | null;
  solution_template: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// GET /api/templates - Get all templates (with fields)
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const templates = db.prepare('SELECT * FROM ticket_templates ORDER BY position ASC, name ASC').all() as TemplateRow[];
    const templatesWithFields = templates.map(template => {
      const fields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(template.id);
      return { ...template, fields };
    });
    res.json(templatesWithFields);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// GET /api/templates/:id - Get single template with fields
router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const template = db.prepare('SELECT * FROM ticket_templates WHERE id = ?').get(req.params.id) as TemplateRow | undefined;
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const fields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(req.params.id);

    res.json({ ...template, fields });
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// POST /api/templates - Create new template
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  const { name, description, title_template, description_template, priority, category_id, notes_template, solution_template } = req.body;

  try {
    // Validate required fields
    if (!name || !title_template || !description_template) {
      return res.status(400).json({ error: 'Name, title_template, and description_template are required' });
    }

    const id = uuidv4();
    const maxPosition = db.prepare('SELECT MAX(position) as max FROM ticket_templates').get() as { max: number | null };
    const position = (maxPosition.max ?? -1) + 1;

    db.prepare(`
      INSERT INTO ticket_templates (id, name, description, title_template, description_template, priority, category_id, notes_template, solution_template, position, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      description || null,
      title_template,
      description_template,
      priority || 'medium',
      category_id || null,
      notes_template || null,
      solution_template || null,
      position,
      req.user?.id || null
    );

    const template = db.prepare('SELECT * FROM ticket_templates WHERE id = ?').get(id) as TemplateRow;
    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT /api/templates/:id - Update template
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { name, description, title_template, description_template, priority, category_id, notes_template, solution_template } = req.body;

  try {
    const existing = db.prepare('SELECT * FROM ticket_templates WHERE id = ?').get(req.params.id) as TemplateRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }

    db.prepare(`
      UPDATE ticket_templates
      SET name = ?, description = ?, title_template = ?, description_template = ?, priority = ?, category_id = ?, notes_template = ?, solution_template = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ?? existing.name,
      description ?? existing.description,
      title_template ?? existing.title_template,
      description_template ?? existing.description_template,
      priority ?? existing.priority,
      category_id ?? existing.category_id,
      notes_template ?? existing.notes_template,
      solution_template ?? existing.solution_template,
      req.params.id
    );

    const template = db.prepare('SELECT * FROM ticket_templates WHERE id = ?').get(req.params.id) as TemplateRow;
    res.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// PUT /api/templates/reorder - Reorder templates
router.put('/reorder', authenticate, (req: AuthRequest, res: Response) => {
  const { ids } = req.body as { ids: string[] };

  try {
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const updateStmt = db.prepare('UPDATE ticket_templates SET position = ? WHERE id = ?');
    const transaction = db.transaction((templateIds: string[]) => {
      templateIds.forEach((id, index) => {
        updateStmt.run(index, id);
      });
    });

    transaction(ids);

    const templates = db.prepare('SELECT * FROM ticket_templates ORDER BY position ASC').all() as TemplateRow[];
    res.json(templates);
  } catch (error) {
    console.error('Error reordering templates:', error);
    res.status(500).json({ error: 'Failed to reorder templates' });
  }
});

// DELETE /api/templates/:id - Delete template
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM ticket_templates WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ message: 'Template deleted' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Mount field routes
router.use('/:templateId/fields', templateFieldsRouter);

export default router;
