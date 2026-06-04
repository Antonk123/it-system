import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

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
  const { name, color } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const id = uuidv4();
    const tagColor = color || '#3b82f6';

    db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(
      id,
      name.trim(),
      tagColor
    );

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
  const { name, color } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const result = db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(
      name.trim(),
      color || '#3b82f6',
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
