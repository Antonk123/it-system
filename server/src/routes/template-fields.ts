import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

interface TemplateFieldRow {
  id: string;
  template_id: string;
  field_name: string;
  field_label: string;
  field_type: string;
  placeholder: string | null;
  default_value: string | null;
  required: number;
  options: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

// GET /api/templates/:templateId/fields
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { templateId } = req.params;
    const fields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(templateId) as TemplateFieldRow[];
    res.json(fields);
  } catch (error) {
    console.error('Error fetching template fields:', error);
    res.status(500).json({ error: 'Failed to fetch template fields' });
  }
});

// POST /api/templates/:templateId/fields
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { templateId } = req.params;
    const { field_name, field_label, field_type, placeholder, default_value, required, options } = req.body;

    if (!field_name || !field_label || !field_type) {
      return res.status(400).json({ error: 'field_name, field_label, and field_type are required' });
    }

    const id = randomUUID();
    const maxPosition = db.prepare('SELECT MAX(position) as max FROM template_fields WHERE template_id = ?').get(templateId) as { max: number | null };
    const position = (maxPosition?.max ?? -1) + 1;

    db.prepare(`
      INSERT INTO template_fields (id, template_id, field_name, field_label, field_type, placeholder, default_value, required, options, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, templateId, field_name, field_label, field_type, placeholder || null, default_value || null, required ? 1 : 0, options ? JSON.stringify(options) : null, position);

    const field = db.prepare('SELECT * FROM template_fields WHERE id = ?').get(id) as TemplateFieldRow;
    res.status(201).json(field);
  } catch (error) {
    console.error('Error creating template field:', error);
    res.status(500).json({ error: 'Failed to create template field' });
  }
});

// PUT /api/templates/:templateId/fields/:fieldId
router.put('/:fieldId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { fieldId } = req.params;
    const { field_name, field_label, field_type, placeholder, default_value, required, options } = req.body;

    const existing = db.prepare('SELECT * FROM template_fields WHERE id = ?').get(fieldId) as TemplateFieldRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Template field not found' });
    }

    db.prepare(`
      UPDATE template_fields
      SET field_name = ?, field_label = ?, field_type = ?, placeholder = ?, default_value = ?, required = ?, options = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      field_name ?? existing.field_name,
      field_label ?? existing.field_label,
      field_type ?? existing.field_type,
      placeholder ?? existing.placeholder,
      default_value ?? existing.default_value,
      required !== undefined ? (required ? 1 : 0) : existing.required,
      options ? JSON.stringify(options) : existing.options,
      fieldId
    );

    const field = db.prepare('SELECT * FROM template_fields WHERE id = ?').get(fieldId) as TemplateFieldRow;
    res.json(field);
  } catch (error) {
    console.error('Error updating template field:', error);
    res.status(500).json({ error: 'Failed to update template field' });
  }
});

// DELETE /api/templates/:templateId/fields/:fieldId
router.delete('/:fieldId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM template_fields WHERE id = ?').run(req.params.fieldId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Template field not found' });
    }
    res.json({ message: 'Template field deleted' });
  } catch (error) {
    console.error('Error deleting template field:', error);
    res.status(500).json({ error: 'Failed to delete template field' });
  }
});

// PUT /api/templates/:templateId/fields/reorder
router.put('/reorder', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const updateStmt = db.prepare('UPDATE template_fields SET position = ? WHERE id = ?');
    const transaction = db.transaction((fieldIds: string[]) => {
      fieldIds.forEach((id, index) => {
        updateStmt.run(index, id);
      });
    });

    transaction(ids);

    const fields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(req.params.templateId) as TemplateFieldRow[];
    res.json(fields);
  } catch (error) {
    console.error('Error reordering template fields:', error);
    res.status(500).json({ error: 'Failed to reorder template fields' });
  }
});

export default router;
