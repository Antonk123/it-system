import { Router, Request, Response } from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { JWT_SECRET } from '../config/passport.js';
import { authenticate, requireAdmin, AuthRequest, AuthUser } from '../middleware/auth.js';
import { loginRateLimiter, createRateLimiter } from '../middleware/rateLimit.js';
import { sendPasswordResetEmail } from '../lib/email.js';
import { validatePassword } from '../lib/passwordPolicy.js';
import { logAudit } from '../lib/auditLog.js';
import { logger } from '../lib/logger.js';
import { cookieSecure } from '../config/cookies.js';

/**
 * Rate limiter for token refresh endpoint.
 * 10 attempts per 15 minutes per IP — generous for legitimate silent refresh
 * but blocks brute-force token replay attacks.
 */
const refreshRateLimiter = createRateLimiter(15 * 60 * 1000, 10);

const router = Router();

// Token expiration times
const ACCESS_TOKEN_EXPIRY = '15m'; // Short-lived access token (silent refresh handles re-auth)
const REFRESH_TOKEN_EXPIRY_DAYS = 7; // Refresh token valid for 7 days

// Generate cryptographically secure refresh token
function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Calculate refresh token expiration date
function getRefreshTokenExpiry(): string {
  const date = new Date();
  date.setDate(date.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  return date.toISOString();
}

// Refresh-token lagras i en HttpOnly-cookie (ej läsbar via JS) istället för
// localStorage → en XSS kan inte längre stjäla den 7-dagars sessionen.
// Scopad till /api/auth så den bara skickas till refresh/logout. SameSite=strict
// (refresh sker som same-site-fetch från SPA:n). Cookie-parser är redan monterad.
const REFRESH_COOKIE = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/auth';
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'strict' as const,
    path: REFRESH_COOKIE_PATH,
  };
}
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...refreshCookieOptions(),
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}
function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}
// Läs refresh-token från cookie (ny klient) med fallback till body (bakåtkompat
// under rollout / icke-webb-klienter).
function readRefreshToken(req: Request): string | undefined {
  return (req.cookies?.[REFRESH_COOKIE] as string | undefined) || req.body?.refreshToken;
}

// Login with rate limiting (5 attempts per 15 minutes)
router.post('/login', loginRateLimiter, (req: Request, res: Response) => {
  passport.authenticate('local', { session: false }, (err: Error | null, user: AuthUser | false, info: { message?: string }) => {
    if (err) {
      return res.status(500).json({ error: 'Login failed' });
    }
    if (!user) {
      logAudit(null, 'login_failure', 'session', null, `email: ${req.body?.email ?? 'unknown'}`, req.ip);
      return res.status(401).json({ error: info?.message || 'Invalid credentials' });
    }

    try {
      // Generate short-lived access token (1 hour)
      const accessToken = jwt.sign(
        { sub: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
      );

      // Generate long-lived refresh token (7 days)
      const refreshToken = generateRefreshToken();
      const refreshTokenId = uuidv4();
      const expiresAt = getRefreshTokenExpiry();

      // Store refresh token in database
      db.prepare(`
        INSERT INTO refresh_tokens (id, user_id, token, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(refreshTokenId, user.id, refreshToken, expiresAt);

      logAudit(user.id, 'login_success', 'session', user.id, null, req.ip);

      // Refresh-token sätts som HttpOnly-cookie — returneras INTE i body
      // (förhindrar att klient-JS/XSS får tag på den).
      setRefreshCookie(res, refreshToken);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        token: accessToken, // For backward compatibility
        accessToken,
      });
    } catch (error) {
      logger.error('Error generating tokens:', { error: String(error) });
      return res.status(500).json({ error: 'Failed to generate tokens' });
    }
  })(req, res);
});

// Refresh access token using refresh token
router.post('/refresh', refreshRateLimiter, (req: Request, res: Response) => {
  const refreshToken = readRefreshToken(req);

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    // Find refresh token in database
    interface RefreshTokenRow {
      id: string;
      user_id: string;
      token: string;
      expires_at: string;
      revoked: number;
    }

    const tokenRow = db.prepare(`
      SELECT id, user_id, token, expires_at, revoked
      FROM refresh_tokens
      WHERE token = ?
    `).get(refreshToken) as RefreshTokenRow | undefined;

    if (!tokenRow) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Check if token is revoked
    if (tokenRow.revoked === 1) {
      return res.status(401).json({ error: 'Refresh token has been revoked' });
    }

    // Check if token is expired
    const now = new Date();
    const expiresAt = new Date(tokenRow.expires_at);

    if (now > expiresAt) {
      // Clean up expired token
      db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(tokenRow.id);
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    // Get user details
    interface UserRow {
      id: string;
      email: string;
      role: string;
    }

    const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(tokenRow.user_id) as UserRow | undefined;

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Generate new access token
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Atomically rotate refresh token (delete old + insert new in one transaction)
    // Prevents session loss if server crashes between operations.
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenId = uuidv4();
    const newExpiresAt = getRefreshTokenExpiry();
    const rotateToken = db.transaction(() => {
      db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(tokenRow.id);
      db.prepare(
        'INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)'
      ).run(newRefreshTokenId, tokenRow.user_id, newRefreshToken, newExpiresAt);
    });
    rotateToken();

    // Roterad refresh-token i ny HttpOnly-cookie — ej i body.
    setRefreshCookie(res, newRefreshToken);

    res.json({
      accessToken,
      token: accessToken, // For backward compatibility
    });
  } catch (error) {
    logger.error('Error refreshing token:', { error: String(error) });
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// Logout (revoke refresh token)
router.post('/logout', authenticate, (req: AuthRequest, res: Response) => {
  const refreshToken = readRefreshToken(req);

  // Rensa alltid cookien, även om token saknas i DB.
  clearRefreshCookie(res);

  if (!refreshToken) {
    return res.json({ message: 'Logged out successfully' });
  }

  try {
    // Revoke refresh token
    db.prepare(`
      UPDATE refresh_tokens
      SET revoked = 1
      WHERE token = ? AND user_id = ?
    `).run(refreshToken, req.user!.id);

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Error during logout:', { error: String(error) });
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Get current user
router.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// Change password
router.post('/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }

  // Strong password policy: shared with admin user-create + password reset
  const policy = validatePassword(newPassword);
  if (!policy.ok) {
    return res.status(400).json({ error: policy.error });
  }

  try {
    interface UserRow {
      password_hash: string;
    }
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as UserRow | undefined;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user!.id);

    logAudit(req.user!.id, 'password_change', 'user', req.user!.id, null, req.ip);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Error changing password:', { error: String(error) });
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ── Password reset (forgot / reset) ──────────────────────────────────

const RESET_TOKEN_EXPIRY_MINUTES = 60;
// Generic response — sent regardless of whether the email matches a user, so
// attackers can't enumerate accounts via this endpoint.
const FORGOT_GENERIC_RESPONSE = {
  message: 'Om e-postadressen finns i systemet har en återställningslänk skickats.',
};

router.post('/forgot-password', loginRateLimiter, async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'E-post krävs' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const user = db.prepare('SELECT id, email, display_name FROM users WHERE LOWER(email) = ?')
    .get(normalizedEmail) as { id: string; email: string; display_name: string | null } | undefined;

  if (user) {
    try {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();

      const issueTokens = db.transaction(() => {
        // Invalidate previously issued unused tokens for this user — only the latest
        // request can complete a reset.
        db.prepare(`UPDATE password_reset_tokens
                    SET used_at = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND used_at IS NULL`).run(user.id);
        db.prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
                    VALUES (?, ?, ?, ?)`).run(uuidv4(), user.id, tokenHash, expiresAt);
      });
      issueTokens();

      const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
      if (!baseUrl) {
        logger.warn('[forgot-password] APP_BASE_URL not configured — reset link cannot be built');
      } else {
        const resetUrl = `${baseUrl}/reset-password/${token}`;
        try {
          await sendPasswordResetEmail({
            toEmail: user.email,
            toName: user.display_name || user.email.split('@')[0],
            resetUrl,
            expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
          });
        } catch (err) {
          logger.error('[forgot-password] email send failed:', { error: String(err) });
        }
      }
    } catch (err) {
      logger.error('[forgot-password] token issue failed:', { error: String(err) });
    }
  }

  return res.json(FORGOT_GENERIC_RESPONSE);
});

router.post('/reset-password', loginRateLimiter, async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Ogiltig återställningslänk' });
  }
  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Nytt lösenord krävs' });
  }

  // Samma policy som change-password och admin-create — centraliserad i passwordPolicy.ts.
  const policy = validatePassword(newPassword);
  if (!policy.ok) {
    return res.status(400).json({ error: policy.error });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = db.prepare(`SELECT id, user_id, expires_at, used_at
                            FROM password_reset_tokens
                            WHERE token_hash = ?`)
      .get(tokenHash) as { id: string; user_id: string; expires_at: string; used_at: string | null } | undefined;

    if (!row) {
      return res.status(400).json({ error: 'Ogiltig eller utgången återställningslänk' });
    }
    if (row.used_at) {
      return res.status(400).json({ error: 'Länken har redan använts' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Länken har gått ut' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const applyReset = db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, row.user_id);
      db.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
      // Force re-login on every device — the old refresh tokens may be in attacker
      // hands if the reset was triggered by a compromise.
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(row.user_id);
    });
    applyReset();

    return res.json({ message: 'Lösenordet har återställts. Logga in med ditt nya lösenord.' });
  } catch (err) {
    logger.error('[reset-password] failed:', { error: String(err) });
    return res.status(500).json({ error: 'Kunde inte återställa lösenordet' });
  }
});

// GET /audit-log — admin-only audit log viewer
router.get('/audit-log', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const entityType = req.query.entity_type as string;
    const action = req.query.action as string;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (entityType) { where += ' AND a.entity_type = ?'; params.push(entityType); }
    if (action) { where += ' AND a.action = ?'; params.push(action); }

    const entries = db.prepare(`
      SELECT a.*, u.email as user_email, u.display_name as user_display_name
      FROM audit_log a LEFT JOIN users u ON a.user_id = u.id
      ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = (db.prepare(`SELECT COUNT(*) as count FROM audit_log a ${where}`).get(...params) as { count: number }).count;

    res.json({ entries, total, limit, offset });
  } catch (error) {
    logger.error('Error fetching audit log', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

export default router;
