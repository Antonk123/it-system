import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for the ticket-templates routes (audit L21: previously
 * untested). Priority file (225 lines) — extra coverage for the
 * template→fields relation: dynamic templates can create fields inline on
 * POST /, and GET / groups fields per template in memory (N+1 fix), so both
 * are exercised explicitly.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-templates.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-templates-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-templates-0123456789abcdef0123456789abcdef';
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
    .run(randomUUID(), 'admin@templatestest.local', adminHash, 'admin', 'Templates Admin');

  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), 'user@templatestest.local', userHash, 'user', 'Templates User');

  app = createApp();

  ({ agent: adminAgent, token: adminToken, csrf: adminCsrf } = await loginAgent('admin@templatestest.local', 'Admin-P@ss1234!'));
  ({ agent: userAgent, token: userToken, csrf: userCsrf } = await loginAgent('user@templatestest.local', 'User-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/templates — auth', () => {
  it('401 without authentication', async () => {
    const res = await request(app).get('/api/templates');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/templates — auth', () => {
  it('401 without authentication (CSRF passed via anon token, still no JWT)', async () => {
    const { agent, csrf } = await anonCsrf();
    const res = await agent
      .post('/api/templates')
      .set('x-csrf-token', csrf)
      .send({ name: 'Should Not Create', title_template: 'x', description_template: 'y' });
    expect(res.status).toBe(401);
    const row = db.prepare('SELECT id FROM ticket_templates WHERE name = ?').get('Should Not Create');
    expect(row).toBeUndefined();
  });

  it('403 for a non-admin user', async () => {
    const res = await userAgent
      .post('/api/templates')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ name: 'Should Not Create Either', title_template: 'x', description_template: 'y' });
    expect(res.status).toBe(403);
    const row = db.prepare('SELECT id FROM ticket_templates WHERE name = ?').get('Should Not Create Either');
    expect(row).toBeUndefined();
  });

  it('400 when name/title_template are missing', async () => {
    const res = await adminAgent
      .post('/api/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ description_template: 'y' });
    expect(res.status).toBe(400);
  });

  it('400 for a standard template missing description_template', async () => {
    const res = await adminAgent
      .post('/api/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Missing Desc', title_template: 'Title', template_type: 'standard' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/templates/:id — 404', () => {
  it('404s for an unknown template id', async () => {
    const res = await adminAgent.get(`/api/templates/${randomUUID()}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('Template CRUD cycle (admin, standard template)', () => {
  let templateId: string;

  it('creates a standard template (201) and persists it', async () => {
    const res = await adminAgent
      .post('/api/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({
        name: 'Nätverksfel',
        title_template: 'Nätverksfel: [plats]',
        description_template: 'Beskriv felet',
        priority: 'high',
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Nätverksfel');
    expect(res.body.fields).toEqual([]);
    templateId = res.body.id;

    const row = db.prepare('SELECT name FROM ticket_templates WHERE id = ?').get(templateId) as { name: string };
    expect(row.name).toBe('Nätverksfel');
  });

  it('lists the template with an empty fields array via GET /', async () => {
    const res = await adminAgent.get('/api/templates').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const found = res.body.find((t: { id: string }) => t.id === templateId);
    expect(found).toBeDefined();
    expect(found.fields).toEqual([]);
  });

  it('fetches the single template via GET /:id', async () => {
    const res = await adminAgent.get(`/api/templates/${templateId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(templateId);
    expect(res.body.fields).toEqual([]);
  });

  it('updates the template via PUT /:id', async () => {
    const res = await adminAgent
      .put(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Nätverksfel (uppdaterad)', priority: 'critical' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Nätverksfel (uppdaterad)');
    expect(res.body.priority).toBe('critical');

    const row = db.prepare('SELECT name, priority FROM ticket_templates WHERE id = ?').get(templateId) as { name: string; priority: string };
    expect(row.name).toBe('Nätverksfel (uppdaterad)');
    expect(row.priority).toBe('critical');
  });

  it('reorders templates via PUT /reorder', async () => {
    const other = await adminAgent
      .post('/api/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Andra mallen', title_template: 'x', description_template: 'y' });
    expect(other.status).toBe(201);

    // NOTE: a seed template ('template-3', from migration 005) already occupies
    // position 0 and is untouched by this reorder call, so we assert on the
    // DB rows for our two ids directly rather than on response array order.
    const res = await adminAgent
      .put('/api/templates/reorder')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ ids: [other.body.id, templateId] });
    expect(res.status).toBe(200);

    const otherPos = (db.prepare('SELECT position FROM ticket_templates WHERE id = ?').get(other.body.id) as { position: number }).position;
    const templatePos = (db.prepare('SELECT position FROM ticket_templates WHERE id = ?').get(templateId) as { position: number }).position;
    expect(otherPos).toBe(0);
    expect(templatePos).toBe(1);

    // cleanup the extra template so later list-length assumptions stay simple
    await adminAgent
      .delete(`/api/templates/${other.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
  });

  it('deletes the template via DELETE /:id', async () => {
    const res = await adminAgent
      .delete(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT id FROM ticket_templates WHERE id = ?').get(templateId);
    expect(row).toBeUndefined();
  });

  it('404s deleting the same template again', async () => {
    const res = await adminAgent
      .delete(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(404);
  });
});

describe('Dynamic template with inline fields (relation: template → fields)', () => {
  it('creates a dynamic template and its fields together on POST /', async () => {
    const res = await adminAgent
      .post('/api/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({
        name: 'Hårdvarubeställning (test)',
        title_template: 'Beställning: [typ]',
        // description_template utelämnas medvetet: dynamiska mallar komponerar
        // beskrivningen från fälten, och routen defaultar till '' (NOT NULL-kolumn).
        template_type: 'dynamic',
        fields: [
          { field_name: 'equipment_type', field_label: 'Typ av utrustning', field_type: 'text', required: true },
          { field_name: 'quantity', field_label: 'Antal', field_type: 'number' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.template_type).toBe('dynamic');
    expect(res.body.fields.length).toBe(2);

    const dbFields = db.prepare('SELECT field_name FROM template_fields WHERE template_id = ? ORDER BY position ASC').all(res.body.id) as { field_name: string }[];
    expect(dbFields.map(f => f.field_name)).toEqual(['equipment_type', 'quantity']);

    // The mounted sub-router (template-fields.ts) sees the same fields via
    // GET /api/templates/:templateId/fields — proves the router.use() mount works.
    const viaSubRouter = await adminAgent
      .get(`/api/templates/${res.body.id}/fields`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(viaSubRouter.status).toBe(200);
    expect(viaSubRouter.body.length).toBe(2);

    const single = await adminAgent.get(`/api/templates/${res.body.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(single.body.fields.length).toBe(2);
  });
});
