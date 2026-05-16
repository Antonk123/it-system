import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { validatePassword } from '../lib/passwordPolicy.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPLAY_NAME_MAX_LENGTH = 100;

const router = Router();

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  password_hash: string;
  role: 'admin' | 'user';
  created_at: string;
  last_login: string | null;
}

// Get all system users (admin only)
router.get('/', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const users = db.prepare(`
      SELECT id, email, display_name, role, created_at, last_login FROM users ORDER BY created_at DESC
    `).all() as Omit<UserRow, 'password_hash'>[];
    
    // Map to expected format
    const mapped = users.map(u => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      role: u.role,
      createdAt: u.created_at,
      lastSignIn: u.last_login,
      emailConfirmed: true, // Always true for local users
    }));
    
    res.json({ users: mapped });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create new user (admin only)
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { email, password, role, displayName } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'E-post krävs' });
  }

  // Validera e-postformat — tidigare accepterades vad som helst.
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Ogiltigt e-postformat' });
  }

  // Validera displayName-längd om angivet (1-100 tecken efter trim).
  if (displayName !== undefined && displayName !== null) {
    if (typeof displayName !== 'string') {
      return res.status(400).json({ error: 'displayName måste vara en sträng' });
    }
    const trimmed = displayName.trim();
    if (trimmed.length > 0 && trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      return res.status(400).json({ error: `Visningsnamn får vara max ${DISPLAY_NAME_MAX_LENGTH} tecken` });
    }
  }

  // Om admin sätter ett konkret lösenord ska det följa samma policy som
  // change-password / reset-password. Auto-genererade lösenord (32 tecken hex,
  // utan specialtecken) skickas tillbaka som temporaryPassword och måste
  // bytas vid första inloggning — de behöver inte uppfylla policyn.
  if (password !== undefined && password !== null && password !== '') {
    const policy = validatePassword(password);
    if (!policy.ok) {
      return res.status(400).json({ error: policy.error });
    }
  }

  // Generate a cryptographically secure random password if not provided
  // Using crypto.randomBytes instead of Math.random for security
  const userPassword = password || crypto.randomBytes(16).toString('hex');

  try {
    // Check if email already exists (fast path)
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(userPassword, 10);
    const userRole = role === 'admin' ? 'admin' : 'user';
    const contact = db.prepare('SELECT name FROM contacts WHERE email = ?').get(email) as { name: string } | undefined;
    const resolvedDisplayName = typeof displayName === 'string' && displayName.trim()
      ? displayName.trim()
      : contact?.name || null;

    try {
      // Insert user - UNIQUE constraint on email will catch race conditions
      db.prepare(`
        INSERT INTO users (id, email, password_hash, role, display_name)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, email, passwordHash, userRole, resolvedDisplayName);

      res.status(201).json({
        message: 'User created',
        user: { id, email, role: userRole, displayName: resolvedDisplayName },
        temporaryPassword: password ? undefined : userPassword, // Only return if auto-generated
      });
    } catch (insertError: any) {
      // Handle race condition: Another request created the same user between check and insert
      if (insertError.message && insertError.message.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'Email already registered (race condition detected)' });
      }
      throw insertError; // Re-throw if it's not a UNIQUE constraint error
    }
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (admin only) — role and/or displayName
router.patch('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { role, displayName } = req.body as { role?: unknown; displayName?: unknown };

  const updates: { column: string; value: unknown }[] = [];

  // Role-validering (oförändrad semantik — bara om fältet faktiskt skickas).
  if (role !== undefined) {
    if (typeof role !== 'string' || !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Ogiltig roll' });
    }
    // Förhindra att admin tar bort sin egen admin-access.
    if (req.params.id === req.user!.id && role !== 'admin') {
      return res.status(400).json({ error: 'Du kan inte ta bort din egen admin-åtkomst' });
    }
    updates.push({ column: 'role', value: role });
  }

  // displayName-validering (1-100 tecken efter trim). Tom sträng tolkas som
  // "rensa fältet" och sparas som NULL.
  if (displayName !== undefined) {
    if (displayName === null) {
      updates.push({ column: 'display_name', value: null });
    } else if (typeof displayName !== 'string') {
      return res.status(400).json({ error: 'displayName måste vara en sträng' });
    } else {
      const trimmed = displayName.trim();
      if (trimmed.length === 0) {
        updates.push({ column: 'display_name', value: null });
      } else if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
        return res.status(400).json({ error: `Visningsnamn får vara max ${DISPLAY_NAME_MAX_LENGTH} tecken` });
      } else {
        updates.push({ column: 'display_name', value: trimmed });
      }
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Inget att uppdatera (skicka role och/eller displayName)' });
  }

  try {
    const setClause = updates.map(u => `${u.column} = ?`).join(', ');
    const values = updates.map(u => u.value);
    const result = db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values, req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Användaren hittades inte' });
    }

    res.json({ message: 'Användaren uppdaterades' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Kunde inte uppdatera användare' });
  }
});

// Delete user (admin only)
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    // Prevent self-deletion
    if (req.params.id === req.user!.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
