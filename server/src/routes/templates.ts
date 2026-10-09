import { Router, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import templateFieldsRouter, { parseTemplateField, type TemplateFieldInput } from './template-fields.js';
import { logger } from '../lib/logger.js';
import { logAudit } from '../lib/auditLog.js';
import { VALID_PRIORITIES } from '../lib/ticketQuery.js';

const router = Router();

// Tillåtna malltyper (template_type saknar CHECK i schemat, så koden är källan).
const TEMPLATE_TYPES = ['standard', 'dynamic'];

const TEXT_FIELDS = ['description', 'description_template', 'notes_template', 'solution_template'] as const;

// Validerar de fält som faktiskt skickats (undefined = rör inte). Returnerar
// felmeddelande eller null.
function validateTemplateInput(body: Record<string, unknown>): string | null {
  const { name, title_template, template_type, priority, category_id } = body;
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) return 'name must be a non-empty string';
  if (title_template !== undefined && (typeof title_template !== 'string' || !title_template.trim())) {
    return 'title_template must be a non-empty string';
  }
  for (const field of TEXT_FIELDS) {
    if (body[field] != null && typeof body[field] !== 'string') return `${field} must be a string`;
  }
  if (template_type !== undefined && (typeof template_type !== 'string' || !TEMPLATE_TYPES.includes(template_type))) {
    return `template_type must be one of: ${TEMPLATE_TYPES.join(', ')}`;
  }
  if (priority !== undefined && priority !== null && (typeof priority !== 'string' || !VALID_PRIORITIES.includes(priority))) {
    return 'Invalid priority value';
  }
  if (category_id) {
    if (typeof category_id !== 'string' || !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) {
      return 'Ogiltig category_id: kategorin finns inte';
    }
  }
  return null;
}

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

    const inputError = validateTemplateInput({ ...req.body, template_type: templateType });
    if (inputError) {
      return res.status(400).json({ error: inputError });
    }

    // For standard templates, description_template is required
    if (templateType === 'standard' && !description_template) {
      return res.status(400).json({ error: 'description_template is required for standard templates' });
    }

    // Inline-fält valideras före transaktionen så att ett felaktigt fält inte lämnar en halv mall.
    const parsedFields: TemplateFieldInput[] = [];
    if (templateType === 'dynamic' && Array.isArray(fields)) {
      for (const field of fields) {
        const parsed = parseTemplateField(field && typeof field === 'object' ? field : {});
        if ('error' in parsed) {
          return res.status(400).json({ error: parsed.error });
        }
        parsedFields.push(parsed.value);
      }
    }

    const id = randomUUID();
    const insertTemplate = db.transaction(() => {
      const maxPosition = db.prepare('SELECT MAX(position) as max FROM ticket_templates').get() as { max: number | null };
      const position = (maxPosition.max ?? -1) + 1;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO ticket_templates (id, name, description, template_type, title_template, description_template, priority, category_id, notes_template, solution_template, position, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name.trim(),
        description || null,
        templateType,
        title_template.trim(),
        // Kolumnen är NOT NULL; dynamiska mallar komponerar beskrivningen från fält → tom sträng
        description_template || '',
        priority || 'medium',
        category_id || null,
        notes_template || null,
        solution_template || null,
        position,
        req.user?.id || null,
        now,
        now
      );

      const insertFieldStmt = db.prepare(`
        INSERT INTO template_fields (id, template_id, field_name, field_label, field_type, placeholder, default_value, required, options, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      parsedFields.forEach((field, index) => {
        insertFieldStmt.run(randomUUID(), id, field.field_name, field.field_label, field.field_type, field.placeholder, field.default_value, field.required, field.options, index, now, now);
      });
    });
    insertTemplate();

    const template = db.prepare('SELECT * FROM ticket_templates WHERE id = ?').get(id) as TemplateRow;
    const templateFields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(id);
    res.status(201).json({ ...template, fields: templateFields });
  } catch (error) {
    if ((error as Error).message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A template with that name already exists' });
    }
    logger.error('Error creating template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT /api/templates/reorder - Reorder templates (måste stå FÖRE /:id annars fångas 'reorder' av :id)
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

// PUT /api/templates/:id - Update template
router.put('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { name, description, template_type, title_template, description_template, priority, category_id, notes_template, solution_template } = req.body;

  try {
    const inputError = validateTemplateInput(req.body);
    if (inputError) {
      return res.status(400).json({ error: inputError });
    }

    const existing = db.prepare('SELECT * FROM ticket_templates WHERE id = ?').get(req.params.id) as TemplateRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }

    db.prepare(`
      UPDATE ticket_templates
      SET name = ?, description = ?, template_type = ?, title_template = ?, description_template = ?, priority = ?, category_id = ?, notes_template = ?, solution_template = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name?.trim() ?? existing.name,
      description ?? existing.description,
      template_type ?? existing.template_type,
      title_template?.trim() ?? existing.title_template,
      description_template ?? existing.description_template,
      priority ?? existing.priority,
      category_id !== undefined ? category_id || null : existing.category_id,
      notes_template ?? existing.notes_template,
      solution_template ?? existing.solution_template,
      new Date().toISOString(),
      req.params.id
    );

    const template = db.prepare('SELECT * FROM ticket_templates WHERE id = ?').get(req.params.id) as TemplateRow;
    const templateFields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(req.params.id);
    res.json({ ...template, fields: templateFields });
  } catch (error) {
    if ((error as Error).message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A template with that name already exists' });
    }
    logger.error('Error updating template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// DELETE /api/templates/:id - Delete template
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT name FROM ticket_templates WHERE id = ?').get(req.params.id) as { name: string } | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }

    db.prepare('DELETE FROM ticket_templates WHERE id = ?').run(req.params.id);
    logAudit(req.user!.id, 'template_delete', 'ticket_template', req.params.id, `name: ${existing.name}`, req.ip, req.apiKey?.id ?? null);

    res.json({ message: 'Template deleted' });
  } catch (error) {
    logger.error('Error deleting template:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Mount field routes
router.use('/:templateId/fields', templateFieldsRouter);

export default router;
