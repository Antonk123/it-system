import { Router, Response } from 'express';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  user_id: string;
  permissions: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

// GET / — list all keys for current user
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const keys = db.prepare(
      'SELECT id, name, key_prefix, permissions, last_used_at, expires_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user!.id) as Omit<ApiKeyRow, 'key_hash' | 'user_id'>[];

    res.json(keys);
  } catch (error) {
    console.error('Error listing API keys:', error);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// POST / — create a new API key
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  const { name, permissions, expires_at } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const id = randomUUID();
    const rawKey = `itk_live_${randomBytes(16).toString('hex')}`;
    const keyPrefix = rawKey.substring('itk_live_'.length, 'itk_live_'.length + 8);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const perms = Array.isArray(permissions) ? JSON.stringify(permissions) : '["read"]';

    db.prepare(
      'INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name.trim(), keyPrefix, keyHash, req.user!.id, perms, expires_at || null);

    res.status(201).json({
      id,
      name: name.trim(),
      key: rawKey, // Only returned on creation
      key_prefix: keyPrefix,
      permissions: perms,
      expires_at: expires_at || null,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// DELETE /:id — delete an API key
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare(
      'DELETE FROM api_keys WHERE id = ? AND user_id = ?'
    ).run(req.params.id, req.user!.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }

    res.json({ message: 'API key deleted' });
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export default router;
