import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for the categories routes (audit L21: previously untested).
 *
 * Covers: 401 without auth (read + write route), 403 for non-admin on the
 * admin-gated write routes, a full CRUD cycle with DB verification, and a
 * 404/400 negative path.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-categories.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-categories-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-categories-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;

let adminAgent: ReturnType<typeof request.agent>;
let adminToken: string;
let adminCsrf: string;

let userAgent: ReturnType<typeof request.agent>;
let userToken: string;
let userCsrf: string;

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  const token = login.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  return { agent, token, csrf: csrfRes.body.csrfToken as string };
}

/**
 * A CSRF token minted WITHOUT an Authorization header. Session identifier for
 * csrf-csrf is derived from the JWT sub claim (app.ts getSessionIdentifier) —
 * absent header → identifier ''. This lets a mutating request pass the CSRF
 * layer while still being unauthenticated, so it reaches `authenticate` and
 * genuinely proves 401 (not a CSRF 403) for write routes.
 */
async function anonCsrf() {
  const agent = request.agent(app);
  const res = await agent.get('/api/csrf-token');
  expect(res.status).toBe(200);
  return { agent, csrf: res.body.csrfToken as string };
}

beforeAll(async () => {
  initializeDatabase();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), 'admin@categoriestest.local', adminHash, 'admin', 'Categories Admin');

  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), 'user@categoriestest.local', userHash, 'user', 'Categories User');

  app = createApp();

  ({ agent: adminAgent, token: adminToken, csrf: adminCsrf } = await loginAgent('admin@categoriestest.local', 'Admin-P@ss1234!'));
  ({ agent: userAgent, token: userToken, csrf: userCsrf } = await loginAgent('user@categoriestest.local', 'User-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/categories — auth', () => {
  it('401 without authentication', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/categories — auth', () => {
  it('401 without authentication (CSRF passed via anon token, still no JWT)', async () => {
    const { agent, csrf } = await anonCsrf();
    const res = await agent.post('/api/categories').set('x-csrf-token', csrf).send({ label: 'Should Not Create' });
    expect(res.status).toBe(401);
    const row = db.prepare('SELECT id FROM categories WHERE label = ?').get('Should Not Create');
    expect(row).toBeUndefined();
  });

  it('403 for a non-admin user', async () => {
    const res = await userAgent
      .post('/api/categories')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ label: 'Should Not Create Either' });
    expect(res.status).toBe(403);
    const row = db.prepare('SELECT id FROM categories WHERE label = ?').get('Should Not Create Either');
    expect(row).toBeUndefined();
  });

  it('400 when label is missing', async () => {
    const res = await adminAgent
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('Category CRUD cycle (admin)', () => {
  let categoryId: string;

  it('creates a category (201) and persists it', async () => {
    const res = await adminAgent
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ label: 'Nätverk' });
    expect(res.status).toBe(201);
    expect(res.body.label).toBe('Nätverk');
    categoryId = res.body.id;

    const row = db.prepare('SELECT label FROM categories WHERE id = ?').get(categoryId) as { label: string };
    expect(row.label).toBe('Nätverk');
  });

  it('lists the category via GET /', async () => {
    const res = await adminAgent.get('/api/categories').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((c: { id: string }) => c.id === categoryId)).toBe(true);
  });

  it('updates the category label via PUT /:id', async () => {
    const res = await adminAgent
      .put(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ label: 'Nätverk & Wifi' });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Nätverk & Wifi');

    const row = db.prepare('SELECT label FROM categories WHERE id = ?').get(categoryId) as { label: string };
    expect(row.label).toBe('Nätverk & Wifi');
  });

  it('deletes the category via DELETE /:id', async () => {
    const res = await adminAgent
      .delete(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
    expect(row).toBeUndefined();
  });

  it('404s deleting the same category again', async () => {
    const res = await adminAgent
      .delete(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(404);
  });
});
