import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * IDOR authorization tests for ticket-link routes.
 *
 * Verifies that GET/POST /api/links/ticket/:ticketId require the caller to
 * have access to the ticket (admin, requester, assignee, or creator) — a
 * logged-in stranger must be rejected with 403, no token with 401.
 *
 * Harness mirrors attachments.test.ts / app.test.ts: vi.hoisted() sets env vars
 * before any import that pulls in db/connection.ts. UNIQUE DB_PATH suffix
 * (-links) so parallel suites don't collide.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-links.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-links-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-links-0123456789abcdef0123456789abcdef';
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

let ownerAgent: ReturnType<typeof request.agent>;
let ownerToken: string;
let ownerCsrf: string;

let strangerAgent: ReturnType<typeof request.agent>;
let strangerToken: string;
let strangerCsrf: string;

let adminId: string;
let ownerId: string;
let strangerId: string;

// Two tickets owned by `owner` (via created_by) — used as link source + target.
let ticketA: string;
let ticketB: string;
// A ticket owned by `stranger` — used to prove the target-side authz check.
let strangerTicket: string;

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  const token = login.body.accessToken as string;
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
    .run(adminId, 'admin@linkstest.local', adminHash, 'admin', 'Links Admin');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(ownerId, 'owner@linkstest.local', ownerHash, 'user', 'Links Owner');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(strangerId, 'stranger@linkstest.local', strangerHash, 'user', 'Links Stranger');

  ticketA = randomUUID();
  ticketB = randomUUID();
  strangerTicket = randomUUID();
  db.prepare(`INSERT INTO tickets (id, title, description, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(ticketA, 'Ticket A', 'owner ticket A', 'open', null, ownerId);
  db.prepare(`INSERT INTO tickets (id, title, description, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(ticketB, 'Ticket B', 'owner ticket B', 'open', null, ownerId);
  db.prepare(`INSERT INTO tickets (id, title, description, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(strangerTicket, 'Stranger Ticket', 'stranger ticket', 'open', null, strangerId);

  app = createApp();

  ({ agent: adminAgent, token: adminToken, csrf: adminCsrf } = await loginAgent('admin@linkstest.local', 'Admin-P@ss1234!'));
  ({ agent: ownerAgent, token: ownerToken, csrf: ownerCsrf } = await loginAgent('owner@linkstest.local', 'Owner-P@ss1234!'));
  ({ agent: strangerAgent, token: strangerToken, csrf: strangerCsrf } = await loginAgent('stranger@linkstest.local', 'Stranger-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/links/ticket/:ticketId — authorization', () => {
  it('returns 200 for the ticket owner (created_by)', async () => {
    const res = await ownerAgent
      .get(`/api/links/ticket/${ticketA}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 200 for an admin', async () => {
    const res = await adminAgent
      .get(`/api/links/ticket/${ticketA}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 403 for a logged-in stranger (no relationship to the ticket)', async () => {
    const res = await strangerAgent
      .get(`/api/links/ticket/${ticketA}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app).get(`/api/links/ticket/${ticketA}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/links/ticket/:ticketId — authorization', () => {
  it('returns 201 when the owner links two owner-owned tickets', async () => {
    const res = await ownerAgent
      .post(`/api/links/ticket/${ticketA}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({ targetTicketId: ticketB, linkType: 'related' });
    expect(res.status).toBe(201);
    expect(res.body.sourceTicketId).toBe(ticketA);
    expect(res.body.targetTicketId).toBe(ticketB);
  });

  it('returns 403 for a stranger with no access to the source ticket', async () => {
    const res = await strangerAgent
      .post(`/api/links/ticket/${ticketA}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .set('x-csrf-token', strangerCsrf)
      .send({ targetTicketId: ticketB, linkType: 'related' });
    expect(res.status).toBe(403);
  });

  it('returns 403 for a user who owns the SOURCE but not the TARGET ticket', async () => {
    // Stranger owns strangerTicket (source) but NOT ticketA (target) → target check must fire.
    const res = await strangerAgent
      .post(`/api/links/ticket/${strangerTicket}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .set('x-csrf-token', strangerCsrf)
      .send({ targetTicketId: ticketA, linkType: 'related' });
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request (no CSRF + no token → 403 from CSRF-before-auth)', async () => {
    // CSRF middleware runs before `authenticate` (see app.ts), so a mutating
    // request with neither a CSRF token nor a Bearer token is rejected at the
    // CSRF layer (403 EBADCSRFTOKEN) before reaching the auth check. This
    // mirrors app.test.ts's canonical "mutating request without CSRF → 403".
    const res = await request(app)
      .post(`/api/links/ticket/${ticketA}`)
      .send({ targetTicketId: ticketB, linkType: 'related' });
    expect(res.status).toBe(403);
  });
});
