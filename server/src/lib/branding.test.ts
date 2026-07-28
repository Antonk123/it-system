import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, readdirSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Integration tests for the configurable-logo backend (Ticket L1):
 *  - GET  /api/public/branding       — unauthenticated, { logoUrl } contract
 *  - GET  /api/public/branding/logo  — unauthenticated, serves bytes
 *  - POST /api/settings/branding/logo   — admin-only upload + validation
 *  - DELETE /api/settings/branding/logo — admin-only, idempotent removal
 *
 * Bootstrap mirrors attachments.test.ts / settings.test.ts: vi.hoisted() sets
 * env vars (incl. UPLOAD_DIR pointed at a temp dir) before any import that
 * pulls in db/connection.ts.
 */

// ─── Magic-byte buffers (in-memory fixtures) ──────────────────────────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const VALID_PNG_BUFFER = Buffer.concat([PNG_MAGIC, Buffer.alloc(32)]);

/** Looks like a .png by name/declared MIME but has no PNG signature. */
const FAKE_PNG_BUFFER = Buffer.from('This is not a PNG file at all, just text.');

const SVG_BUFFER = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// ─── Environment setup (must run before any import of db/connection.ts) ───────

const { DB_PATH, UPLOAD_TEST_DIR } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');

  const dbPath = join(tmpdir(), `itticket-branding-test-${process.pid}-${Date.now()}.sqlite`);
  const uploadDir = join(tmpdir(), `itticket-branding-uploads-${process.pid}-${Date.now()}`);

  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-branding-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-branding-0123456789abcdef0123456789abcdef';
  process.env.UPLOAD_DIR = uploadDir;

  return { DB_PATH: dbPath, UPLOAD_TEST_DIR: uploadDir };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;

let adminAgent: ReturnType<typeof request.agent>;
let adminToken: string;
let adminCsrfToken: string;

let userAgent: ReturnType<typeof request.agent>;
let userToken: string;
let userCsrf: string;

async function loginAgent(email: string, password: string) {
  const a = request.agent(app);
  const login = await a.post('/api/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  const token = login.body.accessToken as string;
  const csrfRes = await a.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  return { agent: a, token, csrf: csrfRes.body.csrfToken as string };
}

function brandingDirFiles(): string[] {
  const dir = join(UPLOAD_TEST_DIR, 'branding');
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

beforeAll(async () => {
  if (!existsSync(UPLOAD_TEST_DIR)) {
    mkdirSync(UPLOAD_TEST_DIR, { recursive: true });
  }

  initializeDatabase();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), 'admin@brandingtest.local', adminHash, 'admin', 'Branding Admin');
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), 'user@brandingtest.local', userHash, 'user', 'Branding User');

  app = createApp();

  ({ agent: adminAgent, token: adminToken, csrf: adminCsrfToken } = await loginAgent(
    'admin@brandingtest.local',
    'Admin-P@ss1234!'
  ));
  ({ agent: userAgent, token: userToken, csrf: userCsrf } = await loginAgent(
    'user@brandingtest.local',
    'User-P@ss1234!'
  ));
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/public/branding', () => {
  it('is unauthenticated and returns logoUrl: null when nothing is configured', async () => {
    const res = await request(app).get('/api/public/branding');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ logoUrl: null });
  });
});

describe('GET /api/public/branding/logo', () => {
  it('404s when no logo is configured', async () => {
    const res = await request(app).get('/api/public/branding/logo');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/settings/branding/logo — auth', () => {
  it('rejects an unauthenticated upload (no CSRF + no token → 403 from CSRF-before-auth)', async () => {
    // Mirrors attachments.test.ts: global CSRF middleware runs before route
    // auth, so a request with neither CSRF token nor Authorization header
    // never reaches the authenticate() check — 403, not 401.
    const res = await request(app)
      .post('/api/settings/branding/logo')
      .attach('file', VALID_PNG_BUFFER, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  it('403 for an authenticated non-admin user (with valid CSRF)', async () => {
    const res = await userAgent
      .post('/api/settings/branding/logo')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .attach('file', VALID_PNG_BUFFER, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/settings/branding/logo — validation', () => {
  it('rejects SVG even with well-formed SVG content (400)', async () => {
    const res = await adminAgent
      .post('/api/settings/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', SVG_BUFFER, { filename: 'logo.svg', contentType: 'image/svg+xml' });

    expect(res.status).toBe(400);
  });

  it('rejects a file over 1 MB (400)', async () => {
    const oversized = Buffer.concat([PNG_MAGIC, Buffer.alloc(1024 * 1024 + 1)]);
    const res = await adminAgent
      .post('/api/settings/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', oversized, { filename: 'huge.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
  });

  it('rejects a .png-named file with image/png MIME but wrong magic bytes, and leaves nothing on disk', async () => {
    const before = brandingDirFiles();

    const res = await adminAgent
      .post('/api/settings/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', FAKE_PNG_BUFFER, { filename: 'fake.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/i);

    // The most important assertion: multer already wrote the file to disk
    // before the magic-byte check ran — it must be deleted on mismatch, not
    // just rejected in the HTTP response.
    const after = brandingDirFiles();
    expect(after).toEqual(before);

    // Public endpoint still reports no logo configured.
    const publicRes = await request(app).get('/api/public/branding');
    expect(publicRes.body).toEqual({ logoUrl: null });
  });
});

describe('POST /api/settings/branding/logo — happy path', () => {
  it('accepts a valid PNG, and GET /api/public/branding then returns a URL', async () => {
    const res = await adminAgent
      .post('/api/settings/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', VALID_PNG_BUFFER, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(typeof res.body.logoUrl).toBe('string');
    expect(res.body.logoUrl).toMatch(/^\/api\/public\/branding\/logo\?v=\d+$/);

    const publicRes = await request(app).get('/api/public/branding');
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.logoUrl).toBe(res.body.logoUrl);
  });

  it('GET /api/public/branding/logo serves the bytes with correct Content-Type and inline disposition', async () => {
    const res = await request(app).get('/api/public/branding/logo');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(Buffer.compare(res.body as Buffer, VALID_PNG_BUFFER)).toBe(0);

    // This is the guarantee that actually makes `inline` safe: the
    // magic-byte check (hasValidLogoMagicBytes) is a PREFIX check, not an
    // image validator — a polyglot (valid JPEG magic bytes + trailing
    // <script>) passes it (see routes/public.ts comment + security review
    // finding L1c#1). Without `nosniff`, a browser could still sniff such a
    // polyglot response and render it as text/html. If this header is ever
    // dropped, the `inline` exception's security rationale no longer holds.
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    // CORP relaxation (fix L1c#6): this route deliberately sets
    // cross-origin (overriding helmet's global same-origin default) so the
    // logo renders in an <img> when the frontend and API are on different
    // origins (e.g. the dev stack). Assert it's actually cross-origin here,
    // not the global same-origin default.
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('a new upload deletes the previous logo file from disk', async () => {
    const filesAfterFirstUpload = brandingDirFiles();
    expect(filesAfterFirstUpload.length).toBe(1);

    const secondPng = Buffer.concat([PNG_MAGIC, Buffer.alloc(8)]);
    const res = await adminAgent
      .post('/api/settings/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', secondPng, { filename: 'logo2.png', contentType: 'image/png' });

    expect(res.status).toBe(200);

    const filesAfterSecondUpload = brandingDirFiles();
    // Old file replaced, not accumulated.
    expect(filesAfterSecondUpload.length).toBe(1);
    expect(filesAfterSecondUpload[0]).not.toBe(filesAfterFirstUpload[0]);
  });
});

describe('DELETE /api/settings/branding/logo', () => {
  it('rejects an unauthenticated delete (no CSRF + no token → 403 from CSRF-before-auth)', async () => {
    const unauth = await request(app).delete('/api/settings/branding/logo');
    expect(unauth.status).toBe(403);
  });

  it('403 for an authenticated non-admin (with valid CSRF)', async () => {
    const forbidden = await userAgent
      .delete('/api/settings/branding/logo')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf);
    expect(forbidden.status).toBe(403);
  });

  it('removes the configured logo (204), and the file is gone from disk', async () => {
    expect(brandingDirFiles().length).toBe(1);

    const res = await adminAgent
      .delete('/api/settings/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);
    expect(res.status).toBe(204);

    expect(brandingDirFiles().length).toBe(0);

    const publicRes = await request(app).get('/api/public/branding');
    expect(publicRes.body).toEqual({ logoUrl: null });

    const logoRes = await request(app).get('/api/public/branding/logo');
    expect(logoRes.status).toBe(404);
  });

  it('is idempotent — 204 again even though nothing is configured', async () => {
    const res = await adminAgent
      .delete('/api/settings/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);
    expect(res.status).toBe(204);
  });
});

describe('GET /api/public/branding/logo — path-traversal defense', () => {
  it('404s instead of serving the file when branding_logo_filename escapes BRANDING_DIR', async () => {
    // Simulate a "filename" that's no longer trustworthy (future bug /
    // generic settings-write endpoint / bad restore / SQLi elsewhere) by
    // writing the app_settings row directly, bypassing saveLogoSettings().
    const sentinelPath = join(UPLOAD_TEST_DIR, 'secret.txt');
    writeFileSync(sentinelPath, 'TOP SECRET — should never be served');

    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    upsert.run('branding_logo_filename', '../secret.txt');
    upsert.run('branding_logo_mime', 'image/png');
    upsert.run('branding_logo_updated_at', now);

    try {
      const res = await request(app).get('/api/public/branding/logo');
      expect(res.status).toBe(404);
    } finally {
      db.prepare(`DELETE FROM app_settings WHERE key IN (?, ?, ?)`).run(
        'branding_logo_filename',
        'branding_logo_mime',
        'branding_logo_updated_at'
      );
      if (existsSync(sentinelPath)) rmSync(sentinelPath);
    }
  });
});
