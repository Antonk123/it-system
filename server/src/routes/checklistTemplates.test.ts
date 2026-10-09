import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for the checklist-templates routes (audit L21: previously
 * untested). Two distinct authz mechanisms live in this file:
 *  - requireAdmin on the CRUD routes (GET is open, POST/PUT/DELETE admin-only)
 *  - canAccessTicket (NOT requireAdmin) on POST /:id/apply — any user with a
 *    relationship to the target ticket (requester/assignee/creator) may apply
 *    a template to it; a stranger is rejected with 403. Both are exercised
 *    with actual middleware, not assumed.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-checklist-templates.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-checklist-templates-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-checklist-templates-0123456789abcdef0123456789abcdef';
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
let userId: string;

let strangerAgent: ReturnType<typeof request.agent>;
let strangerToken: string;
let strangerCsrf: string;

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
    .run(randomUUID(), 'admin@checklisttplttest.local', adminHash, 'admin', 'CT Admin');

  userId = randomUUID();
  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, 'user@checklisttplttest.local', userHash, 'user', 'CT User');

  const strangerHash = await bcrypt.hash('Stranger-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), 'stranger@checklisttplttest.local', strangerHash, 'user', 'CT Stranger');

  app = createApp();

  ({ agent: adminAgent, token: adminToken, csrf: adminCsrf } = await loginAgent('admin@checklisttplttest.local', 'Admin-P@ss1234!'));
  ({ agent: userAgent, token: userToken, csrf: userCsrf } = await loginAgent('user@checklisttplttest.local', 'User-P@ss1234!'));
  ({ agent: strangerAgent, token: strangerToken, csrf: strangerCsrf } = await loginAgent('stranger@checklisttplttest.local', 'Stranger-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/checklist-templates — auth', () => {
  it('401 without authentication', async () => {
    const res = await request(app).get('/api/checklist-templates');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/checklist-templates — auth', () => {
  it('401 without authentication (CSRF passed via anon token, still no JWT)', async () => {
    const { agent, csrf } = await anonCsrf();
    const res = await agent
      .post('/api/checklist-templates')
      .set('x-csrf-token', csrf)
      .send({ name: 'Should Not Create', items: [{ label: 'Step 1' }] });
    expect(res.status).toBe(401);
    const row = db.prepare('SELECT id FROM checklist_templates WHERE name = ?').get('Should Not Create');
    expect(row).toBeUndefined();
  });

  it('403 for a non-admin user', async () => {
    const res = await userAgent
      .post('/api/checklist-templates')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ name: 'Should Not Create Either', items: [{ label: 'Step 1' }] });
    expect(res.status).toBe(403);
    const row = db.prepare('SELECT id FROM checklist_templates WHERE name = ?').get('Should Not Create Either');
    expect(row).toBeUndefined();
  });

  it('400 when name is missing', async () => {
    const res = await adminAgent
      .post('/api/checklist-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ items: [{ label: 'Step 1' }] });
    expect(res.status).toBe(400);
  });

  it('400 when items is missing/empty', async () => {
    const res = await adminAgent
      .post('/api/checklist-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'No Items Template', items: [] });
    expect(res.status).toBe(400);
  });
});

describe('Checklist template CRUD cycle (admin)', () => {
  let templateId: string;

  it('creates a template with items (201) and persists it', async () => {
    const res = await adminAgent
      .post('/api/checklist-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({
        name: 'Ny dator — setup',
        description: 'Checklista för nyanställd',
        items: [{ label: 'Beställ dator' }, { label: 'Installera mjukvara' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Ny dator — setup');
    expect(res.body.items.length).toBe(2);
    templateId = res.body.id;

    const row = db.prepare('SELECT name FROM checklist_templates WHERE id = ?').get(templateId) as { name: string };
    expect(row.name).toBe('Ny dator — setup');
    const items = db.prepare('SELECT label FROM checklist_template_items WHERE template_id = ?').all(templateId) as { label: string }[];
    expect(items.length).toBe(2);
  });

  it('409s creating a template with a duplicate name', async () => {
    const res = await adminAgent
      .post('/api/checklist-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Ny dator — setup', items: [{ label: 'x' }] });
    expect(res.status).toBe(409);
  });

  it('lists the template with items via GET /', async () => {
    const res = await adminAgent.get('/api/checklist-templates').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const found = res.body.find((t: { id: string }) => t.id === templateId);
    expect(found).toBeDefined();
    expect(found.items.length).toBe(2);
  });

  it('updates the template (name + replaces items) via PUT /:id', async () => {
    const res = await adminAgent
      .put(`/api/checklist-templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Ny dator — setup (v2)', items: [{ label: 'Beställ dator' }] });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Ny dator — setup (v2)');
    expect(res.body.items.length).toBe(1);

    const items = db.prepare('SELECT label FROM checklist_template_items WHERE template_id = ?').all(templateId) as { label: string }[];
    expect(items.length).toBe(1);
  });

  it('404s updating an unknown template id', async () => {
    const res = await adminAgent
      .put(`/api/checklist-templates/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });

  it('deletes the template via DELETE /:id', async () => {
    const res = await adminAgent
      .delete(`/api/checklist-templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT id FROM checklist_templates WHERE id = ?').get(templateId);
    expect(row).toBeUndefined();
  });

  it('404s deleting the same template again', async () => {
    const res = await adminAgent
      .delete(`/api/checklist-templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(404);
  });
});

describe('Checklist template writes are atomic and validated', () => {
  const adminPost = (body: unknown) =>
    adminAgent.post('/api/checklist-templates').set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrf).send(body as object);
  const adminPut = (id: string, body: unknown) =>
    adminAgent.put(`/api/checklist-templates/${id}`).set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrf).send(body as object);
  const itemLabels = (id: string) =>
    (db.prepare('SELECT label FROM checklist_template_items WHERE template_id = ? ORDER BY position').all(id) as { label: string }[]).map(i => i.label);

  it('POST rejects non-string label/parent_label with 400 and creates no template row', async () => {
    const res = await adminPost({ name: 'Atomic POST', items: [{ label: 'ok' }, { label: 42 }] });
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT id FROM checklist_templates WHERE name = ?').get('Atomic POST')).toBeUndefined();

    const res2 = await adminPost({ name: 'Atomic POST', items: [{ label: 'ok', parent_label: { a: 1 } }] });
    expect(res2.status).toBe(400);
    expect(db.prepare('SELECT id FROM checklist_templates WHERE name = ?').get('Atomic POST')).toBeUndefined();
  });

  it('PUT with an invalid item leaves name and items untouched', async () => {
    const created = await adminPost({ name: 'Atomic PUT', description: 'orig', items: [{ label: 'A' }, { label: 'B' }] });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const res = await adminPut(id, { name: 'Renamed', items: [{ label: 'A' }, { label: null }] });
    expect(res.status).toBe(400);

    const row = db.prepare('SELECT name, description FROM checklist_templates WHERE id = ?').get(id) as { name: string; description: string };
    expect(row.name).toBe('Atomic PUT');
    expect(row.description).toBe('orig');
    expect(itemLabels(id)).toEqual(['A', 'B']);
  });

  it('PUT rolls back the name change when the item insert fails (409 on duplicate name keeps items)', async () => {
    const a = await adminPost({ name: 'Rollback A', items: [{ label: 'keep me' }] });
    await adminPost({ name: 'Rollback B', items: [{ label: 'other' }] });
    const res = await adminPut(a.body.id, { name: 'Rollback B', items: [{ label: 'new item' }] });
    expect(res.status).toBe(409);
    expect(itemLabels(a.body.id)).toEqual(['keep me']);
  });

  it('PUT applies a description-only update without touching name or items', async () => {
    const created = await adminPost({ name: 'Desc only', description: 'before', items: [{ label: 'X' }] });
    const id = created.body.id as string;

    const res = await adminPut(id, { description: '  after  ' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Desc only');
    expect(res.body.description).toBe('after');
    expect(itemLabels(id)).toEqual(['X']);
  });

  it('PUT with only a name keeps the existing description', async () => {
    const created = await adminPost({ name: 'Name only', description: 'stay', items: [{ label: 'X' }] });
    const res = await adminPut(created.body.id, { name: 'Name only v2' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('stay');
  });
});

describe('POST /api/checklist-templates/:id/apply — canAccessTicket authorization (not requireAdmin)', () => {
  let applyTemplateId: string;
  let ownedTicketId: string;

  beforeAll(() => {
    applyTemplateId = randomUUID();
    db.prepare('INSERT INTO checklist_templates (id, name) VALUES (?, ?)').run(applyTemplateId, 'Apply Template');
    db.prepare('INSERT INTO checklist_template_items (id, template_id, label, position) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), applyTemplateId, 'Applied Step 1', 0);

    ownedTicketId = randomUUID();
    // Tilldelat `userId` så att en främling saknar skrivrätt (otilldelade ärenden är öppna).
    db.prepare(`INSERT INTO tickets (id, title, description, status, created_by, assigned_to) VALUES (?, ?, ?, 'open', ?, ?)`)
      .run(ownedTicketId, 'Owned Ticket', 'desc', userId, userId);
  });

  it('lets the ticket creator (non-admin) apply the template (201), creating checklist rows', async () => {
    const res = await userAgent
      .post(`/api/checklist-templates/${applyTemplateId}/apply`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ ticketId: ownedTicketId });
    expect(res.status).toBe(201);
    expect(res.body.length).toBe(1);
    expect(res.body[0].label).toBe('Applied Step 1');

    const rows = db.prepare('SELECT label FROM ticket_checklists WHERE ticket_id = ?').all(ownedTicketId) as { label: string }[];
    expect(rows.length).toBe(1);
  });

  it('403s a stranger on a ticket assigned to someone else', async () => {
    const res = await strangerAgent
      .post(`/api/checklist-templates/${applyTemplateId}/apply`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .set('x-csrf-token', strangerCsrf)
      .send({ ticketId: ownedTicketId });
    expect(res.status).toBe(403);
  });

  it('404s when the ticket does not exist', async () => {
    const res = await userAgent
      .post(`/api/checklist-templates/${applyTemplateId}/apply`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ ticketId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it('400 when ticketId is missing', async () => {
    const res = await userAgent
      .post(`/api/checklist-templates/${applyTemplateId}/apply`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({});
    expect(res.status).toBe(400);
  });
});
