import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => { cb(null, UPLOAD_DIR); },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(2)}`;
    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
    cb(null, `kb-${uniqueSuffix}.${ext}`);
  },
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
    if (!IMAGE_MIME_TYPES.includes(file.mimetype) || !IMAGE_EXTENSIONS.includes(ext)) {
      return cb(new Error(`Only image files are allowed (jpeg, png, gif, webp).`));
    }
    cb(null, true);
  },
});

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  article_type?: string | null;
  snippet?: string | null;
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

// GET /api/kb/articles?search=&category_id=&article_type=
router.get('/articles', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { search, category_id, article_type } = req.query as Record<string, string>;
    const trimmedSearch = search?.trim();

    let articles: KbArticleRow[];

    if (trimmedSearch) {
      // FTS5 search: sanitize input to avoid injection via double-quoting
      const safeQuery = '"' + trimmedSearch.replace(/"/g, '""') + '"';
      articles = db.prepare(`
        SELECT
          a.id, a.title, a.content, a.category_id, a.article_type, a.created_at, a.updated_at,
          c.name as category_name, c.color as category_color,
          snippet(kb_articles_fts, 1, '<mark>', '</mark>', '...', 25) AS snippet
        FROM kb_articles_fts fts
        JOIN kb_articles a ON a.rowid = fts.rowid
        LEFT JOIN kb_categories c ON a.category_id = c.id
        WHERE kb_articles_fts MATCH @search
          AND (@category_id IS NULL OR a.category_id = @category_id)
          AND (@article_type IS NULL OR a.article_type = @article_type)
        ORDER BY rank
      `).all({ search: safeQuery, category_id: category_id || null, article_type: article_type || null }) as KbArticleRow[];
    } else {
      // No search: standard query with article_type filter support
      articles = db.prepare(`
        SELECT
          a.id, a.title, a.content, a.category_id, a.article_type, a.created_at, a.updated_at,
          c.name as category_name, c.color as category_color
        FROM kb_articles a
        LEFT JOIN kb_categories c ON a.category_id = c.id
        WHERE 1=1
          AND (@category_id IS NULL OR a.category_id = @category_id)
          AND (@article_type IS NULL OR a.article_type = @article_type)
        ORDER BY a.updated_at DESC
      `).all({ category_id: category_id || null, article_type: article_type || null }) as KbArticleRow[];
    }

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
        a.id, a.title, a.content, a.category_id, a.article_type, a.created_at, a.updated_at,
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

// GET /api/kb/articles/:id/tickets — reverse lookup: tickets linked to this article
router.get('/articles/:id/tickets', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const tickets = db.prepare(`
      SELECT t.id, t.title, t.status, t.priority, t.created_at, t.updated_at
      FROM tickets t
      JOIN ticket_kb_links tkl ON t.id = tkl.ticket_id
      WHERE tkl.article_id = ?
      ORDER BY tkl.created_at DESC
    `).all(req.params.id);
    res.json(tickets);
  } catch (error) {
    console.error('Error fetching article linked tickets:', error);
    res.status(500).json({ error: 'Failed to fetch linked tickets' });
  }
});

// POST /api/kb/articles
router.post('/articles', authenticate, (req: AuthRequest, res: Response) => {
  const { title, content = '', category_id, article_type } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    const id = uuidv4();
    const now = new Date().toISOString();

    const insertArticleAndFts = db.transaction((articleId: string, articleTitle: string, articleContent: string, categoryId: string | null, articleTypeVal: string | null, timestamp: string) => {
      db.prepare(
        'INSERT INTO kb_articles (id, title, content, category_id, article_type, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
      ).run(articleId, articleTitle, articleContent, categoryId, articleTypeVal, timestamp, timestamp);
      const row = db.prepare('SELECT rowid FROM kb_articles WHERE id = ?').get(articleId) as { rowid: number };
      db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)')
        .run(row.rowid, articleTitle, stripHtml(articleContent));
    });

    insertArticleAndFts(id, title.trim(), content, category_id || null, article_type || null, now);

    const article = db.prepare(`
      SELECT a.id, a.title, a.content, a.category_id, a.article_type, a.created_at, a.updated_at,
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
  const { title, content, category_id, article_type } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    const existing = db.prepare('SELECT id FROM kb_articles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Article not found' });

    const now = new Date().toISOString();
    const articleId = req.params.id as string;
    const articleContent = content ?? '';

    const updateArticleAndFts = db.transaction((aid: string, articleTitle: string, articleContent: string, categoryId: string | null, articleTypeVal: string | null, timestamp: string) => {
      db.prepare(
        'UPDATE kb_articles SET title = ?, content = ?, category_id = ?, article_type = ?, updated_at = ? WHERE id = ?'
      ).run(articleTitle, articleContent, categoryId, articleTypeVal, timestamp, aid);
      const row = db.prepare('SELECT rowid FROM kb_articles WHERE id = ?').get(aid) as { rowid: number };
      db.prepare('DELETE FROM kb_articles_fts WHERE rowid = ?').run(row.rowid);
      db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)')
        .run(row.rowid, articleTitle, stripHtml(articleContent));
    });

    updateArticleAndFts(articleId, String(title).trim(), articleContent, category_id || null, article_type || null, now);

    const article = db.prepare(`
      SELECT a.id, a.title, a.content, a.category_id, a.article_type, a.created_at, a.updated_at,
        c.name as category_name, c.color as category_color
      FROM kb_articles a
      LEFT JOIN kb_categories c ON a.category_id = c.id
      WHERE a.id = ?
    `).get(articleId) as KbArticleRow;

    res.json(article);
  } catch (error) {
    console.error('Error updating KB article:', error);
    res.status(500).json({ error: 'Failed to update KB article' });
  }
});

// DELETE /api/kb/articles/:id
// Note: FTS sync is handled automatically by the kb_articles_fts_delete trigger
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

// ─── Article Sharing ──────────────────────────────────────────────────────────

// GET /api/kb/articles/:id/share — get existing share token
router.get('/articles/:id/share', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const row = db.prepare('SELECT share_token FROM kb_article_shares WHERE article_id = ?').get(req.params.id) as { share_token: string } | undefined;
    res.json({ share_token: row?.share_token || null });
  } catch (error) {
    console.error('Error fetching KB share:', error);
    res.status(500).json({ error: 'Failed to fetch share' });
  }
});

// POST /api/kb/articles/:id/share — create share token (idempotent)
router.post('/articles/:id/share', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT share_token FROM kb_article_shares WHERE article_id = ?').get(req.params.id) as { share_token: string } | undefined;
    if (existing) return res.json({ share_token: existing.share_token });

    const article = db.prepare('SELECT id FROM kb_articles WHERE id = ?').get(req.params.id);
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const id = uuidv4();
    const shareToken = randomBytes(12).toString('hex');
    const now = new Date().toISOString();
    db.prepare('INSERT INTO kb_article_shares (id, article_id, share_token, created_at) VALUES (?, ?, ?, ?)')
      .run(id, req.params.id, shareToken, now);

    res.status(201).json({ share_token: shareToken });
  } catch (error) {
    console.error('Error creating KB share:', error);
    res.status(500).json({ error: 'Failed to create share' });
  }
});

// DELETE /api/kb/articles/:id/share — revoke share token
router.delete('/articles/:id/share', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM kb_article_shares WHERE article_id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Share not found' });
    res.json({ message: 'Share revoked' });
  } catch (error) {
    console.error('Error revoking KB share:', error);
    res.status(500).json({ error: 'Failed to revoke share' });
  }
});

// GET /api/kb/public/:token — public read-only article (no auth)
router.get('/public/:token', (_req: Request, res: Response) => {
  const { token } = _req.params;
  try {
    const share = db.prepare('SELECT article_id FROM kb_article_shares WHERE share_token = ?').get(token) as { article_id: string } | undefined;
    if (!share) return res.status(404).json({ error: 'Invalid or expired link' });

    const article = db.prepare(`
      SELECT a.id, a.title, a.content, a.article_type, a.created_at, a.updated_at,
        c.name as category_name, c.color as category_color
      FROM kb_articles a
      LEFT JOIN kb_categories c ON a.category_id = c.id
      WHERE a.id = ?
    `).get(share.article_id) as KbArticleRow | undefined;

    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(article);
  } catch (error) {
    console.error('Error fetching public KB article:', error);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// ─── KB Image Upload ──────────────────────────────────────────────────────────

// POST /api/kb/upload-image — upload image for KB article (authenticated)
router.post('/upload-image', authenticate, (req: AuthRequest, res: Response) => {
  uploadImage.single('image')(req, res, (err) => {
    if (err) {
      console.error('KB image upload error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    res.status(201).json({ url: `/api/kb/images/${req.file.filename}` });
  });
});

// GET /api/kb/images/:filename — serve KB image (public, KB articles can be shared publicly)
router.get('/images/:filename', (req: Request, res: Response) => {
  const filename = req.params.filename;
  // Basic path traversal protection
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = join(UPLOAD_DIR, filename);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.sendFile(filePath);
});

export default router;
