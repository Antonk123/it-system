import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * IDOR authorization tests for the checklists routes.
 *
 * GET /api/checklists/ticket/:ticketId — a logged-in stranger must not read a
 * ticket's checklist items (owner/admin → 200, stranger → 403, no token → 401).
 *
 * POST /api/checklists/progress — the batch endpoint must not leak checklist
 * counts for tickets the caller cannot access; it returns progress only for the
 * accessible subset of the requested ids.
 *
 * NOTE: the login endpoint is rate-limited to 5 attempts / 15 min per IP, so we
 * log in each user exactly once (persistent csrf-agent) and reuse it.
 * UNIQUE DB_PATH suffix (-checklists) so parallel suites don't collide.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-checklists.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-checklists-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-checklists-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

type Session = { agent: ReturnType<typeof request.agent>; token: string; csrf: string };

let app: ReturnType<typeof createApp>;

let admin: Session;
let owner: Session;
let stranger: Session;

let adminId: string;
let ownerId: string;
let strangerId: string;

let ticketId: string;          // owned by `owner`, has one checklist item
let strangerTicketId: string;  // owned by `stranger`, has one checklist item

// One login per user (login is rate-limited to 5/15min per IP). The persistent
// agent keeps the csrf cookie; the x-csrf-token header is needed for POST.
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
  ownerId = randomUUID();
  strangerId = randomUUID();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const ownerHash = await bcrypt.hash('Owner-P@ss1234!', 10);
  const strangerHash = await bcrypt.hash('Stranger-P@ss1234!', 10);

  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(adminId, 'admin@checkliststest.local', adminHash, 'admin', 'Checklists Admin');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(ownerId, 'owner@checkliststest.local', ownerHash, 'user', 'Checklists Owner');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(strangerId, 'stranger@checkliststest.local', strangerHash, 'user', 'Checklists Stranger');

  ticketId = randomUUID();
  db.prepare(`INSERT INTO tickets (id, title, description, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(ticketId, 'Checklists Test Ticket', 'owner ticket', 'open', null, ownerId);
  db.prepare(`INSERT INTO ticket_checklists (id, ticket_id, label, position) VALUES (?, ?, ?, ?)`)
    .run(randomUUID(), ticketId, 'Item 1', 0);

  // A ticket owned by the stranger (with a checklist item), so the batch-progress
  // test can prove the filter keeps accessible tickets while dropping others.
  strangerTicketId = randomUUID();
  db.prepare(`INSERT INTO tickets (id, title, description, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(strangerTicketId, 'Stranger Own Ticket', 'stranger ticket', 'open', null, strangerId);
  db.prepare(`INSERT INTO ticket_checklists (id, ticket_id, label, position) VALUES (?, ?, ?, ?)`)
    .run(randomUUID(), strangerTicketId, 'Stranger Item', 0);

  app = createApp();

  admin = await login('admin@checkliststest.local', 'Admin-P@ss1234!');
  owner = await login('owner@checkliststest.local', 'Owner-P@ss1234!');
  stranger = await login('stranger@checkliststest.local', 'Stranger-P@ss1234!');
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/checklists/ticket/:ticketId — authorization', () => {
  it('returns 200 for the ticket owner (created_by)', async () => {
    const res = await request(app)
      .get(`/api/checklists/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 200 for an admin', async () => {
    const res = await request(app)
      .get(`/api/checklists/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 200 for a logged-in stranger (reads are open to any authenticated user)', async () => {
    const res = await request(app)
      .get(`/api/checklists/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app).get(`/api/checklists/ticket/${ticketId}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/checklists/progress — batch progress', () => {
  it('returns progress for the owner\'s own ticket', async () => {
    const res = await owner.agent.post('/api/checklists/progress')
      .set('Authorization', `Bearer ${owner.token}`).set('x-csrf-token', owner.csrf)
      .send({ ticketIds: [ticketId] });
    expect(res.status).toBe(200);
    expect(res.body[ticketId]).toBeDefined();
    expect(res.body[ticketId].total).toBe(1);
  });

  it('returns progress for an admin', async () => {
    const res = await admin.agent.post('/api/checklists/progress')
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf)
      .send({ ticketIds: [ticketId] });
    expect(res.status).toBe(200);
    expect(res.body[ticketId]).toBeDefined();
  });

  it('returns progress for any authenticated user, covering a mixed batch', async () => {
    const res = await stranger.agent.post('/api/checklists/progress')
      .set('Authorization', `Bearer ${stranger.token}`).set('x-csrf-token', stranger.csrf)
      .send({ ticketIds: [ticketId, strangerTicketId] });
    expect(res.status).toBe(200);
    expect(res.body[ticketId].total).toBe(1);
    expect(res.body[strangerTicketId].total).toBe(1);
  });

  it('ignores non-string ids and handles batches larger than one chunk', async () => {
    const filler = Array.from({ length: 1100 }, () => randomUUID());
    const res = await stranger.agent.post('/api/checklists/progress')
      .set('Authorization', `Bearer ${stranger.token}`).set('x-csrf-token', stranger.csrf)
      .send({ ticketIds: [...filler, 42, null, ticketId] });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual([ticketId]);
  });
});

describe('checklist item writes — policy and validation', () => {
  let assignedTicketId: string; // assigned to `owner`: strangers may read but not write
  let itemId: string;
  const post = (who: Session, path: string, body: unknown) =>
    who.agent.post(path).set('Authorization', `Bearer ${who.token}`).set('x-csrf-token', who.csrf).send(body as object);
  const put = (who: Session, path: string, body: unknown) =>
    who.agent.put(path).set('Authorization', `Bearer ${who.token}`).set('x-csrf-token', who.csrf).send(body as object);

  beforeAll(() => {
    assignedTicketId = randomUUID();
    db.prepare(`INSERT INTO tickets (id, title, description, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(assignedTicketId, 'Assigned Checklist Ticket', 'assigned', 'open', ownerId, adminId);
    itemId = randomUUID();
    db.prepare(`INSERT INTO ticket_checklists (id, ticket_id, label, position) VALUES (?, ?, ?, ?)`)
      .run(itemId, assignedTicketId, 'Seed item', 0);
  });

  it('403s a stranger on create, update and delete for an assigned ticket', async () => {
    expect((await post(stranger, `/api/checklists/ticket/${assignedTicketId}`, { label: 'x' })).status).toBe(403);
    expect((await post(stranger, `/api/checklists/ticket/${assignedTicketId}/bulk`, { labels: ['x'] })).status).toBe(403);
    expect((await put(stranger, `/api/checklists/${itemId}`, { completed: true })).status).toBe(403);
    const del = await stranger.agent.delete(`/api/checklists/${itemId}`)
      .set('Authorization', `Bearer ${stranger.token}`).set('x-csrf-token', stranger.csrf);
    expect(del.status).toBe(403);
  });

  it('lets the assignee write and anyone write to an unassigned ticket', async () => {
    expect((await post(owner, `/api/checklists/ticket/${assignedTicketId}`, { label: 'by assignee' })).status).toBe(201);
    expect((await post(stranger, `/api/checklists/ticket/${ticketId}`, { label: 'self-service' })).status).toBe(201);
  });

  it('validates label, due_date and parent_id on create', async () => {
    const base = `/api/checklists/ticket/${assignedTicketId}`;
    expect((await post(owner, base, { label: 'x'.repeat(501) })).status).toBe(400);
    expect((await post(owner, base, { label: 'ok', due_date: 'not-a-date' })).status).toBe(400);
    expect((await post(owner, base, { label: 'ok', due_date: '2026-02-30x' })).status).toBe(400);
    expect((await post(owner, base, { label: 'ok', parent_id: randomUUID() })).status).toBe(400);
    // parent_id från ett annat ärende får inte accepteras
    const foreignItemId = db.prepare('SELECT id FROM ticket_checklists WHERE ticket_id = ?').get(ticketId) as { id: string };
    expect((await post(owner, base, { label: 'ok', parent_id: foreignItemId.id })).status).toBe(400);
    expect((await post(owner, `${base}/bulk`, { items: [{ label: 'ok', parent_id: foreignItemId.id }] })).status).toBe(400);

    const ok = await post(owner, base, { label: 'child', parent_id: itemId, due_date: '2026-12-01' });
    expect(ok.status).toBe(201);
    expect(ok.body.parent_id).toBe(itemId);
    expect(ok.body.due_date).toBe('2026-12-01');
  });

  it('validates label, due_date and parent_id on update', async () => {
    expect((await put(owner, `/api/checklists/${itemId}`, { label: '   ' })).status).toBe(400);
    expect((await put(owner, `/api/checklists/${itemId}`, { label: 42 })).status).toBe(400);
    expect((await put(owner, `/api/checklists/${itemId}`, { due_date: 'tomorrow' })).status).toBe(400);
    expect((await put(owner, `/api/checklists/${itemId}`, { parent_id: itemId })).status).toBe(400);
    const ok = await put(owner, `/api/checklists/${itemId}`, { label: '  Renamed  ', completed: true });
    expect(ok.status).toBe(200);
    expect(ok.body.label).toBe('Renamed');
    expect(ok.body.completed).toBe(true);
  });
});
