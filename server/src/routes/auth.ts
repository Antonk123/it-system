import { Router, Request, Response } from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { JWT_SECRET } from '../config/passport.js';
import { authenticate, AuthRequest, AuthUser } from '../middleware/auth.js';
import { loginRateLimiter } from '../middleware/rateLimit.js';
import { sendPasswordResetEmail } from '../lib/email.js';
import { validatePassword } from '../lib/passwordPolicy.js';

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

// Login with rate limiting (5 attempts per 15 minutes)
router.post('/login', loginRateLimiter, (req: Request, res: Response) => {
  passport.authenticate('local', { session: false }, (err: Error | null, user: AuthUser | false, info: { message?: string }) => {
    if (err) {
      return res.status(500).json({ error: 'Login failed' });
    }
    if (!user) {
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

      res.json({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        token: accessToken, // For backward compatibility
        accessToken,
        refreshToken,
      });
    } catch (error) {
      console.error('Error generating tokens:', error);
      return res.status(500).json({ error: 'Failed to generate tokens' });
    }
  })(req, res);
});

// Refresh access token using refresh token
router.post('/refresh', (req: Request, res: Response) => {
  const { refreshToken } = req.body;

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

    // Delete consumed refresh token (rolling token pattern — single use)
    db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(tokenRow.id);

    // Issue new refresh token with fresh 7-day expiry (rolling per D-06)
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenId = uuidv4();
    const newExpiresAt = getRefreshTokenExpiry();
    db.prepare(
      'INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)'
    ).run(newRefreshTokenId, tokenRow.user_id, newRefreshToken, newExpiresAt);

    res.json({
      accessToken,
      token: accessToken, // For backward compatibility
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// Logout (revoke refresh token)
router.post('/logout', authenticate, (req: AuthRequest, res: Response) => {
  const { refreshToken } = req.body;

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
    console.error('Error during logout:', error);
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

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
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
        console.warn('[forgot-password] APP_BASE_URL not configured — reset link cannot be built');
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
          console.error('[forgot-password] email send failed:', err);
        }
      }
    } catch (err) {
      console.error('[forgot-password] token issue failed:', err);
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
    console.error('[reset-password] failed:', err);
    return res.status(500).json({ error: 'Kunde inte återställa lösenordet' });
  }
});

export default router;
