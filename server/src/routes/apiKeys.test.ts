import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

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
 *    CSRF_SECRET/JWT_SECRET (>=32 chars; app exits otherwise) BEFORE any import
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
