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

const router = Router();

// Token expiration times
const ACCESS_TOKEN_EXPIRY = '1h'; // Short-lived access token
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

    // Update last_used_at for refresh token
    db.prepare('UPDATE refresh_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(tokenRow.id);

    res.json({
      accessToken,
      token: accessToken, // For backward compatibility
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

  // Strong password policy: minimum 12 characters with complexity requirements
  const PASSWORD_MIN_LENGTH = 12;
  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,}$/;

  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({
      error: 'Password must be at least 12 characters long'
    });
  }

  if (!PASSWORD_REGEX.test(newPassword)) {
    return res.status(400).json({
      error: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)'
    });
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

export default router;
