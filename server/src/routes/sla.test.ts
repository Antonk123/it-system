import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for the SLA policy routes (audit L21: previously untested).
 *
 * Covers: 401 without auth (read + write route), 403 for non-admin on the
 * admin-gated write routes, a full upsert→read→delete cycle with DB
 * verification (default + company-scoped policies), and a 400 negative path.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-sla.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-sla-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-sla-0123456789abcdef0123456789abcdef';
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

let companyId: string;

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
    .run(randomUUID(), 'admin@slatest.local', adminHash, 'admin', 'SLA Admin');

  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), 'user@slatest.local', userHash, 'user', 'SLA User');

  companyId = randomUUID();
  db.prepare(`INSERT INTO companies (id, name) VALUES (?, ?)`).run(companyId, 'SLA Test AB');

  app = createApp();

  ({ agent: adminAgent, token: adminToken, csrf: adminCsrf } = await loginAgent('admin@slatest.local', 'Admin-P@ss1234!'));
  ({ agent: userAgent, token: userToken, csrf: userCsrf } = await loginAgent('user@slatest.local', 'User-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/sla — auth', () => {
  it('401 without authentication', async () => {
    const res = await request(app).get('/api/sla');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/sla — auth', () => {
  it('401 without authentication (CSRF passed via anon token, still no JWT)', async () => {
    const { agent, csrf } = await anonCsrf();
    const res = await agent
      .put('/api/sla')
      .set('x-csrf-token', csrf)
      .send({ policies: [{ priority: 'high', response_time_minutes: 30, resolution_time_minutes: 240 }] });
    expect(res.status).toBe(401);
  });

  it('403 for a non-admin user', async () => {
    const res = await userAgent
      .put('/api/sla')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ policies: [{ priority: 'high', response_time_minutes: 30, resolution_time_minutes: 240 }] });
    expect(res.status).toBe(403);
  });

  it('400 when policies is not an array', async () => {
    const res = await adminAgent
      .put('/api/sla')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ policies: 'not-an-array' });
    expect(res.status).toBe(400);
  });
});

describe('SLA policy upsert → read → delete cycle (admin, default/no-company scope)', () => {
  it('upserts default policies via PUT / and persists them', async () => {
    const res = await adminAgent
      .put('/api/sla')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({
        policies: [
          { priority: 'low', response_time_minutes: 480, resolution_time_minutes: 2880 },
          { priority: 'high', response_time_minutes: 60, resolution_time_minutes: 480 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);

    const rows = db.prepare('SELECT priority FROM sla_policies WHERE company_id IS NULL').all() as { priority: string }[];
    expect(rows.length).toBe(2);
  });

  it('lists default policies via GET /?company_id=default', async () => {
    const res = await adminAgent
      .get('/api/sla?company_id=default')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('replaces default policies on a second PUT / (delete-then-insert semantics)', async () => {
    const res = await adminAgent
      .put('/api/sla')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ policies: [{ priority: 'critical', response_time_minutes: 15, resolution_time_minutes: 120 }] });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].priority).toBe('critical');

    const rows = db.prepare('SELECT priority FROM sla_policies WHERE company_id IS NULL').all() as { priority: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].priority).toBe('critical');
  });

  it('deletes a policy via DELETE /:id', async () => {
    const row = db.prepare('SELECT id FROM sla_policies WHERE company_id IS NULL').get() as { id: string };
    const res = await adminAgent
      .delete(`/api/sla/${row.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(200);

    const gone = db.prepare('SELECT id FROM sla_policies WHERE id = ?').get(row.id);
    expect(gone).toBeUndefined();
  });

  it('404s deleting an unknown policy id', async () => {
    const res = await adminAgent
      .delete(`/api/sla/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(404);
  });
});

describe('Company-scoped SLA policies', () => {
  it('upserts policies for a specific company_id and keeps them separate from defaults', async () => {
    const res = await adminAgent
      .put('/api/sla')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({
        company_id: companyId,
        policies: [{ priority: 'medium', response_time_minutes: 120, resolution_time_minutes: 960 }],
      });
    expect(res.status).toBe(200);
    expect(res.body[0].company_id).toBe(companyId);

    const scoped = db.prepare('SELECT * FROM sla_policies WHERE company_id = ?').all(companyId) as { priority: string }[];
    expect(scoped.length).toBe(1);
    expect(scoped[0].priority).toBe('medium');

    const filtered = await adminAgent.get(`/api/sla?company_id=${companyId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.length).toBe(1);
  });
});
