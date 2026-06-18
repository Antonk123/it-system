import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * HTTP integration tests against the real Express app (createApp()).
 *
 * Covers the highest-risk surfaces:
 *  - AUTH: login (success + wrong password), refresh-token rotation + replay protection
 *  - CSRF: a mutating request to a non-exempt route is rejected without a token
 *           (proves createApp() wired CSRF correctly)
 *  - TICKET lifecycle: create → status transitions, persisted across follow-up GETs
 *
 * Bootstrap (critical ordering): the DB is a module-level singleton built from
 * process.env.DB_PATH at import time of db/connection.ts. So env MUST be set via
 * vi.hoisted() BEFORE any import that pulls in connection.ts (createApp →
 * passport → connection). We point DB_PATH at a unique temp file, then call
 * initializeDatabase() (schema + migrations) and seed an admin user directly —
 * the admin seed lives in db/init.ts (a standalone script) and is NOT run by
 * initializeDatabase(), so we must create the user ourselves.
 *
 * Login is rate-limited (5 attempts / 15 min per IP). This file performs exactly
 * 4 logins, staying safely under the cap.
 */

const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'Sup3r-Str0ng-Test-Pw!';

// Set env BEFORE importing anything that imports db/connection.ts.
// vi.hoisted() runs before any import in this file, so it cannot reference
// module-level imports — we use Node's built-in createRequire to pull os/path
// synchronously inside the factory.
const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

// Static imports are hoisted above the vi.hoisted() env-setup by the bundler in
// terms of source order, but vi.hoisted() guarantees its body runs first at
// runtime — so process.env is populated before db/connection.ts is evaluated.
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from './db/connection.js';
import { createApp } from './app.js';

let app: ReturnType<typeof createApp>;
let adminId: string;

beforeAll(async () => {
  initializeDatabase();

  // Seed admin user directly (no auto-seed in initializeDatabase()).
  adminId = randomUUID();
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  ).run(adminId, ADMIN_EMAIL, passwordHash, 'admin', 'Test Admin');

  app = createApp();
});

afterAll(() => {
  try {
    closeDatabase();
  } catch {
    /* ignore */
  }
  // Remove temp DB + WAL/SHM sidecars.
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) {
      try {
        rmSync(f);
      } catch {
        /* ignore */
      }
    }
  }
});

describe('GET /api/health', () => {
  it('returns 200 { status: "ok" }', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Auth — login', () => {
  it('logs in with correct admin credentials and returns an access token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(0);
    // Documented shape: { user, token, accessToken }; token mirrors accessToken.
    expect(res.body.token).toBe(res.body.accessToken);
    expect(res.body.user).toMatchObject({ email: ADMIN_EMAIL, role: 'admin' });

    // Refresh token is delivered as an HttpOnly cookie, not in the body.
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie?.some((c) => c.startsWith('refreshToken='))).toBe(true);
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('rejects login with the wrong password (401)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });
});

describe('Auth — refresh-token rotation', () => {
  it('issues a new access token and rotates the refresh token (old one is rejected on replay)', async () => {
    // Login to obtain a refresh cookie.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);

    const loginCookies = login.headers['set-cookie'] as unknown as string[];
    const oldRefreshCookie = loginCookies.find((c) => c.startsWith('refreshToken='))!;
    expect(oldRefreshCookie).toBeTruthy();

    // First refresh: succeeds, returns a new access token, and rotates the cookie.
    const refresh1 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', oldRefreshCookie);

    expect(refresh1.status).toBe(200);
    expect(typeof refresh1.body.accessToken).toBe('string');
    expect(refresh1.body.accessToken.length).toBeGreaterThan(0);

    const rotatedCookies = refresh1.headers['set-cookie'] as unknown as string[];
    const newRefreshCookie = rotatedCookies.find((c) => c.startsWith('refreshToken='))!;
    expect(newRefreshCookie).toBeTruthy();
    // The rotated cookie value differs from the original (token was replaced).
    expect(newRefreshCookie).not.toBe(oldRefreshCookie);

    // Replay protection: reusing the OLD refresh token is rejected (rotation
    // deleted it from the DB).
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', oldRefreshCookie);
    expect(replay.status).toBe(401);

    // The freshly rotated token still works.
    const refresh2 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', newRefreshCookie);
    expect(refresh2.status).toBe(200);
    expect(typeof refresh2.body.accessToken).toBe('string');
  });
});

describe('CSRF enforcement', () => {
  it('rejects a mutating request to a non-exempt route without a CSRF token (403)', async () => {
    // POST /api/tickets is NOT in the CSRF-exempt list. Without a CSRF token the
    // double-submit check must fire before auth/body validation. This proves
    // createApp() mounted conditionalCsrf correctly.
    const res = await request(app)
      .post('/api/tickets')
      .send({ title: 'should be blocked', description: 'no csrf token' });

    expect(res.status).toBe(403);
    // csrf-csrf surfaces EBADCSRFTOKEN via the error handler's `code` field.
    expect(res.body.code === 'EBADCSRFTOKEN' || /csrf/i.test(res.body.error ?? '')).toBe(true);
  });
});

describe('Ticket lifecycle (create → status transitions)', () => {
  // A single agent keeps cookies (the CSRF cookie) across requests. We fetch a
  // CSRF token (sets the csrf-token cookie + returns the matching token value),
  // then send it via the x-csrf-token header on every mutating request along
  // with Authorization: Bearer <accessToken>.
  // The agent is created inside beforeAll because `app` is only assigned in the
  // top-level beforeAll (it is undefined at suite-evaluation time).
  let agent: ReturnType<typeof request.agent>;
  let accessToken: string;
  let csrfToken: string;
  let ticketId: string;

  beforeAll(async () => {
    agent = request.agent(app);
    const login = await agent
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    accessToken = login.body.accessToken;

    const csrf = await agent
      .get('/api/csrf-token')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(csrf.status).toBe(200);
    csrfToken = csrf.body.csrfToken;
    expect(typeof csrfToken).toBe('string');
  });

  it('creates a ticket (201) with the documented fields', async () => {
    const res = await agent
      .post('/api/tickets')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-csrf-token', csrfToken)
      .send({
        title: 'Integration test ticket',
        description: 'Created by app.test.ts',
        priority: 'high',
      });

    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.title).toBe('Integration test ticket');
    expect(res.body.status).toBe('open'); // default status
    expect(res.body.priority).toBe('high');
    ticketId = res.body.id;
  });

  it('fetches the created ticket back (GET /api/tickets/:id)', async () => {
    const res = await agent
      .get(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ticketId);
    expect(res.body.status).toBe('open');
  });

  it('transitions open → in-progress and persists it', async () => {
    const put = await agent
      .put(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'in-progress' });

    expect(put.status).toBe(200);
    expect(put.body.status).toBe('in-progress');

    const get = await agent
      .get(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(get.status).toBe(200);
    expect(get.body.status).toBe('in-progress');
  });

  it('transitions in-progress → resolved, sets resolved_at, and persists it', async () => {
    const put = await agent
      .put(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'resolved' });

    expect(put.status).toBe(200);
    expect(put.body.status).toBe('resolved');
    expect(put.body.resolved_at).toBeTruthy();

    const get = await agent
      .get(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(get.status).toBe(200);
    expect(get.body.status).toBe('resolved');
    expect(get.body.resolved_at).toBeTruthy();
  });

  it('rejects an invalid status value (400)', async () => {
    const res = await agent
      .put(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'not-a-real-status' });

    expect(res.status).toBe(400);
  });
});
