import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for the template-fields routes (audit L21: previously
 * untested). This router is mounted with mergeParams under
 * /api/templates/:templateId/fields (see templates.ts:
 * `router.use('/:templateId/fields', templateFieldsRouter)`), never at the
 * app top level directly — tests hit it through that full path.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-template-fields.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-template-fields-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-template-fields-0123456789abcdef0123456789abcdef';
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

let templateId: string;

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
    .run(randomUUID(), 'admin@templatefieldstest.local', adminHash, 'admin', 'Template Fields Admin');

  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), 'user@templatefieldstest.local', userHash, 'user', 'Template Fields User');

  templateId = randomUUID();
  db.prepare(`
    INSERT INTO ticket_templates (id, name, title_template, description_template, template_type)
    VALUES (?, ?, ?, ?, 'dynamic')
  `).run(templateId, 'Fields Test Template', 'Title [x]', 'Desc');

  app = createApp();

  ({ agent: adminAgent, token: adminToken, csrf: adminCsrf } = await loginAgent('admin@templatefieldstest.local', 'Admin-P@ss1234!'));
  ({ agent: userAgent, token: userToken, csrf: userCsrf } = await loginAgent('user@templatefieldstest.local', 'User-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/templates/:templateId/fields — auth', () => {
  it('401 without authentication', async () => {
    const res = await request(app).get(`/api/templates/${templateId}/fields`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/templates/:templateId/fields — auth', () => {
  it('401 without authentication (CSRF passed via anon token, still no JWT)', async () => {
    const { agent, csrf } = await anonCsrf();
    const res = await agent
      .post(`/api/templates/${templateId}/fields`)
      .set('x-csrf-token', csrf)
      .send({ field_name: 'should_not_create', field_label: 'Nope', field_type: 'text' });
    expect(res.status).toBe(401);
    const row = db.prepare('SELECT id FROM template_fields WHERE field_name = ?').get('should_not_create');
    expect(row).toBeUndefined();
  });

  it('403 for a non-admin user', async () => {
    const res = await userAgent
      .post(`/api/templates/${templateId}/fields`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ field_name: 'should_not_create_either', field_label: 'Nope', field_type: 'text' });
    expect(res.status).toBe(403);
    const row = db.prepare('SELECT id FROM template_fields WHERE field_name = ?').get('should_not_create_either');
    expect(row).toBeUndefined();
  });

  it('400 when required fields are missing', async () => {
    const res = await adminAgent
      .post(`/api/templates/${templateId}/fields`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ field_name: 'incomplete' });
    expect(res.status).toBe(400);
  });
});

describe('Template field CRUD cycle (admin)', () => {
  let fieldId: string;
  let secondFieldId: string;

  it('creates a field (201) and persists it', async () => {
    const res = await adminAgent
      .post(`/api/templates/${templateId}/fields`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ field_name: 'equipment_type', field_label: 'Typ av utrustning', field_type: 'text', required: true });
    expect(res.status).toBe(201);
    expect(res.body.field_name).toBe('equipment_type');
    expect(res.body.template_id).toBe(templateId);
    fieldId = res.body.id;

    const row = db.prepare('SELECT field_label FROM template_fields WHERE id = ?').get(fieldId) as { field_label: string };
    expect(row.field_label).toBe('Typ av utrustning');
  });

  it('lists fields for the template via GET /', async () => {
    const res = await adminAgent.get(`/api/templates/${templateId}/fields`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((f: { id: string }) => f.id === fieldId)).toBe(true);
  });

  it('updates the field via PUT /:fieldId', async () => {
    const res = await adminAgent
      .put(`/api/templates/${templateId}/fields/${fieldId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ field_label: 'Uppdaterad etikett' });
    expect(res.status).toBe(200);
    expect(res.body.field_label).toBe('Uppdaterad etikett');

    const row = db.prepare('SELECT field_label FROM template_fields WHERE id = ?').get(fieldId) as { field_label: string };
    expect(row.field_label).toBe('Uppdaterad etikett');
  });

  it('404s updating an unknown field id', async () => {
    const res = await adminAgent
      .put(`/api/templates/${templateId}/fields/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ field_label: 'Nope' });
    expect(res.status).toBe(404);
  });

  it('reorders fields via PUT /reorder', async () => {
    const second = await adminAgent
      .post(`/api/templates/${templateId}/fields`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ field_name: 'quantity', field_label: 'Antal', field_type: 'number' });
    expect(second.status).toBe(201);
    secondFieldId = second.body.id;

    const res = await adminAgent
      .put(`/api/templates/${templateId}/fields/reorder`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ ids: [secondFieldId, fieldId] });
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe(secondFieldId);
    expect(res.body[0].position).toBe(0);
    expect(res.body[1].id).toBe(fieldId);
    expect(res.body[1].position).toBe(1);
  });

  it('deletes a field via DELETE /:fieldId', async () => {
    const res = await adminAgent
      .delete(`/api/templates/${templateId}/fields/${fieldId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT id FROM template_fields WHERE id = ?').get(fieldId);
    expect(row).toBeUndefined();
  });

  it('404s deleting the same field again', async () => {
    const res = await adminAgent
      .delete(`/api/templates/${templateId}/fields/${fieldId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(404);
  });
});
