import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

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
    const categories = db.prepare('SELECT * FROM categories ORDER BY position ASC, created_at ASC').all() as CategoryRow[];
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create category
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  const { label } = req.body;

  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    return res.status(400).json({ error: 'Label is required' });
  }

  try {
    const id = uuidv4();
    const name = label.toLowerCase().replace(/\s+/g, '-');
    
    const maxRow = db.prepare('SELECT COALESCE(MAX(position), -1) as max FROM categories').get() as { max: number };
    const position = (maxRow?.max ?? -1) + 1;

    db.prepare('INSERT INTO categories (id, name, label, position) VALUES (?, ?, ?, ?)').run(id, name, label.trim(), position);
    
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow;
    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Reorder categories
router.put('/reorder', authenticate, (req: AuthRequest, res: Response) => {
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

    const categories = db.prepare('SELECT * FROM categories ORDER BY position ASC, created_at ASC').all() as CategoryRow[];
    res.json(categories);
  } catch (error) {
    console.error('Error reordering categories:', error);
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
});

// Update category
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { label } = req.body;

  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    return res.status(400).json({ error: 'Label is required' });
  }

  try {
    const name = label.toLowerCase().replace(/\s+/g, '-');
    const result = db.prepare('UPDATE categories SET name = ?, label = ? WHERE id = ?').run(name, label.trim(), req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id) as CategoryRow;
    res.json(category);
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    res.json({ message: 'Category deleted' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
