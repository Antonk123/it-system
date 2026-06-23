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

  it('returns 403 for a logged-in stranger (no relationship to the ticket)', async () => {
    const res = await request(app)
      .get(`/api/checklists/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app).get(`/api/checklists/ticket/${ticketId}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/checklists/progress — batch authorization (IDOR)', () => {
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

  it('does NOT leak progress of a ticket the caller cannot access', async () => {
    const res = await stranger.agent.post('/api/checklists/progress')
      .set('Authorization', `Bearer ${stranger.token}`).set('x-csrf-token', stranger.csrf)
      .send({ ticketIds: [ticketId] });
    expect(res.status).toBe(200);
    expect(res.body[ticketId]).toBeUndefined();
  });

  it('filters a mixed batch to only the accessible tickets', async () => {
    const res = await stranger.agent.post('/api/checklists/progress')
      .set('Authorization', `Bearer ${stranger.token}`).set('x-csrf-token', stranger.csrf)
      .send({ ticketIds: [ticketId, strangerTicketId] });
    expect(res.status).toBe(200);
    expect(res.body[ticketId]).toBeUndefined();        // not accessible → omitted
    expect(res.body[strangerTicketId]).toBeDefined();  // own ticket → present
  });
});
