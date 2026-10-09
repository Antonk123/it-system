import { Router, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import { logAudit } from '../lib/auditLog.js';
import { sanitizeLabel } from '../lib/ticketValidation.js';

const router = Router();

const MAX_LABEL_LENGTH = 100;

interface CategoryRow {
  id: string;
  name: string;
  label: string;
  position: number;
  created_at: string;
}

// Get all categories
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const categories = db.prepare('SELECT id, name, label, position, created_at FROM categories ORDER BY position ASC, created_at ASC').all() as CategoryRow[];
    res.json(categories);
  } catch (error) {
    logger.error('Error fetching categories:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create category
router.post('/', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const label = sanitizeLabel(req.body.label, MAX_LABEL_LENGTH);

  if (!label) {
    return res.status(400).json({ error: 'Label is required (max 100 characters)' });
  }

  try {
    const id = randomUUID();
    const name = label.toLowerCase().replace(/\s+/g, '-');
    
    const maxRow = db.prepare('SELECT COALESCE(MAX(position), -1) as max FROM categories').get() as { max: number };
    const position = (maxRow?.max ?? -1) + 1;

    db.prepare('INSERT INTO categories (id, name, label, position) VALUES (?, ?, ?, ?)').run(id, name, label, position);
    
    const category = db.prepare('SELECT id, name, label, position, created_at FROM categories WHERE id = ?').get(id) as CategoryRow;
    res.status(201).json(category);
  } catch (error) {
    logger.error('Error creating category:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Reorder categories
router.put('/reorder', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { ids } = req.body as { ids?: string[] };

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required' });
  }

  try {
    const updateStmt = db.prepare('UPDATE categories SET position = ? WHERE id = ?');
    const transaction = db.transaction((categoryIds: string[]) => {
      categoryIds.forEach((id, index) => {
        updateStmt.run(index, id);
      });
    });

    transaction(ids);

    const categories = db.prepare('SELECT id, name, label, position, created_at FROM categories ORDER BY position ASC, created_at ASC').all() as CategoryRow[];
    res.json(categories);
  } catch (error) {
    logger.error('Error reordering categories:', { error: String(error) });
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
});

// Update category
router.put('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const label = sanitizeLabel(req.body.label, MAX_LABEL_LENGTH);

  if (!label) {
    return res.status(400).json({ error: 'Label is required (max 100 characters)' });
  }

  try {
    const name = label.toLowerCase().replace(/\s+/g, '-');
    const result = db.prepare('UPDATE categories SET name = ?, label = ? WHERE id = ?').run(name, label, req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    const category = db.prepare('SELECT id, name, label, position, created_at FROM categories WHERE id = ?').get(req.params.id) as CategoryRow;
    res.json(category);
  } catch (error) {
    logger.error('Error updating category:', { error: String(error) });
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    logAudit(req.user!.id, 'category_delete', 'category', req.params.id, null, req.ip, req.apiKey?.id ?? null);

    res.json({ message: 'Category deleted' });
  } catch (error) {
    logger.error('Error deleting category:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
