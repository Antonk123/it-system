import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/connection.js';
import { stripHtml } from '../lib/htmlUtils.js';
import { sanitizeRichText, sanitizePlainText } from '../lib/htmlSanitizer.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { logger } from '../lib/logger.js';

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


const kbShareRateLimiter = createRateLimiter(60 * 1000, 30);

const router = Router();

interface KbCategoryRow {
  id: string;
  name: string;
  color: string | null;
  position: number;
  created_at: string;
}

interface KbTagRow { id: string; name: string; color: string; }

interface KbArticleRow {
  id: string;
  title: string;
  content: string;
  category_id: string | null;
  category_name?: string | null;
  category_color?: string | null;
  article_type?: string | null;
  status: 'draft' | 'published';
  tags?: KbTagRow[];
  snippet?: string | null;
  created_at: string;
  updated_at: string;
}

function getTagsForArticles(articleIds: string[]): Map<string, KbTagRow[]> {
  const map = new Map<string, KbTagRow[]>();
  if (articleIds.length === 0) return map;
  const placeholders = articleIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT kat.article_id, t.id, t.name, t.color FROM kb_article_tags kat JOIN tags t ON t.id = kat.tag_id WHERE kat.article_id IN (${placeholders}) ORDER BY t.name ASC`
  ).all(...articleIds) as (KbTagRow & { article_id: string })[];
  for (const row of rows) {
    if (!map.has(row.article_id)) map.set(row.article_id, []);
    map.get(row.article_id)!.push({ id: row.id, name: row.name, color: row.color });
  }
  return map;
}

// ─── Categories ───────────────────────────────────────────────────────────────

// GET /api/kb/categories
router.get('/categories', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const categories = db.prepare(`
      SELECT c.id, c.name, c.color, c.position, c.created_at,
        (SELECT COUNT(*) FROM kb_articles a WHERE a.category_id = c.id AND a.status = 'published') AS article_count
      FROM kb_categories c
      ORDER BY c.position ASC, c.name ASC
    `).all() as (KbCategoryRow & { article_count: number })[];
    res.json(categories);
  } catch (error) {
    logger.error('Error fetching KB categories:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch KB categories' });
  }
});

// POST /api/kb/categories
router.post('/categories', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { name, color } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const id = uuidv4();
    const now = new Date().toISOString();
    const safeName = sanitizePlainText(name.trim());
    const maxPos = (db.prepare('SELECT MAX(position) as m FROM kb_categories').get() as { m: number | null }).m ?? -1;
    db.prepare(
      'INSERT INTO kb_categories (id, name, color, position, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, safeName, color || null, maxPos + 1, now);
    const category = db.prepare('SELECT id, name, color, position, created_at FROM kb_categories WHERE id = ?').get(id) as KbCategoryRow;
    res.status(201).json(category);
  } catch (error) {
    logger.error('Error creating KB category:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create KB category' });
  }
});

// PUT /api/kb/categories/:id
router.put('/categories/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { name, color } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const existing = db.prepare('SELECT id FROM kb_categories WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    const safeName = sanitizePlainText(name.trim());
    db.prepare('UPDATE kb_categories SET name = ?, color = ? WHERE id = ?')
      .run(safeName, color || null, req.params.id);
    const category = db.prepare('SELECT id, name, color, position, created_at FROM kb_categories WHERE id = ?').get(req.params.id) as KbCategoryRow;
    res.json(category);
  } catch (error) {
    logger.error('Error updating KB category:', { error: String(error) });
    res.status(500).json({ error: 'Failed to update KB category' });
  }
});

// DELETE /api/kb/categories/:id
router.delete('/categories/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT id FROM kb_categories WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    db.prepare('DELETE FROM kb_categories WHERE id = ?').run(req.params.id);
    res.json({ message: 'Category deleted' });
  } catch (error) {
    logger.error('Error deleting KB category:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete KB category' });
  }
});

// ─── Articles ─────────────────────────────────────────────────────────────────

// GET /api/kb/articles?search=&category_id=&article_type=&tag=
router.get('/articles', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { search, category_id, article_type, tag, stale } = req.query as Record<string, string>;
    const trimmedSearch = search?.trim();

    let rawArticles: KbArticleRow[];

    if (trimmedSearch) {
      const safeQuery = '"' + trimmedSearch.replace(/"/g, '""') + '"';
      rawArticles = db.prepare(`
        SELECT
          a.id, a.title, a.content, a.category_id, a.article_type, a.status, a.last_reviewed_at, a.created_at, a.updated_at,
          c.name as category_name, c.color as category_color,
          snippet(kb_articles_fts, 1, '<mark>', '</mark>', '...', 25) AS snippet
        FROM kb_articles_fts fts
        JOIN kb_articles a ON a.rowid = fts.rowid
        LEFT JOIN kb_categories c ON a.category_id = c.id
        WHERE kb_articles_fts MATCH @search
          AND a.status = 'published'
          AND (@category_id IS NULL OR a.category_id = @category_id)
          AND (@article_type IS NULL OR a.article_type = @article_type)
          AND (@tag IS NULL OR EXISTS (SELECT 1 FROM kb_article_tags WHERE article_id = a.id AND tag_id = @tag))
          AND (@stale IS NULL OR (julianday('now') - julianday(COALESCE(a.last_reviewed_at, a.created_at))) > 90)
        ORDER BY rank
      `).all({ search: safeQuery, category_id: category_id || null, article_type: article_type || null, tag: tag || null, stale: stale || null }) as KbArticleRow[];
    } else {
      rawArticles = db.prepare(`
        SELECT
          a.id, a.title, a.content, a.category_id, a.article_type, a.status, a.last_reviewed_at, a.created_at, a.updated_at,
          c.name as category_name, c.color as category_color
        FROM kb_articles a
        LEFT JOIN kb_categories c ON a.category_id = c.id
        WHERE a.status = 'published'
          AND (@category_id IS NULL OR a.category_id = @category_id)
          AND (@article_type IS NULL OR a.article_type = @article_type)
          AND (@tag IS NULL OR EXISTS (SELECT 1 FROM kb_article_tags WHERE article_id = a.id AND tag_id = @tag))
          AND (@stale IS NULL OR (julianday('now') - julianday(COALESCE(a.last_reviewed_at, a.created_at))) > 90)
        ORDER BY a.updated_at DESC
      `).all({ category_id: category_id || null, article_type: article_type || null, tag: tag || null, stale: stale || null }) as KbArticleRow[];
    }

    const tagsByArticle = getTagsForArticles(rawArticles.map(a => a.id));
    const articles = rawArticles.map(a => ({ ...a, tags: tagsByArticle.get(a.id) || [] }));

    res.json(articles);
  } catch (error) {
    logger.error('Error fetching KB articles:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch KB articles' });
  }
});

// GET /api/kb/articles/:id
router.get('/articles/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const article = isAdmin
      ? db.prepare(`
          SELECT
            a.id, a.title, a.content, a.category_id, a.article_type, a.status, a.last_reviewed_at, a.created_at, a.updated_at,
            c.name as category_name, c.color as category_color
          FROM kb_articles a
          LEFT JOIN kb_categories c ON a.category_id = c.id
          WHERE a.id = ?
        `).get(req.params.id) as KbArticleRow | undefined
      : db.prepare(`
          SELECT
            a.id, a.title, a.content, a.category_id, a.article_type, a.status, a.last_reviewed_at, a.created_at, a.updated_at,
            c.name as category_name, c.color as category_color
          FROM kb_articles a
          LEFT JOIN kb_categories c ON a.category_id = c.id
          WHERE a.id = ? AND a.status = 'published'
        `).get(req.params.id) as KbArticleRow | undefined;

    if (!article) return res.status(404).json({ error: 'Article not found' });

    const id = req.params.id as string;
    const tagMap = getTagsForArticles([id]);
    res.json({ ...article, tags: tagMap.get(id) || [] });
  } catch (error) {
    logger.error('Error fetching KB article:', { error: String(error) });
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
    logger.error('Error fetching article linked tickets:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch linked tickets' });
  }
});

// POST /api/kb/articles
router.post('/articles', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { title, content = '', category_id, article_type, tag_ids, status } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (!category_id || typeof category_id !== 'string') {
    return res.status(400).json({ error: 'Category is required' });
  }
  const categoryExists = db.prepare('SELECT id FROM kb_categories WHERE id = ?').get(category_id);
  if (!categoryExists) {
    return res.status(400).json({ error: 'Category not found' });
  }
  try {
    const id = uuidv4();
    const now = new Date().toISOString();
    const articleStatus: 'draft' | 'published' = status === 'draft' ? 'draft' : 'published';

    // Defense-in-depth: sanitera HTML server-side.
    const safeTitle = sanitizePlainText(title.trim());
    const safeContent = sanitizeRichText(content);

    const insertArticleAndFts = db.transaction((articleId: string, articleTitle: string, articleContent: string, categoryId: string | null, articleTypeVal: string | null, articleStatusVal: string, timestamp: string) => {
      db.prepare(
        'INSERT INTO kb_articles (id, title, content, category_id, article_type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(articleId, articleTitle, articleContent, categoryId, articleTypeVal, articleStatusVal, timestamp, timestamp);
      const row = db.prepare('SELECT rowid FROM kb_articles WHERE id = ?').get(articleId) as { rowid: number };
      db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)')
        .run(row.rowid, articleTitle, stripHtml(articleContent));
      if (Array.isArray(tag_ids) && tag_ids.length > 0) {
        const insertTag = db.prepare('INSERT OR IGNORE INTO kb_article_tags (id, article_id, tag_id) VALUES (?, ?, ?)');
        for (const tagId of tag_ids) {
          if (typeof tagId === 'string' && tagId.trim()) insertTag.run(uuidv4(), articleId, tagId);
        }
      }
    });

    insertArticleAndFts(id, safeTitle, safeContent, category_id || null, article_type || null, articleStatus, now);

    const article = db.prepare(`
      SELECT a.id, a.title, a.content, a.category_id, a.article_type, a.status, a.created_at, a.updated_at,
        c.name as category_name, c.color as category_color
      FROM kb_articles a
      LEFT JOIN kb_categories c ON a.category_id = c.id
      WHERE a.id = ?
    `).get(id) as KbArticleRow;

    const tagMap = getTagsForArticles([id]);
    res.status(201).json({ ...article, tags: tagMap.get(id) || [] });
  } catch (error) {
    logger.error('Error creating KB article:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create KB article' });
  }
});

// PUT /api/kb/articles/:id
router.put('/articles/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { title, content, category_id, article_type, tag_ids, status } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (!category_id || typeof category_id !== 'string') {
    return res.status(400).json({ error: 'Category is required' });
  }
  const categoryExists = db.prepare('SELECT id FROM kb_categories WHERE id = ?').get(category_id);
  if (!categoryExists) {
    return res.status(400).json({ error: 'Category not found' });
  }
  try {
    const existing = db.prepare('SELECT id, title, content, rowid FROM kb_articles WHERE id = ?').get(req.params.id) as { id: string; title: string; content: string; rowid: number } | undefined;
    if (!existing) return res.status(404).json({ error: 'Article not found' });

    const now = new Date().toISOString();
    const articleId = req.params.id as string;
    // Defense-in-depth: sanitera HTML server-side.
    const articleContent = sanitizeRichText(content ?? '');
    const safeTitle = sanitizePlainText(String(title).trim());
    const articleStatus: 'draft' | 'published' = status === 'draft' ? 'draft' : 'published';

    const updateArticleAndFts = db.transaction((aid: string, articleTitle: string, articleContent: string, categoryId: string | null, articleTypeVal: string | null, articleStatusVal: string, timestamp: string) => {
      db.prepare("INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content_plain) VALUES('delete', ?, ?, ?)")
        .run(existing!.rowid, existing!.title, stripHtml(existing!.content));
      db.prepare(
        'UPDATE kb_articles SET title = ?, content = ?, category_id = ?, article_type = ?, status = ?, updated_at = ? WHERE id = ?'
      ).run(articleTitle, articleContent, categoryId, articleTypeVal, articleStatusVal, timestamp, aid);
      db.prepare('INSERT INTO kb_articles_fts(rowid, title, content_plain) VALUES (?,?,?)')
        .run(existing!.rowid, articleTitle, stripHtml(articleContent));
      db.prepare('DELETE FROM kb_article_tags WHERE article_id = ?').run(aid);
      if (Array.isArray(tag_ids) && tag_ids.length > 0) {
        const insertTag = db.prepare('INSERT OR IGNORE INTO kb_article_tags (id, article_id, tag_id) VALUES (?, ?, ?)');
        for (const tagId of tag_ids) {
          if (typeof tagId === 'string' && tagId.trim()) insertTag.run(uuidv4(), aid, tagId);
        }
      }
    });

    updateArticleAndFts(articleId, safeTitle, articleContent, category_id || null, article_type || null, articleStatus, now);

    const article = db.prepare(`
      SELECT a.id, a.title, a.content, a.category_id, a.article_type, a.status, a.created_at, a.updated_at,
        c.name as category_name, c.color as category_color
      FROM kb_articles a
      LEFT JOIN kb_categories c ON a.category_id = c.id
      WHERE a.id = ?
    `).get(articleId) as KbArticleRow;

    const tagMap = getTagsForArticles([articleId]);
    res.json({ ...article, tags: tagMap.get(articleId) || [] });
  } catch (error) {
    logger.error('Error updating KB article:', { error: String(error) });
    res.status(500).json({ error: 'Failed to update KB article' });
  }
});

// PATCH /api/kb/articles/:id/review
router.patch('/articles/:id/review', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT id FROM kb_articles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Article not found' });
    const now = new Date().toISOString();
    db.prepare('UPDATE kb_articles SET last_reviewed_at = ? WHERE id = ?').run(now, req.params.id);
    res.json({ last_reviewed_at: now });
  } catch (error) {
    logger.error('Error marking KB article as reviewed:', { error: String(error) });
    res.status(500).json({ error: 'Failed to mark article as reviewed' });
  }
});

// DELETE /api/kb/articles/:id
router.delete('/articles/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const existing = db.prepare('SELECT id, title, content, rowid FROM kb_articles WHERE id = ?').get(req.params.id) as { id: string; title: string; content: string; rowid: number } | undefined;
    if (!existing) return res.status(404).json({ error: 'Article not found' });
    db.transaction(() => {
      db.prepare("INSERT INTO kb_articles_fts(kb_articles_fts, rowid, title, content_plain) VALUES('delete', ?, ?, ?)")
        .run(existing.rowid, existing.title, stripHtml(existing.content));
      db.prepare('DELETE FROM kb_articles WHERE id = ?').run(req.params.id);
    })();

    // Rensa inbäddade KB-bilder från disk (best-effort, blockerar ej raderingen).
    // Parsa alla <img src="..."> i artikelns HTML och ta bort filer som pekar på
    // lokalt uppladdade KB-bilder (/api/kb/images/<kb-…>-filnamn).
    try {
      const imgSrcPattern = /<img[^>]+src="([^"]+)"/gi;
      let match: RegExpExecArray | null;
      while ((match = imgSrcPattern.exec(existing.content)) !== null) {
        const src = match[1];
        // Matcha bara lokalt uppladdade KB-bilder: /api/kb/images/<filename>
        const localMatch = src.match(/\/api\/kb\/images\/(kb-[^/?#"]+)$/);
        if (!localMatch) continue;
        const filename = localMatch[1];
        // Förhindra path-traversal: filnamnet får inte innehålla sökvägskomponenter.
        if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) continue;
        const filePath = join(UPLOAD_DIR, filename);
        // Radera bara filer som faktiskt ligger i UPLOAD_DIR.
        if (!filePath.startsWith(UPLOAD_DIR + '/') && filePath !== UPLOAD_DIR) continue;
        try {
          if (existsSync(filePath)) unlinkSync(filePath);
        } catch (unlinkErr) {
          logger.warn('KB article delete: kunde inte radera inbäddad bild', { filePath, error: String(unlinkErr) });
        }
      }
    } catch (parseErr) {
      logger.warn('KB article delete: fel vid parsning av inbäddade bilder', { error: String(parseErr) });
    }

    res.json({ message: 'Article deleted' });
  } catch (error) {
    logger.error('Error deleting KB article:', { error: String(error) });
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
    logger.error('Error fetching ticket KB links:', { error: String(error) });
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
    logger.error('Error linking KB article to ticket:', { error: String(error) });
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
    logger.error('Error removing KB link:', { error: String(error) });
    res.status(500).json({ error: 'Failed to remove KB link' });
  }
});

// ─── Article Cross-References ─────────────────────────────────────────────────

// GET /api/kb/articles/:id/links — bidirectional cross-reference list
router.get('/articles/:id/links', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const links = db.prepare(`
      SELECT a.id, a.title, a.article_type, kl.id as link_id
      FROM kb_article_links kl
      JOIN kb_articles a ON a.id = kl.target_article_id
      WHERE kl.source_article_id = ? AND a.status = 'published'
      UNION
      SELECT a.id, a.title, a.article_type, kl.id as link_id
      FROM kb_article_links kl
      JOIN kb_articles a ON a.id = kl.source_article_id
      WHERE kl.target_article_id = ? AND a.status = 'published'
      ORDER BY title ASC
    `).all(id, id);
    res.json(links);
  } catch (error) {
    logger.error('Error fetching article links:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch article links' });
  }
});

// POST /api/kb/articles/:id/links — create directional link
router.post('/articles/:id/links', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { targetArticleId } = req.body;
    if (!targetArticleId) return res.status(400).json({ error: 'targetArticleId is required' });
    if (id === targetArticleId) return res.status(400).json({ error: 'Cannot link article to itself' });

    // Check if link already exists in either direction
    const existing = db.prepare(`
      SELECT id FROM kb_article_links
      WHERE (source_article_id = ? AND target_article_id = ?)
         OR (source_article_id = ? AND target_article_id = ?)
    `).get(id, targetArticleId, targetArticleId, id);
    if (existing) return res.status(409).json({ error: 'Link already exists' });

    const linkId = uuidv4();
    db.prepare(`
      INSERT INTO kb_article_links (id, source_article_id, target_article_id)
      VALUES (?, ?, ?)
    `).run(linkId, id, targetArticleId);
    res.status(201).json({ id: linkId, source_article_id: id, target_article_id: targetArticleId });
  } catch (error) {
    logger.error('Error creating article link:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create article link' });
  }
});

// DELETE /api/kb/articles/:id/links/:targetId — remove link (bidirectional)
router.delete('/articles/:id/links/:targetId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id, targetId } = req.params;
    const result = db.prepare(`
      DELETE FROM kb_article_links
      WHERE (source_article_id = ? AND target_article_id = ?)
         OR (source_article_id = ? AND target_article_id = ?)
    `).run(id, targetId, targetId, id);
    if (result.changes === 0) return res.status(404).json({ error: 'Link not found' });
    res.json({ message: 'Link removed' });
  } catch (error) {
    logger.error('Error removing article link:', { error: String(error) });
    res.status(500).json({ error: 'Failed to remove article link' });
  }
});

// ─── Article Sharing ──────────────────────────────────────────────────────────

// GET /api/kb/articles/:id/share — get existing share token
router.get('/articles/:id/share', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const row = db.prepare('SELECT share_token FROM kb_article_shares WHERE article_id = ?').get(req.params.id) as { share_token: string } | undefined;
    res.json({ share_token: row?.share_token || null });
  } catch (error) {
    logger.error('Error fetching KB share:', { error: String(error) });
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
    logger.error('Error creating KB share:', { error: String(error) });
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
    logger.error('Error revoking KB share:', { error: String(error) });
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
      SELECT a.id, a.title, a.content, a.article_type, a.status, a.created_at, a.updated_at,
        c.name as category_name, c.color as category_color
      FROM kb_articles a
      LEFT JOIN kb_categories c ON a.category_id = c.id
      WHERE a.id = ?
    `).get(share.article_id) as KbArticleRow | undefined;

    if (!article) return res.status(404).json({ error: 'Article not found' });

    const tagMap = getTagsForArticles([share.article_id]);
    res.json({ ...article, tags: tagMap.get(share.article_id) || [] });
  } catch (error) {
    logger.error('Error fetching public KB article:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// ─── KB Image Upload ──────────────────────────────────────────────────────────

// POST /api/kb/upload-image — upload image for KB article (authenticated)
router.post('/upload-image', authenticate, (req: AuthRequest, res: Response) => {
  uploadImage.single('image')(req, res, (err) => {
    if (err) {
      logger.error('KB image upload error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    res.status(201).json({ url: `/api/kb/images/${req.file.filename}` });
  });
});

// GET /api/kb/images/:filename — serve KB image (public, KB articles can be shared publicly)
// Only files written by uploadImage.storage are served (prefix kb-, see line 29).
// This prevents an attacker from enumerating ticket-attachment filenames in the
// shared UPLOAD_DIR and bypassing the authenticated /api/attachments/file/:id route.
router.get('/images/:filename', (req: Request, res: Response) => {
  const filename = req.params.filename as string;
  // Basic path traversal protection
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  // Only serve files written by the KB image upload pipeline (kb- prefix).
  if (!filename.startsWith('kb-')) {
    return res.status(404).json({ error: 'Image not found' });
  }
  const filePath = join(UPLOAD_DIR, filename);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.sendFile(filePath);
});

export default router;
