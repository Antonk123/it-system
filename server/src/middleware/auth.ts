import { Request, Response, NextFunction, RequestHandler } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import passport from 'passport';
import { db } from '../db/connection.js';

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

// Extend Express Request to include user from passport
declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}

export type AuthRequest = Request;

/**
 * Try to authenticate via API key (Bearer itk_live_xxx).
 * Returns the user if valid, null otherwise.
 */
function tryApiKeyAuth(req: Request): AuthUser | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer itk_live_')) return null;

  const rawKey = authHeader.substring('Bearer '.length);
  const prefix = rawKey.substring('itk_live_'.length, 'itk_live_'.length + 8);

  const row = db.prepare(
    'SELECT id, key_hash, user_id, expires_at, last_used_at FROM api_keys WHERE key_prefix = ?'
  ).get(prefix) as { id: string; key_hash: string; user_id: string; expires_at: string | null; last_used_at: string | null } | undefined;

  if (!row) return null;

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  // Verify hash with constant-time compare to avoid timing leaks.
  const hash = createHash('sha256').update(rawKey).digest('hex');
  let hashBuf: Buffer;
  let rowBuf: Buffer;
  try {
    hashBuf = Buffer.from(hash, 'hex');
    rowBuf = Buffer.from(row.key_hash, 'hex');
  } catch {
    return null;
  }
  if (hashBuf.length !== rowBuf.length || !timingSafeEqual(hashBuf, rowBuf)) return null;

  // Look up user
  const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(row.user_id) as AuthUser | undefined;
  if (!user) return null;

  // Update last_used_at, but throttle: only write if last update was > 5 minutes ago.
  // Avoids a DB write on every single API-key-authenticated request.
  const now = Date.now();
  const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (!lastUsed || now - lastUsed > 5 * 60 * 1000) {
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date(now).toISOString(), row.id);
  }

  return user;
}

export const authenticate: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  // Try API key auth first
  const apiKeyUser = tryApiKeyAuth(req);
  if (apiKeyUser) {
    req.user = apiKeyUser;
    return next();
  }

  // Fall back to JWT auth
  passport.authenticate('jwt', { session: false }, (err: Error | null, user: AuthUser | false) => {
    if (err) {
      return res.status(500).json({ error: 'Authentication error' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    next();
  })(req, res, next);
};

export const requireAdmin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const user = req.user as AuthUser | undefined;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
};

/** Helper to get typed user from request (use after authenticate middleware) */
export function getUser(req: Request): AuthUser {
  return req.user as AuthUser;
}
