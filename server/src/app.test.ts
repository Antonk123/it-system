import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID, createHash } from 'crypto';

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
 * Login only counts FAILED attempts against its 5 / 15 min per-IP budget; this file
 * performs a handful of logins and stays well under it.
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

describe('GET /api/<unknown> (404 catch-all)', () => {
  it('returns JSON 404 instead of Express\'s built-in HTML 404 page', async () => {
    const res = await request(app).get('/api/finns-inte');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toBeTruthy();
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

    // Replay protection: reusing the OLD refresh token is rejected once the
    // 10 s grace window for racing tabs has passed (the old row is kept,
    // revoked, so reuse can be detected). Age the rotation to leave the window.
    db.prepare("UPDATE refresh_tokens SET last_used_at = ? WHERE revoked = 1 AND replaced_by IS NOT NULL")
      .run(new Date(Date.now() - 60_000).toISOString());
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', oldRefreshCookie);
    expect(replay.status).toBe(401);

    // Reuse of a rotated token revokes the whole family: the freshly rotated
    // token (held by the thief or the victim — we cannot tell) is dead too.
    const refresh2 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', newRefreshCookie);
    expect(refresh2.status).toBe(401);
  });

  it('a freshly rotated token keeps working when the old one is not replayed', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refreshToken='))!;
    const refresh1 = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refresh1.status).toBe(200);
    const next = (refresh1.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refreshToken='))!;
    const refresh2 = await request(app).post('/api/auth/refresh').set('Cookie', next);
    expect(refresh2.status).toBe(200);
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

describe('CSRF exemption for API-key requests (Bearer itk_live_…)', () => {
  // API keys authenticate cryptographically via the Authorization header, not a
  // session cookie, so CSRF is irrelevant for them. Without the exemption EVERY
  // write with an API key failed on EBADCSRFTOKEN → the `write` scope was dead.
  const RAW_WRITE_KEY = 'itk_live_wkeyAAAA0123456789abcdef01234567';
  const RAW_READ_KEY = 'itk_live_rkeyBBBB0123456789abcdef01234567';

  beforeAll(() => {
    const mkKey = (raw: string, permissions: string[]) => {
      const prefix = raw.substring('itk_live_'.length, 'itk_live_'.length + 8);
      const hash = createHash('sha256').update(raw).digest('hex');
      db.prepare(
        `INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), `key-${prefix}`, prefix, hash, adminId, JSON.stringify(permissions), null);
    };
    mkKey(RAW_WRITE_KEY, ['read', 'write']);
    mkKey(RAW_READ_KEY, ['read']);
  });

  it('lets a WRITE-scoped API key POST without any CSRF token (201) — CSRF is bypassed, write allowed', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${RAW_WRITE_KEY}`)
      // create kräver description ELLER customFields (tickets.ts:722).
      .send({ title: 'Created via API key', description: 'via api key', priority: 'low' });

    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.title).toBe('Created via API key');
  });

  it('blocks a READ-only API key write on SCOPE, not CSRF (403, scope message)', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${RAW_READ_KEY}`)
      .send({ title: 'should be blocked by scope', status: 'open', priority: 'low' });

    expect(res.status).toBe(403);
    // The rejection must be the scope guard, NOT the CSRF double-submit check.
    expect(res.body.code).not.toBe('EBADCSRFTOKEN');
    expect(res.body.error).toMatch(/skrivrättigheter/i);
  });

  it('still allows a READ-only API key to GET (200)', async () => {
    const res = await request(app)
      .get('/api/tickets?limit=1')
      .set('Authorization', `Bearer ${RAW_READ_KEY}`);
    expect(res.status).toBe(200);
  });

  it('does NOT exempt a non-itk_live_ Bearer token (JWT) — CSRF still required (403)', async () => {
    // CSRF runs before auth, so a non-API-key Bearer token (e.g. a JWT) must still
    // hit the double-submit check. Proves the exemption is specific to itk_live_
    // and didn't accidentally disable CSRF for all Bearer requests. No login needed
    // (CSRF rejects before the token is ever validated) — keeps under the login cap.
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.not-an-api-key.sig')
      .send({ title: 'jwt without csrf', status: 'open', priority: 'low' });

    expect(res.status).toBe(403);
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


describe('Retired SLA and billing endpoints', () => {
  it.each(['/api/sla', '/api/billing/invoices', '/api/billing/rates/example'])('does not expose %s', async (path) => {
      const response = await request(app).get(path);
      expect(response.status).toBe(404);
    });
});


describe('Retired time tracking preserves stored history', () => {
  it('rejects former endpoints without changing historical time entries', async () => {
    const ticketId = randomUUID();
    const entryId = randomUUID();
    db.prepare('INSERT INTO tickets (id, title, description) VALUES (?, ?, ?)')
      .run(ticketId, 'Historical work', 'Keep the existing record');
    db.prepare('INSERT INTO time_entries (id, ticket_id, user_id, duration_minutes, note) VALUES (?, ?, ?, ?, ?)')
      .run(entryId, ticketId, adminId, 45, 'Historical work note');
    const before = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId);
    const rawKey = 'itk_live_retiredtime0123456789abcdef';
    db.prepare(`INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), 'Retired endpoint test', 'retiredt', createHash('sha256').update(rawKey).digest('hex'),
        adminId, JSON.stringify(['read', 'write', 'admin']));
    for (const response of [
      await request(app).get(`/api/time-entries/${ticketId}`).set('Authorization', `Bearer ${rawKey}`),
      await request(app).post(`/api/time-entries/${ticketId}`).set('Authorization', `Bearer ${rawKey}`).send({ duration_minutes: 10 }),
      await request(app).put(`/api/time-entries/${ticketId}/${entryId}`).set('Authorization', `Bearer ${rawKey}`).send({ duration_minutes: 10 }),
      await request(app).delete(`/api/time-entries/${ticketId}/${entryId}`).set('Authorization', `Bearer ${rawKey}`),
      await request(app).get('/api/reports/time-summary').set('Authorization', `Bearer ${rawKey}`),
    ]) {
      expect(response.status).toBe(404);
    }
    expect(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS count FROM time_entries WHERE ticket_id = ?').get(ticketId))
      .toEqual({ count: 1 });
  });
});


describe('Retired recurring tickets preserve stored history', () => {
  it('rejects old endpoints and leaves templates, generated tickets and history intact', async () => {
    const templateId = randomUUID();
    const ticketId = randomUUID();
    const historyId = randomUUID();
    db.prepare(`INSERT INTO recurring_templates (id, name, title, interval_type, next_run)
      VALUES (?, ?, ?, 'daily', ?)`)
      .run(templateId, 'Historical schedule', 'Scheduled work', '2026-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO tickets (id, title, description) VALUES (?, ?, ?)')
      .run(ticketId, 'Previously generated ticket', 'Keep this ticket');
    db.prepare('INSERT INTO recurring_ticket_history (id, template_id, ticket_id) VALUES (?, ?, ?)')
      .run(historyId, templateId, ticketId);
    const readHistory = () => ({
      template: db.prepare('SELECT * FROM recurring_templates WHERE id = ?').get(templateId),
      ticket: db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId),
      history: db.prepare('SELECT * FROM recurring_ticket_history WHERE id = ?').get(historyId),
    });
    const before = readHistory();
    const rawKey = 'itk_live_retiredrecurring0123456789abcdef';
    db.prepare(`INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), 'Retired recurring test', 'retiredr', createHash('sha256').update(rawKey).digest('hex'),
        adminId, JSON.stringify(['read', 'write', 'admin']));
    for (const response of [
      await request(app).get('/api/recurring').set('Authorization', `Bearer ${rawKey}`),
      await request(app).post('/api/recurring').set('Authorization', `Bearer ${rawKey}`)
        .send({ name: 'Removed', title: 'Removed', interval_type: 'daily' }),
      await request(app).put(`/api/recurring/${templateId}`).set('Authorization', `Bearer ${rawKey}`).send({ name: 'Changed' }),
      await request(app).delete(`/api/recurring/${templateId}`).set('Authorization', `Bearer ${rawKey}`),
      await request(app).patch(`/api/recurring/${templateId}/toggle`).set('Authorization', `Bearer ${rawKey}`),
    ]) {
      expect(response.status).toBe(404);
    }
    expect(readHistory()).toEqual(before);
  });
});

describe('Request id', () => {
  it('echoes a well-formed X-Request-ID', async () => {
    const res = await request(app).get('/api/health').set('X-Request-ID', 'abc-123_DEF');
    expect(res.headers['x-request-id']).toBe('abc-123_DEF');
  });

  it('replaces a malformed or oversized X-Request-ID with a generated UUID', async () => {
    for (const bad of ['has space', 'semi;colon', 'x'.repeat(65)]) {
      const res = await request(app).get('/api/health').set('X-Request-ID', bad);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});

describe('Bodyless requests', () => {
  it('a POST without any body reaches the route as an empty object (400 from validation, not 500)', async () => {
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/csrf-token')).body.csrfToken as string;
    const res = await agent.post('/api/auth/reset-password').set('x-csrf-token', csrf);
    expect(res.status).toBe(400);
  });
});

describe('Global error handler', () => {
  const KEY = 'itk_live_errhAAAA0123456789abcdef01234567';

  beforeAll(() => {
    const prefix = KEY.substring('itk_live_'.length, 'itk_live_'.length + 8);
    db.prepare(
      `INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), 'err-key', prefix, createHash('sha256').update(KEY).digest('hex'), adminId, JSON.stringify(['read', 'write']));
  });

  // Skrivbegränsarens nyckeluppslag är första db-anropet för en API-nyckel-request,
  // så ett kastat fel där når den globala felhanteraren via vanlig middleware-väg.
  it('5xx: generic message plus the request id the user can quote (and it matches the header)', async () => {
    const spy = vi.spyOn(db, 'prepare').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const res = await request(app)
      .post('/api/tickets')
      .set('X-Request-ID', 'quote-me-1')
      .set('Authorization', `Bearer ${KEY}`)
      .send({ title: 'x', description: 'y' });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', requestId: 'quote-me-1' });
    expect(res.headers['x-request-id']).toBe('quote-me-1');
  });

  it('logs requestId, method, path and stack on 5xx', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi.spyOn(db, 'prepare').mockImplementationOnce(() => {
      throw new Error('boom-log');
    });
    await request(app)
      .post('/api/tickets')
      .set('X-Request-ID', 'log-me-1')
      .set('Authorization', `Bearer ${KEY}`)
      .send({ title: 'x', description: 'y' });
    spy.mockRestore();
    const entries = logSpy.mock.calls.map((c) => JSON.parse(c[0] as string));
    logSpy.mockRestore();
    const entry = entries.find((e) => e.message === 'Unhandled error' && e.requestId === 'log-me-1');
    expect(entry).toMatchObject({ method: 'POST', path: '/api/tickets', error: 'boom-log' });
    expect(entry.stack).toContain('boom-log');
  });

  it('maps a MulterError that a route forgot to wrap to a JSON client error (413 for size, 400 otherwise)', async () => {
    for (const [code, status] of [['LIMIT_FILE_SIZE', 413], ['LIMIT_UNEXPECTED_FILE', 400]] as const) {
      const spy = vi.spyOn(db, 'prepare').mockImplementationOnce(() => {
        throw Object.assign(new Error(code), { name: 'MulterError', code });
      });
      const res = await request(app)
        .post('/api/tickets')
        .set('Authorization', `Bearer ${KEY}`)
        .send({ title: 'x', description: 'y' });
      spy.mockRestore();
      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
      expect(res.headers['content-type']).toMatch(/json/);
    }
  });
});

describe('Write rate limiter (all mutating /api routes)', () => {
  const mkKey = (raw: string, permissions: string[]) => {
    const prefix = raw.substring('itk_live_'.length, 'itk_live_'.length + 8);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, `wl-${prefix}`, prefix, createHash('sha256').update(raw).digest('hex'), adminId, JSON.stringify(permissions));
  };
  const KEY_A = 'itk_live_wlimAAAA0123456789abcdef01234567';
  const KEY_B = 'itk_live_wlimBBBB0123456789abcdef01234567';

  beforeAll(() => {
    // read-only: skrivningar avvisas med 403 av authenticate, men begränsaren räknar dem först.
    mkKey(KEY_A, ['read']);
    mkKey(KEY_B, ['read']);
  });

  it('allows 300 writes per API key per window regardless of source IP, then 429 — another key is unaffected', async () => {
    // En delad lyssnande server: request(app) skulle annars öppna en ny ephemeral server per anrop
    // (300+ st) och ger "socket hang up" när maskinen är belastad.
    const server = app.listen(0);
    try {
      const api = request(server);
      let lastStatus = 0;
      for (let i = 0; i < 300; i++) {
        const res = await api
          .post('/api/tickets')
          .set('X-Forwarded-For', `203.0.113.${(i % 200) + 1}`)
          .set('Authorization', `Bearer ${KEY_A}`)
          .send({});
        lastStatus = res.status;
        if (res.status === 429) break;
      }
      expect(lastStatus).toBe(403);

      const blocked = await api.post('/api/tickets').set('Authorization', `Bearer ${KEY_A}`).send({});
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();

      const other = await api.post('/api/tickets').set('Authorization', `Bearer ${KEY_B}`).send({});
      expect(other.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it('does not count GET requests and keys JWT sessions by user id (writes still pass after 305 GETs)', async () => {
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.250')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const jwtHeader = `Bearer ${login.body.accessToken}`;
    const server = app.listen(0);
    try {
      const api = request(server);
      for (let i = 0; i < 305; i++) {
        const res = await api.get('/api/health').set('Authorization', jwtHeader);
        if (res.status !== 200) throw new Error(`GET counted at ${i}`);
      }
      const agent = request.agent(server);
      const csrf = (await agent.get('/api/csrf-token').set('Authorization', jwtHeader)).body.csrfToken as string;
      // Vilken route som helst räcker: målet är att begränsaren inte slår till (429) och CSRF/auth passerar.
      const res = await agent.post('/api/tags').set('Authorization', jwtHeader).set('x-csrf-token', csrf)
        .send({ name: 'wl-tag', color: '#112233' });
      expect([401, 403, 429]).not.toContain(res.status);
    } finally {
      server.close();
    }
  });
});
