import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Regression test for the "~30s save" bug.
 *
 * The create handler used to `await sendTicketCreatedEmail(...)` INLINE, so the
 * HTTP response was blocked on the SMTP send. When the relay (office365) was
 * slow/throttling, the user's save stalled up to nodemailer's timeouts (~30s).
 * A notification email must never block a user action — the webhook dispatch
 * right beside it was already fire-and-forget; the email now is too.
 *
 * Strategy: mock the email module so sendTicketCreatedEmail HANGS (never
 * resolves). If the handler awaited it, POST /api/tickets would hang until the
 * vitest timeout. A fast 201 proves the send is backgrounded.
 *
 * Harness mirrors tickets.test.ts (unique DB_PATH set in vi.hoisted before any
 * import that pulls in db/connection.ts).
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-email-async.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-emailasync-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-emailasync-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

// A gate the mocked sendTicketCreatedEmail hangs on, so the email "never
// finishes" during the request. Released in afterAll so no promise dangles.
const { emailGate, releaseEmail } = vi.hoisted(() => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  return { emailGate: gate, releaseEmail: () => release() };
});

vi.mock('../lib/email.js', () => ({
  sendTicketCreatedEmail: vi.fn(() => emailGate), // hangs until released
  sendTicketClosedEmail: vi.fn(async () => {}),
  sendTicketAssignedEmail: vi.fn(async () => {}),
  sendTicketReceivedConfirmation: vi.fn(async () => {}),
  sendTicketReplyEmail: vi.fn(async () => {}),
  sendAgentReplyNotificationEmail: vi.fn(async () => {}),
  sendSlaBreachEmail: vi.fn(async () => {}),
  sendTicketReminderEmail: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
}));

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;
let agent: ReturnType<typeof request.agent>;
let token: string;
let csrf: string;

beforeAll(async () => {
  initializeDatabase();

  const adminId = randomUUID();
  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  ).run(adminId, 'admin@emailasync.local', adminHash, 'admin', 'Async Admin');

  app = createApp();
  agent = request.agent(app);

  const res = await agent.post('/api/auth/login').send({
    email: 'admin@emailasync.local',
    password: 'Admin-P@ss1234!',
  });
  expect(res.status).toBe(200);
  token = res.body.accessToken as string;

  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  csrf = csrfRes.body.csrfToken as string;
});

afterAll(() => {
  releaseEmail(); // settle the dangling background email promise
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('POST /api/tickets — save latency is decoupled from email latency', () => {
  it('responds 201 without awaiting the (hanging) notification email', async () => {
    const t0 = Date.now();
    const res = await agent
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ title: 'async-email save', description: 'must not block on SMTP' });
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(201);
    // sendTicketCreatedEmail is still pending. If the handler awaited it, this
    // request would hang to the vitest timeout. A fast 201 = fire-and-forget.
    expect(elapsed).toBeLessThan(2000);
  });
});
