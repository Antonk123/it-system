import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for the companies routes (audit L21: previously untested).
 * Priority file (200 lines) — extra coverage for the company→contacts
 * relation exposed on GET /:id, and for the sla_disabled toggle side-effect
 * that re-syncs open tickets' SLA deadlines on PUT /:id.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-companies.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-companies-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-companies-0123456789abcdef0123456789abcdef';
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
    .run(randomUUID(), 'admin@companiestest.local', adminHash, 'admin', 'Companies Admin');

  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), 'user@companiestest.local', userHash, 'user', 'Companies User');

  app = createApp();

  ({ agent: adminAgent, token: adminToken, csrf: adminCsrf } = await loginAgent('admin@companiestest.local', 'Admin-P@ss1234!'));
  ({ agent: userAgent, token: userToken, csrf: userCsrf } = await loginAgent('user@companiestest.local', 'User-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/companies — auth', () => {
  it('401 without authentication', async () => {
    const res = await request(app).get('/api/companies');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/companies — auth', () => {
  it('401 without authentication (CSRF passed via anon token, still no JWT)', async () => {
    const { agent, csrf } = await anonCsrf();
    const res = await agent.post('/api/companies').set('x-csrf-token', csrf).send({ name: 'Should Not Create AB' });
    expect(res.status).toBe(401);
    const row = db.prepare('SELECT id FROM companies WHERE name = ?').get('Should Not Create AB');
    expect(row).toBeUndefined();
  });

  it('403 for a non-admin user', async () => {
    const res = await userAgent
      .post('/api/companies')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ name: 'Should Not Create Either AB' });
    expect(res.status).toBe(403);
    const row = db.prepare('SELECT id FROM companies WHERE name = ?').get('Should Not Create Either AB');
    expect(row).toBeUndefined();
  });

  it('400 when name is missing', async () => {
    const res = await adminAgent
      .post('/api/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/companies/:id — 404', () => {
  it('404s for an unknown company id', async () => {
    const res = await adminAgent.get(`/api/companies/${randomUUID()}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('Company CRUD cycle (admin)', () => {
  let companyId: string;

  it('creates a company (201) and persists it', async () => {
    const res = await adminAgent
      .post('/api/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Kaarle AB', org_number: '556677-8899', email: 'info@kaarle.example', phone: '08-1234567' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Kaarle AB');
    companyId = res.body.id;

    const row = db.prepare('SELECT name FROM companies WHERE id = ?').get(companyId) as { name: string };
    expect(row.name).toBe('Kaarle AB');
  });

  it('lists the company with stats via GET /', async () => {
    const res = await adminAgent.get('/api/companies').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const found = res.body.find((c: { id: string }) => c.id === companyId);
    expect(found).toBeDefined();
    expect(found.contact_count).toBe(0);
    expect(found.open_ticket_count).toBe(0);
  });

  it('fetches the single company via GET /:id (contacts + stats)', async () => {
    const res = await adminAgent.get(`/api/companies/${companyId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(companyId);
    expect(res.body.contacts).toEqual([]);
    expect(res.body.stats.total).toBe(0);
  });

  it('updates the company via PUT /:id', async () => {
    const res = await adminAgent
      .put(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Kaarle Konsult AB', phone: '08-9998877' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Kaarle Konsult AB');
    expect(res.body.phone).toBe('08-9998877');

    const row = db.prepare('SELECT name, phone FROM companies WHERE id = ?').get(companyId) as { name: string; phone: string };
    expect(row.name).toBe('Kaarle Konsult AB');
    expect(row.phone).toBe('08-9998877');
  });

  it('400 when PUT /:id has no fields to update', async () => {
    const res = await adminAgent
      .put(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({});
    expect(res.status).toBe(400);
  });

  it('relation: a contact linked via company_id shows up in GET /:id and bumps contact_count', async () => {
    const contactId = randomUUID();
    db.prepare('INSERT INTO contacts (id, name, email, company_id) VALUES (?, ?, ?, ?)')
      .run(contactId, 'Kalle Kontakt', 'kalle@kaarle.example', companyId);

    const single = await adminAgent.get(`/api/companies/${companyId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(single.status).toBe(200);
    expect(single.body.contacts.length).toBe(1);
    expect(single.body.contacts[0].id).toBe(contactId);

    const list = await adminAgent.get('/api/companies').set('Authorization', `Bearer ${adminToken}`);
    const found = list.body.find((c: { id: string }) => c.id === companyId);
    expect(found.contact_count).toBe(1);
  });

  it('sla_disabled toggle clears SLA deadlines on open tickets for that company', async () => {
    const ticketId = randomUUID();
    db.prepare(`
      INSERT INTO tickets (id, title, description, status, priority, company_id, sla_response_deadline, sla_resolution_deadline)
      VALUES (?, ?, ?, 'open', 'high', ?, ?, ?)
    `).run(ticketId, 'SLA Ticket', 'desc', companyId, '2099-01-01T00:00:00.000Z', '2099-01-02T00:00:00.000Z');

    const res = await adminAgent
      .put(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ sla_disabled: true });
    expect(res.status).toBe(200);
    expect(res.body.sla_disabled).toBe(1);

    const ticket = db.prepare('SELECT sla_response_deadline, sla_resolution_deadline FROM tickets WHERE id = ?').get(ticketId) as
      { sla_response_deadline: string | null; sla_resolution_deadline: string | null };
    expect(ticket.sla_response_deadline).toBeNull();
    expect(ticket.sla_resolution_deadline).toBeNull();
  });

  it('deletes the company via DELETE /:id (contacts survive, company_id set null)', async () => {
    const res = await adminAgent
      .delete(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
    expect(row).toBeUndefined();

    const contacts = db.prepare("SELECT company_id FROM contacts WHERE email = 'kalle@kaarle.example'").all() as { company_id: string | null }[];
    expect(contacts.length).toBe(1);
    expect(contacts[0].company_id).toBeNull();
  });

  it('404s deleting the same company again', async () => {
    const res = await adminAgent
      .delete(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(404);
  });

  it('404s updating the deleted company', async () => {
    const res = await adminAgent
      .put(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Gone AB' });
    expect(res.status).toBe(404);
  });
});
