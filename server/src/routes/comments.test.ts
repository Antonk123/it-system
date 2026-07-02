import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Integration tests for the comments routes (/api/comments). Covers the
 * synchronous contract (auth, validation, is_internal handling), that a
 * PUBLIC comment closes the loop by dispatching a comment.created webhook while
 * an INTERNAL note does not, and the canAccessTicket authorization gate on
 * GET/POST /ticket/:ticketId (unassigned tickets stay open for self-service
 * pickup; assigned tickets require admin/requester/assignee/creator).
 *
 * The webhookDispatcher module is mocked so webhook-dispatch assertions are
 * deterministic (no wall-clock polling for the real HTTP delivery pipeline —
 * see notifyCustomerOfPublicReply's fire-and-forget call in comments.ts).
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-comments.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-comments-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-comments-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

vi.mock('../lib/webhookDispatcher.js', () => ({
  dispatchWebhook: vi.fn(async () => undefined),
}));

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';
import { dispatchWebhook } from '../lib/webhookDispatcher.js';

const dispatchWebhookMock = vi.mocked(dispatchWebhook);

let app: ReturnType<typeof createApp>;
let agent: ReturnType<typeof request.agent>;
let token: string;
let csrf: string;
let ticketId: string;

// ── IDOR fixtures (H1): an assigned ticket + an unrelated non-admin user ──
let assignedTicketId: string;
let assigneeUserId: string;
let strangerAgent: ReturnType<typeof request.agent>;
let strangerToken: string;
let strangerCsrf: string;

beforeAll(async () => {
  initializeDatabase();

  const userId = randomUUID();
  const hash = await bcrypt.hash('Agent-P@ss1234!', 10);
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(userId, 'agent@commentstest.local', hash, 'admin', 'Comments Agent');

  const contactId = randomUUID();
  db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)')
    .run(contactId, 'Kund', 'kund@customer.example');
  ticketId = randomUUID();
  db.prepare(
    `INSERT INTO tickets (id, title, description, status, priority, requester_id)
     VALUES (?, 'Skärmen flimrar', 'Bilden hoppar', 'open', 'medium', ?)`
  ).run(ticketId, contactId);

  // A stranger: authenticated non-admin user unrelated to any ticket below.
  assigneeUserId = randomUUID();
  const assigneeHash = await bcrypt.hash('Assignee-P@ss1234!', 10);
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(assigneeUserId, 'assignee@commentstest.local', assigneeHash, 'user', 'Assignee User');

  const strangerUserId = randomUUID();
  const strangerHash = await bcrypt.hash('Stranger-P@ss1234!', 10);
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(strangerUserId, 'stranger@commentstest.local', strangerHash, 'user', 'Stranger User');

  // Ticket assigned to assigneeUserId — the stranger has no relation to it.
  assignedTicketId = randomUUID();
  db.prepare(
    `INSERT INTO tickets (id, title, description, status, priority, assigned_to)
     VALUES (?, 'Skrivaren krånglar', 'Papper fastnar', 'open', 'low', ?)`
  ).run(assignedTicketId, assigneeUserId);

  app = createApp();
  agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email: 'agent@commentstest.local', password: 'Agent-P@ss1234!' });
  token = login.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  csrf = csrfRes.body.csrfToken as string;

  strangerAgent = request.agent(app);
  const strangerLogin = await strangerAgent
    .post('/api/auth/login')
    .send({ email: 'stranger@commentstest.local', password: 'Stranger-P@ss1234!' });
  strangerToken = strangerLogin.body.accessToken as string;
  const strangerCsrfRes = await strangerAgent
    .get('/api/csrf-token')
    .set('Authorization', `Bearer ${strangerToken}`);
  strangerCsrf = strangerCsrfRes.body.csrfToken as string;
});

afterEach(() => {
  // Clear call history only — restoreAllMocks/resetAllMocks would wipe the
  // vi.mock() factory's implementation too, turning dispatchWebhook into a
  // bare stub (no Promise) and breaking the fire-and-forget .catch() chain in
  // notifyCustomerOfPublicReply.
  dispatchWebhookMock.mockClear();
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('POST /api/comments/ticket/:ticketId', () => {
  it('requires authentication (401 on GET without a token)', async () => {
    const res = await request(app).get(`/api/comments/ticket/${ticketId}`);
    expect(res.status).toBe(401);
  });

  it('rejects empty content (400)', async () => {
    const res = await agent
      .post(`/api/comments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ content: '   ' });
    expect(res.status).toBe(400);
  });

  it('creates a PUBLIC comment and dispatches comment.created', async () => {
    const res = await agent
      .post(`/api/comments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ content: 'Vi har bytt kabeln, testa nu.', isInternal: false });
    expect(res.status).toBe(201);
    expect(res.body.is_internal).toBe(0);

    // notifyCustomerOfPublicReply is fired fire-and-forget from the route (the
    // HTTP response is not blocked on it), so wait on the mock rather than
    // polling wall-clock time for a real webhook delivery.
    await vi.waitFor(() => {
      expect(dispatchWebhookMock).toHaveBeenCalledWith(
        'comment.created',
        expect.objectContaining({ ticket_id: ticketId, is_internal: false }),
      );
    });
  });

  it('creates an INTERNAL note by default and does NOT dispatch comment.created', async () => {
    const res = await agent
      .post(`/api/comments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ content: 'Intern notering: kunden ringde.' });
    expect(res.status).toBe(201);
    expect(res.body.is_internal).toBe(1);

    // notifyCustomerOfPublicReply is only invoked when isInternal is false —
    // that guard is synchronous (`if (!isInternal)`), so there is no race to
    // wait out here: the dispatch simply never happens.
    expect(dispatchWebhookMock).not.toHaveBeenCalled();
  });
});

describe('GET/POST /api/comments/ticket/:ticketId — authorization (canAccessTicket)', () => {
  it('GET returns 403 for an unrelated non-admin user on a ticket assigned to someone else', async () => {
    const res = await strangerAgent
      .get(`/api/comments/ticket/${assignedTicketId}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/behörighet/i);
  });

  it('POST returns 403 for an unrelated non-admin user on a ticket assigned to someone else', async () => {
    const res = await strangerAgent
      .post(`/api/comments/ticket/${assignedTicketId}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .set('x-csrf-token', strangerCsrf)
      .send({ content: 'Jag borde inte kunna skriva detta.' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/behörighet/i);
  });

  it('GET/POST return 200/201 for an unassigned ticket for any authenticated user (self-service pickup preserved)', async () => {
    // `ticketId` (top-level) is unassigned (requester_id only, no assigned_to).
    const getRes = await strangerAgent
      .get(`/api/comments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(getRes.status).toBe(200);

    const postRes = await strangerAgent
      .post(`/api/comments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .set('x-csrf-token', strangerCsrf)
      .send({ content: 'Jag plockar upp det här köärendet.' });
    expect(postRes.status).toBe(201);
  });

  it('GET/POST return 200/201 for an admin regardless of ticket assignment', async () => {
    const getRes = await agent
      .get(`/api/comments/ticket/${assignedTicketId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);

    const postRes = await agent
      .post(`/api/comments/ticket/${assignedTicketId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ content: 'Admin kan alltid kommentera.' });
    expect(postRes.status).toBe(201);
  });

  it('returns 404 for a non-existent ticket on both GET and POST', async () => {
    const nonExistentId = randomUUID();
    const getRes = await agent
      .get(`/api/comments/ticket/${nonExistentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(404);

    const postRes = await agent
      .post(`/api/comments/ticket/${nonExistentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ content: 'Detta ärende finns inte.' });
    expect(postRes.status).toBe(404);
  });
});
