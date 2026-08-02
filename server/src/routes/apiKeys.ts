import { Router, Response } from 'express';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { logAudit } from '../lib/auditLog.js';
import { logger } from '../lib/logger.js';

const router = Router();

// The only scope values a key may carry. 'admin' is checked by requireAdmin
// (server/src/middleware/auth.ts) in addition to the write-method check
// already done for 'write' — keep these two files in sync if a new scope is
// ever added.
const ALLOWED_PERMISSIONS = ['read', 'write', 'admin'] as const;

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
    logger.error('Error listing API keys:', { error: String(error) });
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// POST / — create a new API key
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  const { name, permissions, expires_at } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  // Validera expires_at: om satt måste det vara ett giltigt framtida datum.
  // Utan denna check accepterar `new Date('garbage') < new Date()` (= false)
  // tyst och nyckeln går aldrig ut.
  let normalizedExpiresAt: string | null;
  if (expires_at !== undefined && expires_at !== null && expires_at !== '') {
    if (typeof expires_at !== 'string') {
      return res.status(400).json({ error: 'expires_at måste vara ett ISO-datum (sträng)' });
    }
    const parsed = new Date(expires_at);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'expires_at är inte ett giltigt datum' });
    }
    if (parsed.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'expires_at måste ligga i framtiden' });
    }
    normalizedExpiresAt = parsed.toISOString();
  } else {
    // Inget utgångsdatum angivet → default till 1 år från skapande.
    // Undviker oavsiktligt eviga nycklar; klienten kan ange ett eget datum.
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    normalizedExpiresAt = oneYearFromNow.toISOString();
  }

  // Validate requested permissions against the allowlist. Anything outside
  // {read, write, admin} is rejected outright — an unknown scope value could
  // otherwise be silently stored and misread later.
  let perms: string[];
  if (Array.isArray(permissions)) {
    const unknown = permissions.filter(
      (p) => typeof p !== 'string' || !(ALLOWED_PERMISSIONS as readonly string[]).includes(p)
    );
    if (unknown.length > 0) {
      return res.status(400).json({ error: `Okänt scope-värde: ${unknown.join(', ')}` });
    }
    // 'admin' scope may only be granted on a key by an admin user — otherwise
    // a non-admin could mint a key that (once the underlying user is later
    // promoted, or via some other future path) claims admin scope it never
    // should have had. Keep the grant restricted to the same trust level.
    if (permissions.includes('admin') && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Endast administratörer kan skapa nycklar med admin-scope' });
    }
    // G1: om requesten själv är autentiserad via en API-nyckel (inte en
    // JWT-session) och den vill skapa en admin-scopad nyckel, måste den
    // ANROPANDE nyckeln också ha admin-scope. Utan detta kunde en läckt
    // ['read','write']-nyckel bunden till en admin-användare passera
    // write-scope-guarden (den har 'write') och sedan mynta en NY nyckel med
    // ['read','admin'] — grant-kollen ovan kollar bara ägarens roll, som ÄR
    // admin. Samma princip som requireAdmin (auth.ts): en nyckels scope kan
    // bara INSKRÄNKA, aldrig UTÖKA vad den själv redan kan göra. Additiv —
    // rollkontrollen ovan gäller fortfarande, båda måste passera.
    if (permissions.includes('admin') && req.apiKey && !req.apiKey.permissions.includes('admin')) {
      return res.status(403).json({ error: 'API-nyckeln saknar admin-scope för att skapa admin-nycklar' });
    }
    perms = permissions;
  } else {
    perms = ['read'];
  }

  // Fynd F6: normalisera bort dubbletter (t.ex. ['read','read']) innan lagring.
  perms = [...new Set(perms)];

  try {
    // Limit API keys per user to prevent database bloat
    const keyCount = db.prepare(
      'SELECT COUNT(*) as count FROM api_keys WHERE user_id = ?'
    ).get(req.user!.id) as { count: number };
    if (keyCount.count >= 20) {
      return res.status(400).json({ error: 'Maximalt 20 API-nycklar per användare' });
    }

    const id = randomUUID();
    const rawKey = `itk_live_${randomBytes(16).toString('hex')}`;
    const keyPrefix = rawKey.substring('itk_live_'.length, 'itk_live_'.length + 8);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const permsJson = JSON.stringify(perms);

    db.prepare(
      'INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name.trim(), keyPrefix, keyHash, req.user!.id, permsJson, normalizedExpiresAt);

    logAudit(req.user!.id, 'api_key_create', 'api_key', id, `name: ${name.trim()}, prefix: ${keyPrefix}`, req.ip, req.apiKey?.id ?? null);

    res.status(201).json({
      id,
      name: name.trim(),
      key: rawKey, // Only returned on creation
      key_prefix: keyPrefix,
      permissions: permsJson,
      expires_at: normalizedExpiresAt,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error creating API key:', { error: String(error) });
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

    logAudit(req.user!.id, 'api_key_delete', 'api_key', req.params.id, null, req.ip, req.apiKey?.id ?? null);

    res.json({ message: 'API key deleted' });
  } catch (error) {
    logger.error('Error deleting API key:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export default router;
