import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

interface CommentRow {
  id: string;
  ticket_id: string;
  user_id: string;
  content: string;
  is_internal: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  user_name?: string;
  user_email?: string;
}

// GET /api/comments/ticket/:ticketId - Fetch all comments for a ticket
router.get('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const comments = db.prepare(`
      SELECT
        c.*,
        COALESCE(u.display_name, contact.name, u.email) as user_name,
        u.email as user_email
      FROM ticket_comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN contacts contact ON contact.email = u.email
      WHERE c.ticket_id = ? AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC
    `).all(req.params.ticketId) as CommentRow[];

    res.json(comments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST /api/comments/ticket/:ticketId - Create new comment
router.post('/ticket/:ticketId', authenticate, (req: AuthRequest, res: Response) => {
  const { content, isInternal = true } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (!req.user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  try {
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO ticket_comments (id, ticket_id, user_id, content, is_internal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.ticketId, req.user.id, content.trim(), isInternal ? 1 : 0, now, now);

    // Update ticket's updated_at timestamp
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, req.params.ticketId);

    const comment = db.prepare(`
      SELECT
        c.*,
        COALESCE(u.display_name, contact.name, u.email) as user_name,
        u.email as user_email
      FROM ticket_comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN contacts contact ON contact.email = u.email
      WHERE c.id = ?
    `).get(id) as CommentRow;

    res.status(201).json(comment);
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// PUT /api/comments/:id - Update comment
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { content } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (!req.user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  try {
    const existing = db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(req.params.id) as CommentRow | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only allow editing own comments or if admin
    if (existing.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to edit this comment' });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE ticket_comments SET content = ?, updated_at = ? WHERE id = ?')
      .run(content.trim(), now, req.params.id);

    const comment = db.prepare(`
      SELECT
        c.*,
        COALESCE(u.display_name, contact.name, u.email) as user_name,
        u.email as user_email
      FROM ticket_comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN contacts contact ON contact.email = u.email
      WHERE c.id = ?
    `).get(req.params.id) as CommentRow;

    res.json(comment);
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// DELETE /api/comments/:id - Soft delete comment
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  try {
    const existing = db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(req.params.id) as CommentRow | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only allow deleting own comments or if admin
    if (existing.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE ticket_comments SET deleted_at = ? WHERE id = ?').run(now, req.params.id);

    res.json({ message: 'Comment deleted' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

export default router;
