import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

interface KbCategoryRow {
  id: string;
  name: string;
  color: string | null;
  position: number;
  created_at: string;
}

interface KbArticleRow {
  id: string;
  title: string;
  content: string;
  category_id: string | null;
  category_name?: string | null;
  category_color?: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Categories ───────────────────────────────────────────────────────────────

// GET /api/kb/categories
router.get('/categories', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const categories = db.prepare(
      'SELECT id, name, color, position, created_at FROM kb_categories ORDER BY position ASC, name ASC'
    ).all() as KbCategoryRow[];
    res.json(categories);
  } catch (error) {
    console.error('Error fetching KB categories:', error);
    res.status(500).json({ error: 'Failed to fetch KB categories' });
  }
});

// POST /api/kb/categories
router.post('/categories', authenticate, (req: AuthRequest, res: Response) => {
  const { name, color } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const id = uuidv4();
    const now = new Date().toISOString();
    const maxPos = (db.prepare('SELECT MAX(position) as m FROM kb_categories').get() as { m: number | null }).m ?? -1;
    db.prepare(
      'INSERT INTO kb_categories (id, name, color, position, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name.trim(), color || null, maxPos + 1, now);
    const category = db.prepare('SELECT id, name, color, position, created_at FROM kb_categories WHERE id = ?').get(id) as KbCategoryRow;
    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating KB category:', error);
    res.status(500).json({ error: 'Failed to create KB category' });
  }
});

// PUT /api/kb/categories/:id
router.put('/categories/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { name, color } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const existing = db.prepare('SELECT id FROM kb_categories WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    db.prepare('UPDATE kb_categories SET name = ?, color = ? WHERE id = ?')
      .run(name.trim(), color || null, req.params.id);
    const category = db.prepare('SELECT id, name, color, position, created_at FROM kb_categories WHERE id = ?').get(req.params.id) as KbCategoryRow;
    res.json(category);
  } catch (error) {
    console.error('Error updating KB category:', error);
    res.status(500).json({ error: 'Failed to update KB category' });
  }
});

// DELETE /api/kb/categories/:id
router.delete('/categories/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT id FROM kb_categories WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    db.prepare('DELETE FROM kb_categories WHERE id = ?').run(req.params.id);
    res.json({ message: 'Category deleted' });
  } catch (error) {
    console.error('Error deleting KB category:', error);
    res.status(500).json({ error: 'Failed to delete KB category' });
  }
});

// ─── Articles ─────────────────────────────────────────────────────────────────

// GET /api/kb/articles?search=&category_id=
router.get('/articles', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { search, category_id } = req.query as Record<string, string>;

    let query = `
      SELECT
        a.id, a.title, a.content, a.category_id, a.created_at, a.updated_at,
        c.name as category_name, c.color as category_color
      FROM kb_articles a
      LEFT JOIN kb_categories c ON a.category_id = c.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (search) {
      query += ' AND (a.title LIKE ? OR a.content LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (category_id) {
      query += ' AND a.category_id = ?';
      params.push(category_id);
    }

    query += ' ORDER BY a.updated_at DESC';

    const articles = db.prepare(query).all(...params) as KbArticleRow[];
    res.json(articles);
  } catch (error) {
    console.error('Error fetching KB articles:', error);
    res.status(500).json({ error: 'Failed to fetch KB articles' });
  }
});

// GET /api/kb/articles/:id
router.get('/articles/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const article = db.prepare(`
      SELECT
        a.id, a.title, a.content, a.category_id, a.created_at, a.updated_at,
        c.name as category_name, c.color as category_color
      FROM kb_articles a
      LEFT JOIN kb_categories c ON a.category_id = c.id
      WHERE a.id = ?
    `).get(req.params.id) as KbArticleRow | undefined;

    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(article);
  } catch (error) {
    console.error('Error fetching KB article:', error);
    res.status(500).json({ error: 'Failed to fetch KB article' });
  }
});

// POST /api/kb/articles
router.post('/articles', authenticate, (req: AuthRequest, res: Response) => {
  const { title, content = '', category_id } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO kb_articles (id, title, content, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, title.trim(), content, category_id || null, now, now);

    const article = db.prepare(`
      SELECT a.id, a.title, a.content, a.category_id, a.created_at, a.updated_at,
        c.name as category_name, c.color as category_color
      FROM kb_articles a
      LEFT JOIN kb_categories c ON a.category_id = c.id
      WHERE a.id = ?
    `).get(id) as KbArticleRow;

    res.status(201).json(article);
  } catch (error) {
    console.error('Error creating KB article:', error);
    res.status(500).json({ error: 'Failed to create KB article' });
  }
});

// PUT /api/kb/articles/:id
router.put('/articles/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { title, content, category_id } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    const existing = db.prepare('SELECT id FROM kb_articles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Article not found' });

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE kb_articles SET title = ?, content = ?, category_id = ?, updated_at = ? WHERE id = ?'
    ).run(title.trim(), content ?? '', category_id || null, now, req.params.id);

    const article = db.prepare(`
      SELECT a.id, a.title, a.content, a.category_id, a.created_at, a.updated_at,
        c.name as category_name, c.color as category_color
      FROM kb_articles a
      LEFT JOIN kb_categories c ON a.category_id = c.id
      WHERE a.id = ?
    `).get(req.params.id) as KbArticleRow;

    res.json(article);
  } catch (error) {
    console.error('Error updating KB article:', error);
    res.status(500).json({ error: 'Failed to update KB article' });
  }
});

// DELETE /api/kb/articles/:id
router.delete('/articles/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT id FROM kb_articles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Article not found' });
    db.prepare('DELETE FROM kb_articles WHERE id = ?').run(req.params.id);
    res.json({ message: 'Article deleted' });
  } catch (error) {
    console.error('Error deleting KB article:', error);
    res.status(500).json({ error: 'Failed to delete KB article' });
  }
});

// ─── Ticket KB Links ───────────────────────────────────────────────────────────

// GET /api/kb/ticket/:ticketId
router.get('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const articles = db.prepare(`
      SELECT
        a.id, a.title, a.content, a.category_id, a.created_at, a.updated_at,
        c.name as category_name, c.color as category_color,
        tkl.id as link_id
      FROM ticket_kb_links tkl
      JOIN kb_articles a ON tkl.article_id = a.id
      LEFT JOIN kb_categories c ON a.category_id = c.id
      WHERE tkl.ticket_id = ?
      ORDER BY tkl.created_at DESC
    `).all(req.params.ticketId);
    res.json(articles);
  } catch (error) {
    console.error('Error fetching ticket KB links:', error);
    res.status(500).json({ error: 'Failed to fetch ticket KB links' });
  }
});

// POST /api/kb/ticket/:ticketId
router.post('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  const { articleId } = req.body;
  if (!articleId) return res.status(400).json({ error: 'articleId is required' });
  try {
    const article = db.prepare('SELECT id FROM kb_articles WHERE id = ?').get(articleId);
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO ticket_kb_links (id, ticket_id, article_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, req.params.ticketId, articleId, now);

    res.status(201).json({ id, ticket_id: req.params.ticketId, article_id: articleId, created_at: now });
  } catch (error: any) {
    if (error?.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Article already linked to this ticket' });
    }
    console.error('Error linking KB article to ticket:', error);
    res.status(500).json({ error: 'Failed to link KB article' });
  }
});

// DELETE /api/kb/ticket/:ticketId/:articleId
router.delete('/ticket/:ticketId/:articleId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const link = db.prepare(
      'SELECT id FROM ticket_kb_links WHERE ticket_id = ? AND article_id = ?'
    ).get(req.params.ticketId, req.params.articleId);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    db.prepare('DELETE FROM ticket_kb_links WHERE ticket_id = ? AND article_id = ?')
      .run(req.params.ticketId, req.params.articleId);
    res.json({ message: 'Link removed' });
  } catch (error) {
    console.error('Error removing KB link:', error);
    res.status(500).json({ error: 'Failed to remove KB link' });
  }
});

export default router;
