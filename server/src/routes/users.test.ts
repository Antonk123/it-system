import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Integration tests for the /api/users routes (audit-v3 LOW).
 *
 * Covers:
 *  - Admin-only endpoints (POST create, PATCH update, DELETE) reject a
 *    non-admin user (403) and accept an admin.
 *  - Password-policy validation on create + the self-demotion / self-deletion
 *    guards that the route exposes.
 *
 * Harness mirrors checklists.test.ts: vi.hoisted() sets a UNIQUE DB_PATH
 * (suffix -users) BEFORE any import that pulls in db/connection.ts, plus
 * NODE_ENV=test and CSRF_SECRET / JWT_SECRET (≥32 chars; short exits unless ALLOW_WEAK_SECRETS=1).
 *
 * Login is rate-limited (5 attempts / 15 min / IP). We log in each user
 * exactly once (admin + non-admin) and reuse the persistent csrf-agent.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-users.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-users-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-users-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

type Session = { agent: ReturnType<typeof request.agent>; token: string; csrf: string };

let app: ReturnType<typeof createApp>;

let admin: Session;
let user: Session;

let adminId: string;
let userId: string;

async function login(email: string, password: string): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const token = res.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  return { agent, token, csrf: csrfRes.body.csrfToken as string };
}

beforeAll(async () => {
  initializeDatabase();

  adminId = randomUUID();
  userId = randomUUID();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const userHash = await bcrypt.hash('User-P@ss1234!', 10);

  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(adminId, 'admin@userstest.local', adminHash, 'admin', 'Users Admin');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, 'user@userstest.local', userHash, 'user', 'Plain User');

  app = createApp();

  admin = await login('admin@userstest.local', 'Admin-P@ss1234!');
  user = await login('user@userstest.local', 'User-P@ss1234!');
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/users — auth required, payload by role', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('returns the full admin payload (email, lastSignIn) for an admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    const me = res.body.users.find((u: any) => u.id === adminId);
    expect(me).toBeDefined();
    expect(me.email).toBe('admin@userstest.local');
    expect(me).toHaveProperty('lastSignIn');
    expect(me.emailConfirmed).toBe(true);
  });

  it('returns the reduced payload (no email) for a non-admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    const someone = res.body.users[0];
    expect(someone).toHaveProperty('displayName');
    expect(someone).toHaveProperty('role');
    expect(someone.email).toBeUndefined();
    expect(someone.lastSignIn).toBeUndefined();
  });
});

describe('POST /api/users — admin only + password policy', () => {
  it('rejects a non-admin with 403', async () => {
    const res = await user.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf)
      .send({ email: 'blocked@userstest.local', role: 'user' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('rejects a weak password with 400 (password policy)', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'weakpw@userstest.local', password: 'short', role: 'user' });
    expect(res.status).toBe(400);
    // passwordPolicy.ts → "minst 12 tecken" for a too-short password.
    expect(res.body.error).toMatch(/tecken|lösenord/i);
  });

  it('rejects a long-but-no-special-char password with 400 (policy regex)', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'nospecial@userstest.local', password: 'Abcdefgh1234', role: 'user' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/specialtecken/i);
  });

  it('rejects an invalid email format with 400', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'not-an-email', role: 'user' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/e-post|format/i);
  });

  it('creates a user with a strong password (201) and persists the row', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({
        // Policy regex only allows special chars from the set @$!%*?& — no hyphen.
        email: 'created@userstest.local',
        password: 'Str0ngP@ssw0rd!',
        role: 'user',
        displayName: 'Created User',
      });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('created@userstest.local');
    expect(res.body.user.role).toBe('user');
    // Password was supplied → no temporaryPassword returned.
    expect(res.body.temporaryPassword).toBeUndefined();

    const row = db.prepare('SELECT email, role FROM users WHERE email = ?').get('created@userstest.local') as
      | { email: string; role: string }
      | undefined;
    expect(row?.role).toBe('user');
  });

  it('auto-generates a temporary password when none is supplied (201)', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'autogen@userstest.local', role: 'user' });
    expect(res.status).toBe(201);
    expect(typeof res.body.temporaryPassword).toBe('string');
    expect(res.body.temporaryPassword.length).toBeGreaterThan(0);
  });
});

describe('PATCH /api/users/:id — admin only', () => {
  it('rejects a non-admin with 403', async () => {
    const res = await user.agent
      .patch(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('rejects an invalid role with 400', async () => {
    const res = await admin.agent
      .patch(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ role: 'superuser' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/roll/i);
  });

  it('prevents an admin from removing their own admin access (400)', async () => {
    const res = await admin.agent
      .patch(`/api/users/${adminId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ role: 'user' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/admin-åtkomst/i);
  });

  it('lets an admin update another user\'s display name (200)', async () => {
    const res = await admin.agent
      .patch(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ displayName: 'Renamed User' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as { display_name: string };
    expect(row.display_name).toBe('Renamed User');
  });

  it('returns 404 for a non-existent user id', async () => {
    const res = await admin.agent
      .patch(`/api/users/${randomUUID()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ role: 'user' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/users/:id — admin only', () => {
  it('rejects a non-admin with 403', async () => {
    const res = await user.agent
      .delete(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('prevents an admin from deleting their own account (400)', async () => {
    const res = await admin.agent
      .delete(`/api/users/${adminId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
  });

  it('returns 404 when deleting a non-existent user', async () => {
    const res = await admin.agent
      .delete(`/api/users/${randomUUID()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(404);
  });

  it('lets an admin delete an existing (other) user (200)', async () => {
    // Seed a throwaway user to delete (avoids extra logins).
    const throwawayId = randomUUID();
    db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
      .run(throwawayId, 'throwaway@userstest.local', await bcrypt.hash('x', 4), 'user', 'Throwaway');

    const res = await admin.agent
      .delete(`/api/users/${throwawayId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(throwawayId);
    expect(row).toBeUndefined();
  });
});
