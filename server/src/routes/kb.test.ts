import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Integration tests for the Knowledge Base routes (server/src/routes/kb.ts).
 *
 * Covers:
 *  1. POST /api/kb/upload-image — auth/authz (401/403), magic-byte rejection,
 *     successful upload (file written to disk).
 *  2. Article CRUD authorization — create/update/delete require admin (401/403/2xx
 *     per the actual middleware chain), read routes only require authentication,
 *     draft articles are hidden from non-admins.
 *  3. M11 regression — embedded <img> cleanup: creating an article with two
 *     embedded KB images, then PUT-ing content that drops one of them deletes
 *     ONLY that file from disk; DELETE-ing the article removes the rest.
 *  4. GET /api/kb/public/:token — works without authentication (valid token),
 *     404 for an invalid token, and the kbShareRateLimiter (30 req/min/IP)
 *     mounted on this route trips a 429 on the 31st request from one IP.
 *  5. FTS5 sync — kb_articles_fts is populated/updated manually by kb.ts (no
 *     triggers), so a created article is findable by title, and after a title
 *     change the article is found under the NEW title and not the old one.
 *
 * Bootstrap mirrors attachments.test.ts: vi.hoisted() sets a unique DB_PATH,
 * secrets, and UPLOAD_DIR (isolated temp dir) BEFORE any import pulls in
 * db/connection.ts or kb.ts (UPLOAD_DIR is read at kb.ts module-load time).
 *
 * Rate-limit note: kbShareRateLimiter and writeRateLimiter are module-level
 * singletons, but vitest isolates each test file's module registry by default,
 * so this file gets its own fresh buckets — no cross-file interference. Within
 * this file we use a dedicated X-Forwarded-For IP per functional /public/:token
 * call (never reused) plus ONE separate fixed IP reserved solely for the
 * rate-limit-exhaustion test, mirroring the pattern in auth.test.ts.
 */

// ─── Magic-byte buffers (in-memory fixtures) ──────────────────────────────────

/** Minimal valid PNG header (8 bytes signature) + padding. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const VALID_PNG_BUFFER = Buffer.concat([PNG_MAGIC, Buffer.alloc(32)]);

/** Declared as image/png but has no PNG magic bytes — should fail hasMagicByteMatch. */
const FAKE_PNG_BUFFER = Buffer.from('This is not a PNG file at all!!');

// ─── Environment setup (must run before any import of db/connection.ts / kb.ts) ─

const { DB_PATH, UPLOAD_TEST_DIR } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');

  const dbPath = join(tmpdir(), `itticket-kb-test-${process.pid}-${Date.now()}.sqlite`);
  const uploadDir = join(tmpdir(), `itticket-kb-uploads-${process.pid}-${Date.now()}`);

  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-kb-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-kb-0123456789abcdef0123456789abcdef';
  process.env.UPLOAD_DIR = uploadDir;

  return { DB_PATH: dbPath, UPLOAD_TEST_DIR: uploadDir };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

// ─── Shared state ─────────────────────────────────────────────────────────────

let app: ReturnType<typeof createApp>;

let adminAgent: ReturnType<typeof request.agent>;
let adminToken: string;
let adminCsrfToken: string;

let userAgent: ReturnType<typeof request.agent>;
let userToken: string;
let userCsrfToken: string;

// Anonymous session (no Authorization header) — used to obtain a valid CSRF
// token for "unauthenticated" write requests, so those requests fail at the
// `authenticate` middleware (401) rather than at the CSRF layer (403).
let anonAgent: ReturnType<typeof request.agent>;
let anonCsrfToken: string;

let categoryId: string;
let adminId: string;
// Bound to adminId but scoped ['read','write'] — no 'admin' permission.
let scopedAdminKey: string;
let portalAdminKey: string;
let portalAdminKeyId: string;

// A fresh, unique source IP per call, so functional /public/:token calls never
// share a rate-limit bucket with each other or with the dedicated trip test.
let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 250) + 1}`; // TEST-NET-3, stays valid
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // kb.ts already mkdirSync's UPLOAD_DIR at module-load time (see kb.ts:22-24),
  // but be defensive in case import order ever changes.
  if (!existsSync(UPLOAD_TEST_DIR)) {
    mkdirSync(UPLOAD_TEST_DIR, { recursive: true });
  }

  initializeDatabase();

  adminId = randomUUID();
  const userId = randomUUID();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const userHash = await bcrypt.hash('User-P@ss1234!', 10);

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  ).run(adminId, 'admin@kbtest.local', adminHash, 'admin', 'KB Admin');

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, 'user@kbtest.local', userHash, 'user', 'KB User');

  categoryId = randomUUID();
  db.prepare(
    `INSERT INTO kb_categories (id, name, color, position) VALUES (?, ?, ?, ?)`
  ).run(categoryId, 'Test Category', '#3b82f6', 0);

  {
    const rawKey = `itk_live_${randomBytes(16).toString('hex')}`;
    const keyPrefix = rawKey.substring('itk_live_'.length, 'itk_live_'.length + 8);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    db.prepare(
      `INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), 'scoped-test-key', keyPrefix, keyHash, adminId, JSON.stringify(['read', 'write']));
    scopedAdminKey = rawKey;
  }
  {
    portalAdminKey = `itk_live_${randomBytes(16).toString('hex')}`;
    portalAdminKeyId = randomUUID();
    const keyPrefix = portalAdminKey.substring('itk_live_'.length, 'itk_live_'.length + 8);
    const keyHash = createHash('sha256').update(portalAdminKey).digest('hex');
    db.prepare(
      `INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(portalAdminKeyId, 'portal-admin-test-key', keyPrefix, keyHash, adminId, JSON.stringify(['read', 'write', 'admin']));
  }

  app = createApp();

  // ── Admin session ──
  adminAgent = request.agent(app);
  const adminLogin = await adminAgent
    .post('/api/auth/login')
    .send({ email: 'admin@kbtest.local', password: 'Admin-P@ss1234!' });
  expect(adminLogin.status).toBe(200);
  adminToken = adminLogin.body.accessToken;

  const adminCsrf = await adminAgent
    .get('/api/csrf-token')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(adminCsrf.status).toBe(200);
  adminCsrfToken = adminCsrf.body.csrfToken;

  // ── Non-admin user session ──
  userAgent = request.agent(app);
  const userLogin = await userAgent
    .post('/api/auth/login')
    .send({ email: 'user@kbtest.local', password: 'User-P@ss1234!' });
  expect(userLogin.status).toBe(200);
  userToken = userLogin.body.accessToken;

  const userCsrf = await userAgent
    .get('/api/csrf-token')
    .set('Authorization', `Bearer ${userToken}`);
  expect(userCsrf.status).toBe(200);
  userCsrfToken = userCsrf.body.csrfToken;

  // ── Anonymous session (no Authorization header) ──
  anonAgent = request.agent(app);
  const anonCsrf = await anonAgent.get('/api/csrf-token');
  expect(anonCsrf.status).toBe(200);
  anonCsrfToken = anonCsrf.body.csrfToken;
});

afterAll(() => {
  try {
    closeDatabase();
  } catch {
    /* ignore */
  }
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
  if (existsSync(UPLOAD_TEST_DIR)) {
    try {
      rmSync(UPLOAD_TEST_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

// ─── 1. POST /api/kb/upload-image ──────────────────────────────────────────────

describe('POST /api/kb/upload-image', () => {
  it('returns 401 without authentication', async () => {
    const res = await anonAgent
      .post('/api/kb/upload-image')
      .set('x-csrf-token', anonCsrfToken)
      .attach('image', VALID_PNG_BUFFER, { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(401);
  });

  it('returns 403 for an authenticated non-admin user', async () => {
    const res = await userAgent
      .post('/api/kb/upload-image')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrfToken)
      .attach('image', VALID_PNG_BUFFER, { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('rejects a file declared as image/png but with non-PNG content (magic-byte mismatch, 400)', async () => {
    const res = await adminAgent
      .post('/api/kb/upload-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('image', FAKE_PNG_BUFFER, { filename: 'fake.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Filinnehållet matchar inte filtypen');
  });

  it('rejects a disallowed extension (.exe) with 400 (multer fileFilter)', async () => {
    const res = await adminAgent
      .post('/api/kb/upload-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('image', Buffer.from('MZ\x90\x00'), { filename: 'malware.exe', contentType: 'application/octet-stream' });

    expect(res.status).toBe(400);
  });

  it('accepts a valid PNG (correct magic bytes) and writes it to disk under UPLOAD_DIR', async () => {
    const res = await adminAgent
      .post('/api/kb/upload-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('image', VALID_PNG_BUFFER, { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/api\/kb\/images\/kb-\d+-[0-9a-f]{24}\.png$/);

    const filename = res.body.url.replace('/api/kb/images/', '');
    expect(existsSync(join(UPLOAD_TEST_DIR, filename))).toBe(true);
  });
});

// ─── 2. Article CRUD — authorization ───────────────────────────────────────────

describe('KB article CRUD — authorization', () => {
  let articleId: string;

  it('POST /api/kb/articles returns 401 without authentication', async () => {
    const res = await anonAgent
      .post('/api/kb/articles')
      .set('x-csrf-token', anonCsrfToken)
      .send({ title: 'Should Fail', content: '<p>x</p>', category_id: categoryId });

    expect(res.status).toBe(401);
  });

  it('POST /api/kb/articles returns 403 for an authenticated non-admin user', async () => {
    const res = await userAgent
      .post('/api/kb/articles')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrfToken)
      .send({ title: 'Should Fail', content: '<p>x</p>', category_id: categoryId });

    expect(res.status).toBe(403);
  });

  it('POST /api/kb/articles returns 201 for an admin', async () => {
    const res = await adminAgent
      .post('/api/kb/articles')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ title: 'CRUD Test Article', content: '<p>original</p>', category_id: categoryId });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('CRUD Test Article');
    articleId = res.body.id;
  });

  it('GET /api/kb/articles/:id returns 401 without authentication', async () => {
    const res = await request(app).get(`/api/kb/articles/${articleId}`);
    expect(res.status).toBe(401);
  });

  it('GET /api/kb/articles/:id returns 200 for an authenticated non-admin (read-only allowed)', async () => {
    const res = await userAgent
      .get(`/api/kb/articles/${articleId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(articleId);
  });

  it('PUT /api/kb/articles/:id returns 401 without authentication', async () => {
    const res = await anonAgent
      .put(`/api/kb/articles/${articleId}`)
      .set('x-csrf-token', anonCsrfToken)
      .send({ title: 'Updated', content: '<p>updated</p>', category_id: categoryId });

    expect(res.status).toBe(401);
  });

  it('PUT /api/kb/articles/:id returns 403 for an authenticated non-admin user', async () => {
    const res = await userAgent
      .put(`/api/kb/articles/${articleId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrfToken)
      .send({ title: 'Updated', content: '<p>updated</p>', category_id: categoryId });

    expect(res.status).toBe(403);
  });

  it('PUT /api/kb/articles/:id returns 200 for an admin', async () => {
    const res = await adminAgent
      .put(`/api/kb/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ title: 'CRUD Test Article Updated', content: '<p>updated</p>', category_id: categoryId });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('CRUD Test Article Updated');
  });

  it('DELETE /api/kb/articles/:id returns 401 without authentication', async () => {
    const res = await anonAgent
      .delete(`/api/kb/articles/${articleId}`)
      .set('x-csrf-token', anonCsrfToken);

    expect(res.status).toBe(401);
  });

  it('DELETE /api/kb/articles/:id returns 403 for an authenticated non-admin user', async () => {
    const res = await userAgent
      .delete(`/api/kb/articles/${articleId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrfToken);

    expect(res.status).toBe(403);
  });

  it('DELETE /api/kb/articles/:id returns 200 for an admin', async () => {
    const res = await adminAgent
      .delete(`/api/kb/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);

    expect(res.status).toBe(200);
  });

  it('DELETE /api/kb/articles/:id returns 404 for an already-deleted article', async () => {
    const res = await adminAgent
      .delete(`/api/kb/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);

    expect(res.status).toBe(404);
  });
});

describe('KB article draft visibility (GET /api/kb/articles/:id)', () => {
  let draftId: string;

  beforeAll(async () => {
    const res = await adminAgent
      .post('/api/kb/articles')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ title: 'Draft Article', content: '<p>secret draft</p>', category_id: categoryId, status: 'draft' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    draftId = res.body.id;
  });

  it('is visible to an admin', async () => {
    const res = await adminAgent
      .get(`/api/kb/articles/${draftId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  it('returns 404 for an authenticated non-admin (only published articles are visible to non-admins)', async () => {
    const res = await userAgent
      .get(`/api/kb/articles/${draftId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for an admin-owner API key WITHOUT admin scope (isEffectiveAdmin)', async () => {
    const res = await request(app)
      .get(`/api/kb/articles/${draftId}`)
      .set('Authorization', `Bearer ${scopedAdminKey}`);

    expect(res.status).toBe(404);
  });
});

// ─── 3. M11 regression — embedded image cleanup on update/delete ──────────────

describe('M11 regression — embedded <img> cleanup on update/delete', () => {
  let img1Filename: string;
  let img2Filename: string;
  let articleId: string;

  beforeAll(async () => {
    const up1 = await adminAgent
      .post('/api/kb/upload-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('image', VALID_PNG_BUFFER, { filename: 'embed1.png', contentType: 'image/png' });
    expect(up1.status).toBe(201);
    img1Filename = up1.body.url.replace('/api/kb/images/', '');

    const up2 = await adminAgent
      .post('/api/kb/upload-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('image', VALID_PNG_BUFFER, { filename: 'embed2.png', contentType: 'image/png' });
    expect(up2.status).toBe(201);
    img2Filename = up2.body.url.replace('/api/kb/images/', '');

    // Sanity: both freshly uploaded files exist before the article even references them.
    expect(existsSync(join(UPLOAD_TEST_DIR, img1Filename))).toBe(true);
    expect(existsSync(join(UPLOAD_TEST_DIR, img2Filename))).toBe(true);

    const createRes = await adminAgent
      .post('/api/kb/articles')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        title: 'Article With Embedded Images',
        content: `<p>intro</p><img src="/api/kb/images/${img1Filename}"><img src="/api/kb/images/${img2Filename}">`,
        category_id: categoryId,
      });
    expect(createRes.status).toBe(201);
    articleId = createRes.body.id;
    // Sanitizer must preserve the relative /api/kb/images/... src unchanged.
    expect(createRes.body.content).toContain(img1Filename);
    expect(createRes.body.content).toContain(img2Filename);
  });

  it('both embedded images still exist on disk right after article creation', () => {
    expect(existsSync(join(UPLOAD_TEST_DIR, img1Filename))).toBe(true);
    expect(existsSync(join(UPLOAD_TEST_DIR, img2Filename))).toBe(true);
  });

  it('PUT that drops one embedded image from content deletes ONLY that file from disk', async () => {
    const res = await adminAgent
      .put(`/api/kb/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        title: 'Article With Embedded Images',
        content: `<p>intro</p><img src="/api/kb/images/${img1Filename}">`,
        category_id: categoryId,
      });

    expect(res.status).toBe(200);
    expect(existsSync(join(UPLOAD_TEST_DIR, img1Filename))).toBe(true);
    expect(existsSync(join(UPLOAD_TEST_DIR, img2Filename))).toBe(false);
  });

  it('DELETE of the article removes the remaining embedded image from disk', async () => {
    const res = await adminAgent
      .delete(`/api/kb/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);

    expect(res.status).toBe(200);
    expect(existsSync(join(UPLOAD_TEST_DIR, img1Filename))).toBe(false);
  });
});

// ─── 4. GET /api/kb/public/:token ──────────────────────────────────────────────

describe('GET /api/kb/public/:token', () => {
  let shareToken: string;
  let sharedArticleId: string;

  beforeAll(async () => {
    const articleRes = await adminAgent
      .post('/api/kb/articles')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ title: 'Publicly Shared Article', content: '<p>public content</p>', category_id: categoryId });
    expect(articleRes.status).toBe(201);
    sharedArticleId = articleRes.body.id;

    const shareRes = await adminAgent
      .post(`/api/kb/articles/${sharedArticleId}/share`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);
    expect(shareRes.status).toBe(201);
    shareToken = shareRes.body.share_token;
  });

  it('returns the article for a valid token WITHOUT any authentication', async () => {
    const res = await request(app)
      .get(`/api/kb/public/${shareToken}`)
      .set('X-Forwarded-For', freshIp());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(sharedArticleId);
    expect(res.body.title).toBe('Publicly Shared Article');
  });

  it('returns 404 for an invalid/unknown token', async () => {
    const res = await request(app)
      .get('/api/kb/public/this-token-does-not-exist')
      .set('X-Forwarded-For', freshIp());

    expect(res.status).toBe(404);
  });

  // kbShareRateLimiter = createRateLimiter(60_000, 30) is mounted directly on
  // this route (see kb.ts). The app runs with `trust proxy = 1`, so req.ip is
  // taken from the first X-Forwarded-For entry — we exploit that to give this
  // test ONE dedicated, otherwise-unused source IP so it can deliberately
  // exhaust that single bucket deterministically (same technique as
  // auth.test.ts's login rate-limit suite).
  it('rate limits to 30 requests/min per IP — the 31st request gets 429', async () => {
    const RATE_LIMIT_IP = '198.51.100.222'; // TEST-NET-2, reserved solely for this test
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await request(app)
        .get(`/api/kb/public/${shareToken}`)
        .set('X-Forwarded-For', RATE_LIMIT_IP);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 30).every((s) => s !== 429)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

// ─── 5. FTS5 sync (manual, no DB triggers — kb.ts syncs kb_articles_fts itself) ─

describe('KB article FTS5 sync', () => {
  it('a newly created article is findable via search, and a title change moves it to the new title', async () => {
    const uniqueWord = `Zylofrantic${Date.now()}`;
    const createRes = await adminAgent
      .post('/api/kb/articles')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ title: `${uniqueWord} Setup Guide`, content: '<p>content</p>', category_id: categoryId });
    expect(createRes.status).toBe(201);
    const articleId = createRes.body.id;

    const searchRes = await adminAgent
      .get(`/api/kb/articles?search=${uniqueWord}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.some((a: { id: string }) => a.id === articleId)).toBe(true);

    const newTitleWord = `Wobblesnatch${Date.now()}`;
    const updateRes = await adminAgent
      .put(`/api/kb/articles/${articleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ title: `${newTitleWord} Renamed`, content: '<p>content</p>', category_id: categoryId });
    expect(updateRes.status).toBe(200);

    const searchOldTitle = await adminAgent
      .get(`/api/kb/articles?search=${uniqueWord}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(searchOldTitle.status).toBe(200);
    expect(searchOldTitle.body.some((a: { id: string }) => a.id === articleId)).toBe(false);

    const searchNewTitle = await adminAgent
      .get(`/api/kb/articles?search=${newTitleWord}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(searchNewTitle.status).toBe(200);
    expect(searchNewTitle.body.some((a: { id: string }) => a.id === articleId)).toBe(true);
  });
});

describe('KB public portal', () => {
  let portalToken: string;
  let categoryId: string;
  let publishedId: string;
  let draftId: string;

  it('requires admins, creates an auditable 128-bit token, is idempotent, and revokes/rotates it', async () => {
    expect((await request(app).get('/api/kb/portal-share')).status).toBe(401);
    expect((await userAgent.get('/api/kb/portal-share').set('Authorization', `Bearer ${userToken}`)).status).toBe(403);
    expect((await request(app).get('/api/kb/portal-share').set('Authorization', `Bearer ${scopedAdminKey}`)).status).toBe(403);
    expect((await adminAgent.post('/api/kb/portal-share').set('Authorization', `Bearer ${adminToken}`)).status).toBe(403);

    const created = await adminAgent.post('/api/kb/portal-share')
      .set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken);
    expect(created.status).toBe(201);
    expect(created.body.share_token).toMatch(/^[a-f0-9]{32}$/);
    const firstToken = created.body.share_token;
    expect(db.prepare("SELECT value FROM app_settings WHERE key = 'kb_public_share_token'").get()).toMatchObject({ value: firstToken });
    const repeated = await adminAgent.post('/api/kb/portal-share')
      .set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken);
    expect(repeated.status).toBe(200);
    expect(repeated.body.share_token).toBe(firstToken);
    const current = await adminAgent.get('/api/kb/portal-share').set('Authorization', `Bearer ${adminToken}`);
    expect(current.body).toEqual({ share_token: firstToken });
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'share_create' AND entity_type = 'kb_portal_share'").get()).toMatchObject({ count: 1 });

    expect((await adminAgent.delete('/api/kb/portal-share').set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken)).status).toBe(204);
    expect((await request(app).get(`/api/kb/portal/${firstToken}/categories`).set('X-Forwarded-For', freshIp())).body).toEqual({ error: 'Not found' });
    expect((await adminAgent.delete('/api/kb/portal-share').set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken)).status).toBe(204);
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'share_delete' AND entity_type = 'kb_portal_share'").get()).toMatchObject({ count: 1 });

    const rotated = await request(app).post('/api/kb/portal-share').set('Authorization', `Bearer ${portalAdminKey}`);
    expect(rotated.status).toBe(201);
    portalToken = rotated.body.share_token;
    expect(portalToken).not.toBe(firstToken);
    expect(db.prepare("SELECT api_key_id FROM audit_log WHERE action = 'share_create' AND entity_type = 'kb_portal_share' ORDER BY rowid DESC LIMIT 1").get()).toMatchObject({ api_key_id: portalAdminKeyId });
  });

  it('exposes published summary/detail DTOs only, supports search/filter, and excludes drafts', async () => {
    const category = await adminAgent.post('/api/kb/categories').set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken)
      .send({ name: `Portal category ${Date.now()}`, color: '#0ea5e9' });
    categoryId = category.body.id;
    const published = await adminAgent.post('/api/kb/articles').set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken)
      .send({ title: 'PublicPortalNeedle', content: '<p>Public <strong>portal</strong> content</p>', category_id: categoryId, status: 'published' });
    const draft = await adminAgent.post('/api/kb/articles').set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken)
      .send({ title: 'DraftPortalNeedle', content: '<p>secret</p>', category_id: categoryId, status: 'draft' });
    publishedId = published.body.id;
    draftId = draft.body.id;

    const categories = await request(app).get(`/api/kb/portal/${portalToken}/categories`).set('X-Forwarded-For', freshIp());
    expect(categories.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(categories.headers['cache-control']).toBe('private, no-store');
    expect(categories.body.find((row: { id: string }) => row.id === categoryId)).toMatchObject({ article_count: 1 });
    const list = await request(app).get(`/api/kb/portal/${portalToken}/articles?category_id=${categoryId}`).set('X-Forwarded-For', freshIp());
    expect(list.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(list.headers['cache-control']).toBe('private, no-store');
    expect(list.body.map((row: { id: string }) => row.id)).toEqual([publishedId]);
    const summary = list.body[0];
    expect(Object.keys(summary).sort()).toEqual(['article_type', 'category_color', 'category_id', 'category_name', 'id', 'snippet', 'tags', 'title', 'updated_at']);
    expect(summary.snippet).toBe('Public portal content');
    expect((await request(app).get(`/api/kb/portal/${portalToken}/articles?search=DraftPortalNeedle`).set('X-Forwarded-For', freshIp())).body).toEqual([]);
    expect((await request(app).get(`/api/kb/portal/${portalToken}/articles?search=PublicPortalNeedle`).set('X-Forwarded-For', freshIp())).body[0].id).toBe(publishedId);
    expect((await request(app).get(`/api/kb/portal/${portalToken}/articles?search=portal%20content`).set('X-Forwarded-For', freshIp())).body[0].id).toBe(publishedId);
    const detail = await request(app).get(`/api/kb/portal/${portalToken}/articles/${publishedId}`).set('X-Forwarded-For', freshIp());
    expect(detail.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(detail.headers['cache-control']).toBe('private, no-store');
    expect(detail.body.content).toBe('<p>Public <strong>portal</strong> content</p>');
    expect(Object.keys(detail.body).sort()).toEqual(['article_type', 'category_color', 'category_id', 'category_name', 'content', 'id', 'snippet', 'tags', 'title', 'updated_at']);
    expect((await request(app).get(`/api/kb/portal/${portalToken}/articles/${draftId}`).set('X-Forwarded-For', freshIp())).status).toBe(404);
  });

  it('includes newly published content, limits at 120/min/IP, and blocks draft individual links', async () => {
    const added = await adminAgent.post('/api/kb/articles').set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken)
      .send({ title: 'Auto visible', content: '<p>public</p>', category_id: categoryId, status: 'published' });
    const refreshed = await request(app).get(`/api/kb/portal/${portalToken}/articles?category_id=${categoryId}`).set('X-Forwarded-For', freshIp());
    expect(refreshed.body.map((row: { id: string }) => row.id)).toContain(added.body.id);
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) statuses.push((await request(app).get(`/api/kb/portal/${portalToken}/categories`).set('X-Forwarded-For', '192.0.2.229')).status);
    expect(statuses.slice(0, 120).every(status => status !== 429)).toBe(true);
    expect(statuses[120]).toBe(429);

    expect((await adminAgent.post(`/api/kb/articles/${draftId}/share`).set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken)).status).toBe(409);
    const legacyToken = randomBytes(12).toString('hex');
    db.prepare('INSERT INTO kb_article_shares (id, article_id, share_token, created_at) VALUES (?, ?, ?, ?)').run(randomUUID(), draftId, legacyToken, new Date().toISOString());
    expect((await adminAgent.post(`/api/kb/articles/${draftId}/share`).set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken)).status).toBe(409);
    expect((await request(app).get(`/api/kb/public/${legacyToken}`).set('X-Forwarded-For', freshIp())).status).toBe(404);
  });
});

// ─── 7. Audit fixes: status filter, list mode, pagination ────────────────────

describe('GET /api/kb/articles — status filter, fields=list and pagination', () => {
  const marker = `Statusmark${Date.now()}`;
  let publishedId: string;
  let draftId: string;

  async function create(title: string, content: string, status: 'draft' | 'published') {
    const res = await adminAgent
      .post('/api/kb/articles')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ title, content, category_id: categoryId, status });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  const list = (token: string, qs: string) =>
    request(app).get(`/api/kb/articles?${qs}`).set('Authorization', `Bearer ${token}`);
  const ids = (body: Array<{ id: string }>) => body.map((a) => a.id);

  beforeAll(async () => {
    publishedId = await create(`${marker} publicerad`, `<p>${'x'.repeat(500)}</p><script>bad()</script>`, 'published');
    draftId = await create(`${marker} utkast`, '<p>utkast</p>', 'draft');
  });

  it('defaults to published only, for admins as well', async () => {
    const res = await list(adminToken, `search=${marker}`);
    expect(ids(res.body)).toEqual([publishedId]);
    const plain = await list(adminToken, '');
    expect(ids(plain.body)).not.toContain(draftId);
  });

  it('admin can list drafts (?status=draft) in both the FTS and the plain branch', async () => {
    const fts = await list(adminToken, `search=${marker}&status=draft`);
    expect(ids(fts.body)).toEqual([draftId]);
    const plain = await list(adminToken, 'status=draft');
    expect(ids(plain.body)).toContain(draftId);
    expect(ids(plain.body)).not.toContain(publishedId);
  });

  it('?status=all returns both; ?status=bogus falls back to published', async () => {
    const all = await list(adminToken, `search=${marker}&status=all`);
    expect(ids(all.body).sort()).toEqual([draftId, publishedId].sort());
    const bogus = await list(adminToken, `search=${marker}&status=bogus`);
    expect(ids(bogus.body)).toEqual([publishedId]);
  });

  it('non-admins always get published only, regardless of ?status', async () => {
    for (const status of ['draft', 'all']) {
      const res = await list(userToken, `search=${marker}&status=${status}`);
      expect(ids(res.body)).toEqual([publishedId]);
    }
  });

  it('an admin-owner API key without admin scope cannot list drafts', async () => {
    const res = await request(app).get(`/api/kb/articles?search=${marker}&status=draft`).set('Authorization', `Bearer ${scopedAdminKey}`);
    expect(ids(res.body)).toEqual([publishedId]);
  });

  it('default shape keeps full content', async () => {
    const res = await list(userToken, `search=${marker}`);
    expect(res.body[0].content).toContain('xxxx');
    expect(res.body[0].preview).toBeUndefined();
  });

  it('?fields=list replaces content with a 300-char plain-text preview', async () => {
    const res = await list(userToken, `search=${marker}&fields=list`);
    const article = res.body[0];
    expect(article.content).toBeUndefined();
    expect(article.preview).toHaveLength(300);
    expect(article.preview).not.toMatch(/[<>]/);
    expect(article.preview).not.toContain('bad()');
    expect(article.title).toContain(marker);
  });

  it('?page returns { data, pagination } and paginates', async () => {
    for (let i = 0; i < 3; i++) await create(`Pagemark${marker} ${i}`, '<p>p</p>', 'published');
    const first = await list(userToken, `search=Pagemark${marker}&page=1&limit=2&fields=list`);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.pagination).toEqual({ page: 1, limit: 2, total: 3 });
    const second = await list(userToken, `search=Pagemark${marker}&page=2&limit=2`);
    expect(second.body.data).toHaveLength(1);
    expect(ids(first.body.data)).not.toContain(second.body.data[0].id);
  });

  it('paginates the plain (non-search) branch and clamps limit', async () => {
    const res = await list(userToken, 'page=1&limit=100000');
    expect(res.body.pagination.limit).toBe(100);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(4);
  });
});

// ─── 8. Audit fixes: ticket links & share access ─────────────────────────────

describe('KB ticket links — access control', () => {
  let publishedId: string;
  let draftId: string;
  let openTicket: string;
  let lockedTicket: string;
  const asUser = (r: request.Test) => r.set('Authorization', `Bearer ${userToken}`).set('x-csrf-token', userCsrfToken);
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken);

  beforeAll(async () => {
    const mk = async (title: string, status: string) => (await asAdmin(adminAgent.post('/api/kb/articles'))
      .send({ title, content: '<p>x</p>', category_id: categoryId, status })).body.id as string;
    publishedId = await mk('Länkbar publicerad', 'published');
    draftId = await mk('Länkbar utkast', 'draft');
    openTicket = randomUUID();
    lockedTicket = randomUUID();
    const insert = db.prepare("INSERT INTO tickets (id, title, description, status, priority, assigned_to, created_by) VALUES (?, 't', 'd', 'open', 'medium', ?, ?)");
    insert.run(openTicket, null, null);
    insert.run(lockedTicket, adminId, adminId);
  });

  it('a user may link a published article to an unassigned ticket (201)', async () => {
    const res = await asUser(userAgent.post(`/api/kb/ticket/${openTicket}`)).send({ articleId: publishedId });
    expect(res.status).toBe(201);
  });

  it('a user cannot link to a ticket assigned to someone else (403)', async () => {
    const res = await asUser(userAgent.post(`/api/kb/ticket/${lockedTicket}`)).send({ articleId: publishedId });
    expect(res.status).toBe(403);
  });

  it('linking to a non-existent ticket is 404 (not 500/403)', async () => {
    const res = await asAdmin(adminAgent.post(`/api/kb/ticket/${randomUUID()}`)).send({ articleId: publishedId });
    expect(res.status).toBe(404);
  });

  it('a non-admin cannot link a draft article (404), an admin can (201)', async () => {
    const asNonAdmin = await asUser(userAgent.post(`/api/kb/ticket/${openTicket}`)).send({ articleId: draftId });
    expect(asNonAdmin.status).toBe(404);
    const asAdminRes = await asAdmin(adminAgent.post(`/api/kb/ticket/${openTicket}`)).send({ articleId: draftId });
    expect(asAdminRes.status).toBe(201);
  });

  it('rejects a missing/non-string articleId (400) and a duplicate link (409)', async () => {
    expect((await asAdmin(adminAgent.post(`/api/kb/ticket/${openTicket}`)).send({})).status).toBe(400);
    expect((await asAdmin(adminAgent.post(`/api/kb/ticket/${openTicket}`)).send({ articleId: { a: 1 } })).status).toBe(400);
    expect((await asAdmin(adminAgent.post(`/api/kb/ticket/${openTicket}`)).send({ articleId: draftId })).status).toBe(409);
  });

  it('GET /kb/ticket/:id hides linked drafts from non-admins but shows them to admins', async () => {
    const asNonAdmin = await request(app).get(`/api/kb/ticket/${openTicket}`).set('Authorization', `Bearer ${userToken}`);
    expect(asNonAdmin.status).toBe(200);
    expect(asNonAdmin.body.map((a: { id: string }) => a.id)).toEqual([publishedId]);
    const asAdminRes = await request(app).get(`/api/kb/ticket/${openTicket}`).set('Authorization', `Bearer ${adminToken}`);
    expect(asAdminRes.body.map((a: { id: string }) => a.id).sort()).toEqual([draftId, publishedId].sort());
  });

  it('GET /kb/ticket/:id returns 403 for a non-existent ticket', async () => {
    const res = await request(app).get(`/api/kb/ticket/${randomUUID()}`).set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('a user cannot remove a link from a ticket assigned to someone else (403)', async () => {
    db.prepare('INSERT INTO ticket_kb_links (id, ticket_id, article_id) VALUES (?, ?, ?)').run(randomUUID(), lockedTicket, publishedId);
    const res = await asUser(userAgent.delete(`/api/kb/ticket/${lockedTicket}/${publishedId}`));
    expect(res.status).toBe(403);
  });
});

describe('KB article share — admin-only read, optional expiry, image throttle', () => {
  let articleId: string;
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrfToken);

  beforeAll(async () => {
    const res = await asAdmin(adminAgent.post('/api/kb/articles'))
      .send({ title: 'Delad artikel', content: '<p>x</p>', category_id: categoryId });
    articleId = res.body.id;
  });

  it('GET /articles/:id/share is admin only (403 for a user, 401 anonymous)', async () => {
    expect((await request(app).get(`/api/kb/articles/${articleId}/share`).set('Authorization', `Bearer ${userToken}`)).status).toBe(403);
    expect((await request(app).get(`/api/kb/articles/${articleId}/share`)).status).toBe(401);
    expect((await request(app).get(`/api/kb/articles/${articleId}/share`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
  });

  it('POST /share validates expiresInDays (400)', async () => {
    for (const bad of [0, 366, 1.5, 'abc']) {
      expect((await asAdmin(adminAgent.post(`/api/kb/articles/${articleId}/share`)).send({ expiresInDays: bad })).status).toBe(400);
    }
  });

  it('works without an expires_at column and with it (NULL = no expiry, past = expired)', async () => {
    const created = await asAdmin(adminAgent.post(`/api/kb/articles/${articleId}/share`)).send({});
    expect([200, 201]).toContain(created.status);
    const token = created.body.share_token as string;
    expect((await request(app).get(`/api/kb/public/${token}`).set('X-Forwarded-For', freshIp())).status).toBe(200);

    const columns = db.prepare('PRAGMA table_info(kb_article_shares)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'expires_at')) {
      db.prepare('ALTER TABLE kb_article_shares ADD COLUMN expires_at TEXT').run();
    }

    // NULL expiry (legacy row) stays valid.
    expect((await request(app).get(`/api/kb/public/${token}`).set('X-Forwarded-For', freshIp())).status).toBe(200);

    db.prepare("UPDATE kb_article_shares SET expires_at = datetime('now', '-1 day') WHERE share_token = ?").run(token);
    expect((await request(app).get(`/api/kb/public/${token}`).set('X-Forwarded-For', freshIp())).status).toBe(404);
    expect((await request(app).get(`/api/kb/articles/${articleId}/share`).set('Authorization', `Bearer ${adminToken}`)).body.share_token).toBeNull();

    // An expired link is replaced by a fresh one with the requested lifetime.
    const renewed = await asAdmin(adminAgent.post(`/api/kb/articles/${articleId}/share`)).send({ expiresInDays: 7 });
    expect(renewed.status).toBe(201);
    expect(renewed.body.share_token).not.toBe(token);
    const row = db.prepare('SELECT expires_at FROM kb_article_shares WHERE share_token = ?').get(renewed.body.share_token) as { expires_at: string };
    expect(row.expires_at).toBeTruthy();
    expect((await request(app).get(`/api/kb/public/${renewed.body.share_token}`).set('X-Forwarded-For', freshIp())).status).toBe(200);
  });

  it('GET /images/:filename is rate limited (300/min per IP)', async () => {
    const ip = '198.51.100.77';
    // En gemensam lyssnande server undviker att 300 efemära servrar skapas/stängs (flaky "socket hang up").
    const server = app.listen(0);
    let last = 0;
    try {
      for (let i = 0; i < 301; i++) {
        last = (await request(server).get('/api/kb/images/kb-missing.png').set('X-Forwarded-For', ip)).status;
      }
    } finally {
      server.close();
    }
    expect(last).toBe(429);
  });
});
