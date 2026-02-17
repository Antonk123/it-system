import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';

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

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Generate a random password if not provided
  const userPassword = password || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8).toUpperCase();

  try {
    // Check if email already exists
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

    db.prepare(`
      INSERT INTO users (id, email, password_hash, role, display_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, email, passwordHash, userRole, resolvedDisplayName);

    res.status(201).json({
      message: 'User created',
      user: { id, email, role: userRole, displayName: resolvedDisplayName },
      temporaryPassword: password ? undefined : userPassword, // Only return if auto-generated
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user role (admin only)
router.patch('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { role } = req.body;

  if (!role || !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Valid role is required' });
  }

  try {
    // Prevent removing own admin access
    if (req.params.id === req.user!.id && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot remove your own admin access' });
    }

    const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'Role updated' });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update role' });
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
