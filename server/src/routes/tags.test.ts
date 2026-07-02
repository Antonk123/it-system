import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for the tags routes (audit L21: previously untested).
 *
 * Covers: 401 without auth (read + write route), 403 for non-admin on the
 * admin-gated write routes, a full CRUD cycle with DB verification, and the
 * UNIQUE(name) negative path the route maps to 400.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-tags.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-tags-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-tags-0123456789abcdef0123456789abcdef';
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
    .run(randomUUID(), 'admin@tagstest.local', adminHash, 'admin', 'Tags Admin');

  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), 'user@tagstest.local', userHash, 'user', 'Tags User');

  app = createApp();

  ({ agent: adminAgent, token: adminToken, csrf: adminCsrf } = await loginAgent('admin@tagstest.local', 'Admin-P@ss1234!'));
  ({ agent: userAgent, token: userToken, csrf: userCsrf } = await loginAgent('user@tagstest.local', 'User-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/tags — auth', () => {
  it('401 without authentication', async () => {
    const res = await request(app).get('/api/tags');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/tags — auth', () => {
  it('401 without authentication (CSRF passed via anon token, still no JWT)', async () => {
    const { agent, csrf } = await anonCsrf();
    const res = await agent.post('/api/tags').set('x-csrf-token', csrf).send({ name: 'Should Not Create' });
    expect(res.status).toBe(401);
    const row = db.prepare('SELECT id FROM tags WHERE name = ?').get('Should Not Create');
    expect(row).toBeUndefined();
  });

  it('403 for a non-admin user', async () => {
    const res = await userAgent
      .post('/api/tags')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ name: 'Should Not Create Either' });
    expect(res.status).toBe(403);
    const row = db.prepare('SELECT id FROM tags WHERE name = ?').get('Should Not Create Either');
    expect(row).toBeUndefined();
  });

  it('400 when name is missing', async () => {
    const res = await adminAgent
      .post('/api/tags')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('Tag CRUD cycle (admin)', () => {
  let tagId: string;

  it('creates a tag (201) with default color and persists it', async () => {
    const res = await adminAgent
      .post('/api/tags')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Brådskande' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Brådskande');
    expect(res.body.color).toBe('#3b82f6');
    tagId = res.body.id;

    const row = db.prepare('SELECT name FROM tags WHERE id = ?').get(tagId) as { name: string };
    expect(row.name).toBe('Brådskande');
  });

  it('rejects a duplicate name (400, UNIQUE constraint)', async () => {
    const res = await adminAgent
      .post('/api/tags')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Brådskande' });
    expect(res.status).toBe(400);
  });

  it('lists the tag via GET /', async () => {
    const res = await adminAgent.get('/api/tags').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((t: { id: string }) => t.id === tagId)).toBe(true);
  });

  it('updates the tag via PUT /:id', async () => {
    const res = await adminAgent
      .put(`/api/tags/${tagId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Kritisk', color: '#ff0000' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Kritisk');
    expect(res.body.color).toBe('#ff0000');

    const row = db.prepare('SELECT name, color FROM tags WHERE id = ?').get(tagId) as { name: string; color: string };
    expect(row.name).toBe('Kritisk');
    expect(row.color).toBe('#ff0000');
  });

  it('deletes the tag via DELETE /:id', async () => {
    const res = await adminAgent
      .delete(`/api/tags/${tagId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId);
    expect(row).toBeUndefined();
  });

  it('404s deleting the same tag again', async () => {
    const res = await adminAgent
      .delete(`/api/tags/${tagId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(404);
  });
});
