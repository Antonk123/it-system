import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Integration tests for the comments routes (/api/comments). Covers the
 * synchronous contract (auth, validation, is_internal handling) and that a
 * PUBLIC comment closes the loop by dispatching a comment.created webhook, while
 * an INTERNAL note does not. Harness mirrors webhooks.test.ts.
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

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;
let agent: ReturnType<typeof request.agent>;
let token: string;
let csrf: string;
let ticketId: string;

const HOOK_URL = 'https://93.184.216.34/hook';
let captured: { event: string | undefined; body: string }[] = [];

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      captured.push({ event: headers['X-Webhook-Event'], body: String(init.body) });
      return new Response(null, { status: 200 });
    }),
  );
}

async function waitForDelivery(timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (captured.length === 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

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

  db.prepare('INSERT INTO webhooks (id, url, events, secret, active) VALUES (?, ?, ?, ?, 1)')
    .run(randomUUID(), HOOK_URL, JSON.stringify(['comment.created']), 'comments-secret-key');

  app = createApp();
  agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email: 'agent@commentstest.local', password: 'Agent-P@ss1234!' });
  token = login.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  csrf = csrfRes.body.csrfToken as string;
});

afterEach(() => {
  vi.restoreAllMocks();
  captured = [];
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
    stubFetch();
    const res = await agent
      .post(`/api/comments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ content: 'Vi har bytt kabeln, testa nu.', isInternal: false });
    expect(res.status).toBe(201);
    expect(res.body.is_internal).toBe(0);

    await waitForDelivery();
    expect(captured.some((c) => c.event === 'comment.created')).toBe(true);
    const delivered = captured.find((c) => c.event === 'comment.created')!;
    expect(JSON.parse(delivered.body).payload.ticket_id).toBe(ticketId);
  });

  it('creates an INTERNAL note by default and does NOT dispatch comment.created', async () => {
    stubFetch();
    const res = await agent
      .post(`/api/comments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ content: 'Intern notering: kunden ringde.' });
    expect(res.status).toBe(201);
    expect(res.body.is_internal).toBe(1);

    // Give any (incorrect) async dispatch a chance to fire, then assert none did.
    await new Promise((r) => setTimeout(r, 300));
    expect(captured).toHaveLength(0);
  });
});
