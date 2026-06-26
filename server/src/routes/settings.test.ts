import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-settings-route.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-settings-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-settings-0123456789abcdef0123456789abcdef';
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
  const a = request.agent(app);
  const login = await a.post('/api/auth/login').send({ email, password });
  const token = login.body.accessToken as string;
  const csrfRes = await a.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  return { agent: a, token, csrf: csrfRes.body.csrfToken as string };
}

beforeAll(async () => {
  initializeDatabase();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), 'admin@settingstest.local', adminHash, 'admin', 'Admin');
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), 'user@settingstest.local', userHash, 'user', 'User');

  app = createApp();
  ({ agent: adminAgent, token: adminToken, csrf: adminCsrf } = await loginAgent('admin@settingstest.local', 'Admin-P@ss1234!'));
  ({ agent: userAgent, token: userToken, csrf: userCsrf } = await loginAgent('user@settingstest.local', 'User-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/settings', () => {
  it('401 without authentication', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('returns twoWayEmailEnabled=true by default for an authenticated user', async () => {
    const res = await userAgent.get('/api/settings').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ twoWayEmailEnabled: true });
  });
});

describe('PUT /api/settings/two-way-email', () => {
  it('403 for a non-admin user', async () => {
    const res = await userAgent
      .put('/api/settings/two-way-email')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ enabled: false });
    expect(res.status).toBe(403);
  });

  it('400 when enabled is not a boolean (admin)', async () => {
    const res = await adminAgent
      .put('/api/settings/two-way-email')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ enabled: 'nope' });
    expect(res.status).toBe(400);
  });

  it('admin can disable two-way email; GET then reflects it', async () => {
    const put = await adminAgent
      .put('/api/settings/two-way-email')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ enabled: false });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ twoWayEmailEnabled: false });

    const get = await adminAgent.get('/api/settings').set('Authorization', `Bearer ${adminToken}`);
    expect(get.body).toEqual({ twoWayEmailEnabled: false });
  });
});
