import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

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

// Tillåtna fälttyper — speglar CHECK-villkoret på template_fields.field_type.
const FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'date', 'checkbox'];

export interface TemplateFieldInput {
  field_name: string;
  field_label: string;
  field_type: string;
  placeholder: string | null;
  default_value: string | null;
  required: number;
  options: string | null;
}

const isOptionalText = (value: unknown): value is string | null | undefined =>
  value == null || typeof value === 'string';

/**
 * Validerar ett fält från request-body. Utan `existing` (skapa) krävs
 * field_name/field_label/field_type; med `existing` (uppdatera) ärvs
 * utelämnade (undefined) värden. `options` tas emot som array (lagras som JSON)
 * eller null. Delas med POST /api/templates (inline-fält).
 */
export function parseTemplateField(
  body: Record<string, unknown>,
  existing?: TemplateFieldRow,
): { value: TemplateFieldInput } | { error: string } {
  const { field_name, field_label, field_type, placeholder, default_value, required, options } = body;

  const name = field_name ?? existing?.field_name;
  const label = field_label ?? existing?.field_label;
  const type = field_type ?? existing?.field_type;
  if (typeof name !== 'string' || !name.trim() || typeof label !== 'string' || !label.trim() || typeof type !== 'string') {
    return { error: 'field_name, field_label, and field_type are required' };
  }
  if (!FIELD_TYPES.includes(type)) {
    return { error: `field_type must be one of: ${FIELD_TYPES.join(', ')}` };
  }
  if (!isOptionalText(placeholder) || !isOptionalText(default_value)) {
    return { error: 'placeholder and default_value must be strings' };
  }
  if (options != null && (!Array.isArray(options) || options.some((o) => typeof o !== 'string'))) {
    return { error: 'options must be an array of strings' };
  }

  return {
    value: {
      field_name: name.trim(),
      field_label: label.trim(),
      field_type: type,
      placeholder: placeholder !== undefined ? placeholder || null : existing?.placeholder ?? null,
      default_value: default_value !== undefined ? default_value || null : existing?.default_value ?? null,
      required: required !== undefined ? (required ? 1 : 0) : existing?.required ?? 0,
      options: options !== undefined ? (options ? JSON.stringify(options) : null) : existing?.options ?? null,
    },
  };
}

// GET /api/templates/:templateId/fields
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { templateId } = req.params;
    const fields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(templateId) as TemplateFieldRow[];
    res.json(fields);
  } catch (error) {
    logger.error('Error fetching template fields:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch template fields' });
  }
});

// POST /api/templates/:templateId/fields
router.post('/', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { templateId } = req.params;
    const parsed = parseTemplateField(req.body);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const { field_name, field_label, field_type, placeholder, default_value, required, options } = parsed.value;

    if (!db.prepare('SELECT 1 FROM ticket_templates WHERE id = ?').get(templateId)) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const id = randomUUID();
    const maxPosition = db.prepare('SELECT MAX(position) as max FROM template_fields WHERE template_id = ?').get(templateId) as { max: number | null };
    const position = (maxPosition?.max ?? -1) + 1;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO template_fields (id, template_id, field_name, field_label, field_type, placeholder, default_value, required, options, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, templateId, field_name, field_label, field_type, placeholder, default_value, required, options, position, now, now);

    const field = db.prepare('SELECT * FROM template_fields WHERE id = ?').get(id) as TemplateFieldRow;
    res.status(201).json(field);
  } catch (error) {
    logger.error('Error creating template field:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create template field' });
  }
});

// PUT /api/templates/:templateId/fields/reorder
// IMPORTANT: This route must come BEFORE /:fieldId to prevent Express from matching "reorder" as a fieldId
router.put('/reorder', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const updateStmt = db.prepare('UPDATE template_fields SET position = ? WHERE id = ? AND template_id = ?');
    const transaction = db.transaction((fieldIds: string[]) => {
      fieldIds.forEach((id, index) => {
        updateStmt.run(index, id, req.params.templateId);
      });
    });

    transaction(ids);

    const fields = db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(req.params.templateId) as TemplateFieldRow[];
    res.json(fields);
  } catch (error) {
    logger.error('Error reordering template fields:', { error: String(error) });
    res.status(500).json({ error: 'Failed to reorder template fields' });
  }
});

// PUT /api/templates/:templateId/fields/:fieldId
router.put('/:fieldId', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { templateId, fieldId } = req.params;

    // Fältet måste tillhöra mallen i URL:en.
    const existing = db.prepare('SELECT * FROM template_fields WHERE id = ? AND template_id = ?').get(fieldId, templateId) as TemplateFieldRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Template field not found' });
    }

    const parsed = parseTemplateField(req.body, existing);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const { field_name, field_label, field_type, placeholder, default_value, required, options } = parsed.value;

    db.prepare(`
      UPDATE template_fields
      SET field_name = ?, field_label = ?, field_type = ?, placeholder = ?, default_value = ?, required = ?, options = ?, updated_at = ?
      WHERE id = ? AND template_id = ?
    `).run(field_name, field_label, field_type, placeholder, default_value, required, options, new Date().toISOString(), fieldId, templateId);

    const field = db.prepare('SELECT * FROM template_fields WHERE id = ?').get(fieldId) as TemplateFieldRow;
    res.json(field);
  } catch (error) {
    logger.error('Error updating template field:', { error: String(error) });
    res.status(500).json({ error: 'Failed to update template field' });
  }
});

// DELETE /api/templates/:templateId/fields/:fieldId
router.delete('/:fieldId', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM template_fields WHERE id = ? AND template_id = ?').run(req.params.fieldId, req.params.templateId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Template field not found' });
    }
    res.json({ message: 'Template field deleted' });
  } catch (error) {
    logger.error('Error deleting template field:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete template field' });
  }
});

export default router;
