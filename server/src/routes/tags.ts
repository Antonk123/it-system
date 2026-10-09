import { Router, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import { sanitizeLabel } from '../lib/ticketValidation.js';

const router = Router();

const MAX_NAME_LENGTH = 100;
const DEFAULT_TAG_COLOR = '#3b82f6';
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Validerar { name, color } från request-body. Namnet saneras och trimmas;
// färg utelämnad/tom ger standardfärgen, annars krävs #rrggbb.
function parseTagInput(body: { name?: unknown; color?: unknown }): { name: string; color: string } | { error: string } {
  const { name, color } = body;
  const cleanName = sanitizeLabel(name, MAX_NAME_LENGTH);
  if (!cleanName) return { error: 'Name is required (max 100 characters)' };
  if (color == null || color === '') return { name: cleanName, color: DEFAULT_TAG_COLOR };
  if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) {
    return { error: 'Color must be a hex value like #3b82f6' };
  }
  return { name: cleanName, color };
}

interface TagRow {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

// Get all tags
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const tags = db.prepare('SELECT * FROM tags ORDER BY name ASC').all() as TagRow[];
    res.json(tags);
  } catch (error) {
    logger.error('Error fetching tags:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// Create tag
router.post('/', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const input = parseTagInput(req.body);
  if ('error' in input) {
    return res.status(400).json({ error: input.error });
  }

  try {
    const id = randomUUID();

    db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(id, input.name, input.color, new Date().toISOString());

    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow;
    res.status(201).json(tag);
  } catch (error) {
    logger.error('Error creating tag:', { error: String(error) });
    if ((error as any).message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Tag name already exists' });
    }
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

// Update tag
router.put('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const input = parseTagInput(req.body);
  if ('error' in input) {
    return res.status(400).json({ error: input.error });
  }

  try {
    const result = db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(
      input.name,
      input.color,
      req.params.id
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id) as TagRow;
    res.json(tag);
  } catch (error) {
    logger.error('Error updating tag:', { error: String(error) });
    if ((error as any).message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Tag name already exists' });
    }
    res.status(500).json({ error: 'Failed to update tag' });
  }
});

// Delete tag
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    if (db.prepare('SELECT 1 FROM ticket_tags WHERE tag_id = ? LIMIT 1').get(req.params.id)) {
      return res.status(409).json({ error: 'Taggen finns i sparad ärendehistorik och kan inte tas bort' });
    }
    // Recurring templates store historical tag IDs as JSON (no separate join table).
    const recurringHistory = db.prepare(`SELECT 1 FROM recurring_templates rt, json_each(
      CASE WHEN json_valid(rt.tags) THEN rt.tags ELSE '[]' END
    ) tag WHERE tag.value = ? LIMIT 1`).get(req.params.id);
    if (recurringHistory) {
      return res.status(409).json({ error: 'Taggen finns i sparad mallhistorik och kan inte tas bort' });
    }

    const result = db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    res.json({ message: 'Tag deleted' });
  } catch (error) {
    logger.error('Error deleting tag:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

export default router;
