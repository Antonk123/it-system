import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import templateFieldsRouter from './template-fields.js';
import { logger } from '../lib/logger.js';

const router = Router();

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  template_type: string;
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
    const templates = db.prepare(
      'SELECT id, name, description, title_template, description_template, priority, category_id, notes_template, solution_template, position, created_by, created_at, updated_at, template_type FROM ticket_templates ORDER BY position ASC, name ASC'
    ).all() as TemplateRow[];
    const allFields = db.prepare(
      'SELECT id, template_id, field_name, field_label, field_type, placeholder, default_value, required, options, position, created_at, updated_at FROM template_fields ORDER BY position ASC'
    ).all() as (Record<string, unknown> & { template_id: string })[];

    // Group fields by template_id in memory (fixes N+1)
    const fieldsByTemplate = new Map<string, typeof allFields>();
    for (const field of allFields) {
      const list = fieldsByTemplate.get(field.template_id) || [];
      list.push(field);
      fieldsByTemplate.set(field.template_id, list);
    }

    const templatesWithFields = templates.map(template => ({
      ...template,
      fields: fieldsByTemplate.get(template.id) || [],
    }));
    res.json(templatesWithFields);
  } catch (error) {
    logger.error('Error fetching templates:', { error: String(error) });
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
    logger.error('Error fetching template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// POST /api/templates - Create new template
router.post('/', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { name, description, template_type, title_template, description_template, priority, category_id, notes_template, solution_template, fields } = req.body;

  try {
    const templateType = template_type || 'standard';

    // Validate required fields
    if (!name || !title_template) {
      return res.status(400).json({ error: 'Name and title_template are required' });
    }

    // For standard templates, description_template is required
    if (templateType === 'standard' && !description_template) {
      return res.status(400).json({ error: 'description_template is required for standard templates' });
    }

    const id = uuidv4();
    const maxPosition = db.prepare('SELECT MAX(position) as max FROM ticket_templates').get() as { max: number | null };
    const position = (maxPosition.max ?? -1) + 1;

    db.prepare(`
      INSERT INTO ticket_templates (id, name, description, template_type, title_template, description_template, priority, category_id, notes_template, solution_template, position, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      description || null,
      templateType,
      title_template,
      description_template || null,
      priority || 'medium',
      category_id || null,
      notes_template || null,
      solution_template || null,
      position,
      req.user?.id || null
    );

    // If dynamic template with fields, create fields inline
    if (templateType === 'dynamic' && fields && Array.isArray(fields)) {
      const insertFieldStmt = db.prepare(`
        INSERT INTO template_fields (id, template_id, field_name, field_label, field_type, placeholder, default_value, required, options, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const field of fields) {
        insertFieldStmt.run(
          uuidv4(),
          id,
          field.field_name,
          field.field_label,
          field.field_type,
          field.placeholder || null,
          field.default_value || null,
          field.required ? 1 : 0,
          field.options || null,
          field.position || 0
        );
      }
    }

    const template = db.prepare('SELECT * FROM ticket_templates WHERE id = ?').get(id) as TemplateRow;
    const templateFields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(id);
    res.status(201).json({ ...template, fields: templateFields });
  } catch (error) {
    logger.error('Error creating template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT /api/templates/:id - Update template
router.put('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { name, description, template_type, title_template, description_template, priority, category_id, notes_template, solution_template } = req.body;

  try {
    const existing = db.prepare('SELECT * FROM ticket_templates WHERE id = ?').get(req.params.id) as TemplateRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }

    db.prepare(`
      UPDATE ticket_templates
      SET name = ?, description = ?, template_type = ?, title_template = ?, description_template = ?, priority = ?, category_id = ?, notes_template = ?, solution_template = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ?? existing.name,
      description ?? existing.description,
      template_type ?? existing.template_type,
      title_template ?? existing.title_template,
      description_template ?? existing.description_template,
      priority ?? existing.priority,
      category_id ?? existing.category_id,
      notes_template ?? existing.notes_template,
      solution_template ?? existing.solution_template,
      req.params.id
    );

    const template = db.prepare('SELECT * FROM ticket_templates WHERE id = ?').get(req.params.id) as TemplateRow;
    const templateFields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(req.params.id);
    res.json({ ...template, fields: templateFields });
  } catch (error) {
    logger.error('Error updating template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// PUT /api/templates/reorder - Reorder templates
router.put('/reorder', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
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
    logger.error('Error reordering templates:', { error: String(error) });
    res.status(500).json({ error: 'Failed to reorder templates' });
  }
});

// DELETE /api/templates/:id - Delete template
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM ticket_templates WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ message: 'Template deleted' });
  } catch (error) {
    logger.error('Error deleting template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Mount field routes
router.use('/:templateId/fields', templateFieldsRouter);

export default router;
