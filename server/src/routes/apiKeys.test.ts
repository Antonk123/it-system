import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID, randomBytes, createHash } from 'crypto';

/**
 * Integration tests for the API-keys routes (/api/api-keys) and the API-key
 * authentication middleware (server/src/middleware/auth.ts).
 *
 * Coverage:
 *  1. Scope enforcement (audit-v3 MEDIUM): a read-scope key may GET (200) but
 *     POST/PUT/DELETE via the key → 403 forbidden_scope. A write-scope key may
 *     perform a mutating request.
 *  2. Ownership authz: a user lists/deletes only their OWN keys; admin has NO
 *     cross-user access in the current implementation (see REPORT note below).
 *  3. Default TTL (audit-v3 LOW fix): creating a key without expires_at defaults
 *     to ~1 year out; an explicit expires_at is respected; a past/garbage
 *     expires_at is rejected (400).
 *
 * The raw key value is only returned once (at creation); we capture and reuse it
 * the way the middleware expects it: `Authorization: Bearer itk_live_…`.
 *
 * Harness mirrors checklists.test.ts / app.test.ts:
 *  - vi.hoisted() sets a UNIQUE DB_PATH (suffix -apikeys), NODE_ENV=test, and
 *    CSRF_SECRET/JWT_SECRET (>=32 chars; short exits unless ALLOW_WEAK_SECRETS=1) BEFORE any import
 *    that pulls in db/connection.ts.
 *  - Login is rate-limited (5/15min per IP): each user logs in exactly once via a
 *    persistent csrf-agent, and the session is reused.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-apikeys.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-apikeys-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-apikeys-0123456789abcdef0123456789abcdef';
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
let other: Session;

let adminId: string;
let ownerId: string;
let otherId: string;

// One login per user (login is rate-limited to 5/15min per IP). The persistent
// agent keeps the csrf cookie; the x-csrf-token header is needed for mutations.
async function login(email: string, password: string): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const token = res.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  return { agent, token, csrf: csrfRes.body.csrfToken as string };
}

// Create an API key for `session` with the given permissions; return the raw key
// (itk_live_…) so it can be sent as a Bearer credential.
async function createKey(
  session: Session,
  name: string,
  permissions: string[],
  expires_at?: string,
): Promise<{ id: string; key: string; expires_at: string | null }> {
  const body: Record<string, unknown> = { name, permissions };
  if (expires_at !== undefined) body.expires_at = expires_at;
  const res = await session.agent
    .post('/api/api-keys')
    .set('Authorization', `Bearer ${session.token}`)
    .set('x-csrf-token', session.csrf)
    .send(body);
  expect(res.status).toBe(201);
  expect(typeof res.body.key).toBe('string');
  expect(res.body.key.startsWith('itk_live_')).toBe(true);
  return { id: res.body.id, key: res.body.key, expires_at: res.body.expires_at };
}

// Insert an api_keys row directly, bypassing the POST /api/api-keys route
// (and its create-time permission validation). Used to simulate a
// legacy/tampered row that carries an 'admin' scope on a non-admin user's
// key — the exact shape the old vulnerability (role alone gating
// requireAdmin) allowed, and which requireAdmin must still reject purely on
// user.role even though the row itself claims 'admin'.
function insertKeyDirectly(userId: string, name: string, permissions: string[]): string {
  const id = randomUUID();
  const rawKey = `itk_live_${randomBytes(16).toString('hex')}`;
  const keyPrefix = rawKey.substring('itk_live_'.length, 'itk_live_'.length + 8);
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, keyPrefix, keyHash, userId, JSON.stringify(permissions), expiresAt);
  return rawKey;
}

beforeAll(async () => {
  initializeDatabase();

  adminId = randomUUID();
  ownerId = randomUUID();
  otherId = randomUUID();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const ownerHash = await bcrypt.hash('Owner-P@ss1234!', 10);
  const otherHash = await bcrypt.hash('Other-P@ss1234!', 10);

  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(adminId, 'admin@apikeystest.local', adminHash, 'admin', 'ApiKeys Admin');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(ownerId, 'owner@apikeystest.local', ownerHash, 'user', 'ApiKeys Owner');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(otherId, 'other@apikeystest.local', otherHash, 'user', 'ApiKeys Other');

  app = createApp();

  admin = await login('admin@apikeystest.local', 'Admin-P@ss1234!');
  owner = await login('owner@apikeystest.local', 'Owner-P@ss1234!');
  other = await login('other@apikeystest.local', 'Other-P@ss1234!');
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('API-key scope enforcement (read vs write)', () => {
  let readKey: string;
  let writeKey: string;

  beforeAll(async () => {
    readKey = (await createKey(owner, 'read-only key', ['read'])).key;
    writeKey = (await createKey(owner, 'write key', ['read', 'write'])).key;
  });

  it('lets a READ-scope key GET (200)', async () => {
    const res = await request(app)
      .get('/api/tickets?limit=1')
      .set('Authorization', `Bearer ${readKey}`);
    expect(res.status).toBe(200);
  });

  it('blocks a READ-scope key POST with forbidden_scope (403)', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${readKey}`)
      .send({ title: 'should be blocked', description: 'read scope', priority: 'low' });
    expect(res.status).toBe(403);
    // Must be the scope guard, NOT the CSRF double-submit check.
    expect(res.body.code).not.toBe('EBADCSRFTOKEN');
    expect(res.body.error).toMatch(/skrivrättigheter/i);
  });

  it('blocks a READ-scope key PUT with forbidden_scope (403)', async () => {
    const res = await request(app)
      .put(`/api/tickets/${randomUUID()}`)
      .set('Authorization', `Bearer ${readKey}`)
      .send({ status: 'in-progress' });
    expect(res.status).toBe(403);
    expect(res.body.code).not.toBe('EBADCSRFTOKEN');
    expect(res.body.error).toMatch(/skrivrättigheter/i);
  });

  it('blocks a READ-scope key DELETE with forbidden_scope (403)', async () => {
    const res = await request(app)
      .delete(`/api/tickets/${randomUUID()}`)
      .set('Authorization', `Bearer ${readKey}`);
    expect(res.status).toBe(403);
    expect(res.body.code).not.toBe('EBADCSRFTOKEN');
    expect(res.body.error).toMatch(/skrivrättigheter/i);
  });

  it('lets a WRITE-scope key perform a mutating request (201) — CSRF bypassed, scope allowed', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${writeKey}`)
      .send({ title: 'Created via write key', description: 'write scope', priority: 'low' });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.title).toBe('Created via write key');
  });

  it('rejects a bogus itk_live_ key (falls through to JWT → 401)', async () => {
    const res = await request(app)
      .get('/api/tickets?limit=1')
      .set('Authorization', 'Bearer itk_live_deadbeef0123456789abcdef01234567');
    expect(res.status).toBe(401);
  });
});

describe('API-key ownership authorization (list/delete)', () => {
  let ownerKeyId: string;

  beforeAll(async () => {
    ownerKeyId = (await createKey(owner, 'owner-listing key', ['read'])).id;
  });

  it('lists ONLY the calling user\'s own keys', async () => {
    const ownerRes = await request(app)
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRes.status).toBe(200);
    expect(Array.isArray(ownerRes.body)).toBe(true);
    const ownerIds = ownerRes.body.map((k: { id: string }) => k.id);
    expect(ownerIds).toContain(ownerKeyId);

    // A different user does not see the owner's key.
    const otherRes = await request(app)
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${other.token}`);
    expect(otherRes.status).toBe(200);
    const otherIds = otherRes.body.map((k: { id: string }) => k.id);
    expect(otherIds).not.toContain(ownerKeyId);
  });

  it('does NOT let another non-admin user delete the owner\'s key (404)', async () => {
    const res = await other.agent
      .delete(`/api/api-keys/${ownerKeyId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .set('x-csrf-token', other.csrf);
    expect(res.status).toBe(404);
    // The key still exists for its owner.
    const stillThere = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(ownerKeyId);
    expect(stillThere).toBeDefined();
  });

  it('admin does NOT have cross-user access either (current impl is owner-scoped) — admin delete of another user\'s key returns 404', async () => {
    // REPORT: api-keys routes are scoped strictly to `user_id = req.user.id`
    // with NO admin override (see apiKeys.ts GET/DELETE). The coverage brief
    // expected "admin can manage all"; the real authz does not grant that.
    // This test pins the ACTUAL behavior.
    const res = await admin.agent
      .delete(`/api/api-keys/${ownerKeyId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(404);
    const stillThere = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(ownerKeyId);
    expect(stillThere).toBeDefined();
  });

  it('lets the owner delete their OWN key (200)', async () => {
    const toDelete = (await createKey(owner, 'deletable key', ['read'])).id;
    const res = await owner.agent
      .delete(`/api/api-keys/${toDelete}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('x-csrf-token', owner.csrf);
    expect(res.status).toBe(200);
    const gone = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(toDelete);
    expect(gone).toBeUndefined();
  });
});

describe('API-key default TTL (expires_at)', () => {
  it('defaults expires_at to ~1 year out when none is provided', async () => {
    const before = Date.now();
    const created = await createKey(other, 'no-expiry key', ['read']);
    expect(created.expires_at).toBeTruthy();

    const expiresMs = new Date(created.expires_at as string).getTime();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    const expectedMin = before + oneYearMs - 2 * 24 * 60 * 60 * 1000; // ~2 days slack (leap year / clock)
    const expectedMax = Date.now() + oneYearMs + 2 * 24 * 60 * 60 * 1000;
    expect(expiresMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresMs).toBeLessThanOrEqual(expectedMax);

    // Confirm it was persisted, not just echoed in the response.
    const row = db.prepare('SELECT expires_at FROM api_keys WHERE id = ?').get(created.id) as
      | { expires_at: string | null }
      | undefined;
    expect(row?.expires_at).toBe(created.expires_at);
  });

  it('respects an explicit future expires_at', async () => {
    const explicit = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // +30 days
    const created = await createKey(other, 'explicit-expiry key', ['read'], explicit);
    // Stored value is the normalized ISO string of the provided date.
    expect(new Date(created.expires_at as string).getTime()).toBe(new Date(explicit).getTime());
  });

  it('rejects a past expires_at (400)', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await other.agent
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${other.token}`)
      .set('x-csrf-token', other.csrf)
      .send({ name: 'past expiry', permissions: ['read'], expires_at: past });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/framtiden/i);
  });

  it('rejects a garbage expires_at (400)', async () => {
    const res = await other.agent
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${other.token}`)
      .set('x-csrf-token', other.csrf)
      .send({ name: 'garbage expiry', permissions: ['read'], expires_at: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/giltigt datum/i);
  });
});

/**
 * requireAdmin + API-key admin scope (security fix): previously an API key
 * bound to an admin user passed every requireAdmin-guarded route regardless
 * of the key's own `permissions`, because requireAdmin only ever looked at
 * `req.user.role`. It now also requires `req.apiKey.permissions` to include
 * 'admin' whenever the request was authenticated via API key — narrowing
 * only, matching the write-scope guard's "the key is the credential" stance.
 *
 * GET /api/webhooks is used as the probe route: requireAdmin-protected, no
 * params, always 200s for an authenticated admin with no extra fixtures.
 */
describe('requireAdmin: API-key admin scope required (not just owner role)', () => {
  const ADMIN_ROUTE = '/api/webhooks';

  it('an admin-owned key WITHOUT admin scope is blocked (403) — this is the vulnerability being closed', async () => {
    const key = (await createKey(admin, 'admin read-only key', ['read'])).key;
    const res = await request(app)
      .get(ADMIN_ROUTE)
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(403);
  });

  it('an admin-owned key WITH admin scope passes (200)', async () => {
    const key = (await createKey(admin, 'admin scoped key', ['read', 'admin'])).key;
    const res = await request(app)
      .get(ADMIN_ROUTE)
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
  });

  it('a non-admin-owned key carrying admin scope (legacy/tampered row) does NOT gain access (403) — scope only narrows, never widens beyond the owner\'s role', async () => {
    const key = insertKeyDirectly(ownerId, 'owner admin-scope key (legacy row)', ['read', 'admin']);
    const res = await request(app)
      .get(ADMIN_ROUTE)
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(403);
  });

  it('JWT session with role=admin is unaffected: still passes the same requireAdmin route (200)', async () => {
    const res = await request(app)
      .get(ADMIN_ROUTE)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/api-keys: permissions allowlist + admin-scope grant restriction', () => {
  it('rejects an unknown scope value (400)', async () => {
    const res = await other.agent
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${other.token}`)
      .set('x-csrf-token', other.csrf)
      .send({ name: 'bad scope key', permissions: ['banana'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scope/i);
  });

  it('rejects a non-admin user requesting admin scope on their own key (403)', async () => {
    const res = await other.agent
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${other.token}`)
      .set('x-csrf-token', other.csrf)
      .send({ name: 'non-admin wants admin', permissions: ['read', 'admin'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/administratörer/i);
  });

  it('allows an admin user to create a key with admin scope (201)', async () => {
    const created = await createKey(admin, 'legit admin-scope key', ['read', 'admin']);
    expect(created.key).toBeTruthy();
  });
});

/**
 * Direct regression probe against GET /api/backup — the concrete route this
 * fix exists to protect (it streams the entire SQLite database, secrets
 * included). The webhooks-based tests above prove the requireAdmin/API-key
 * scope LOGIC works in isolation; they do NOT prove /api/backup itself is
 * still wired to that logic. If backup.ts's own gate is ever changed
 * (different middleware, a bespoke inline check, reordered guards) the
 * webhooks probe would stay green while the actual vulnerability reopened.
 * These two tests pin the sensitive route directly.
 *
 * Rate limiting note: GET /api/backup carries `backupDownloadLimiter`
 * (10 downloads / 15 min per IP — server/src/routes/backup.ts), but it sits
 * AFTER `requireAdmin` in the middleware chain, so the 403 case below never
 * consumes a slot. Only the second test (admin-scoped key) reaches the
 * limiter, consuming 1 of 10 for this test file's IP — well under the cap
 * for a single run and irrelevant to the other describe blocks here, which
 * never call /api/backup.
 */
describe('GET /api/backup: direct regression probe for the admin-scope fix', () => {
  it('an admin-owned key WITHOUT admin scope is blocked (403) with no database content leaked', async () => {
    const key = (await createKey(admin, 'admin read-only key (backup probe)', ['read'])).key;
    const res = await request(app)
      .get('/api/backup')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(403);
    // requireAdmin rejects BEFORE the backup handler ever runs, so the
    // response must be the plain JSON auth-denial body — never a zip stream
    // or any fragment of the database.
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.body.error).toBeTruthy();
  });

  it('an admin-owned key WITH admin scope is NOT blocked by requireAdmin (status is not 403)', async () => {
    const key = (await createKey(admin, 'admin scoped key (backup probe)', ['read', 'admin'])).key;
    const res = await request(app)
      .get('/api/backup')
      .set('Authorization', `Bearer ${key}`);
    // What this test proves is that requireAdmin let the request past the
    // auth gate. The eventual outcome of the actual backup/zip-streaming
    // logic under the test harness (200 with a zip, or a 500 from e.g.
    // archiver/tmp-file behavior in this environment) is exercised by
    // backup.test.ts and is out of scope here — we only assert the request
    // was not rejected by the admin-scope check this fix adds.
    expect(res.status).not.toBe(403);
  });
});
