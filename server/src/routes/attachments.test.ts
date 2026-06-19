import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Integration tests for the attachment upload/download/delete routes.
 *
 * Covers:
 *  - POST /api/attachments/ticket/:ticketId — multer fileFilter (MIME+ext allowlist)
 *    and magic-byte check
 *  - GET /api/attachments/ticket/:ticketId — list attachments (authz)
 *  - GET /api/attachments/file/:id — serve file (authz)
 *  - DELETE /api/attachments/:id — delete attachment (authz)
 *
 * Bootstrap mirrors app.test.ts / backup.test.ts: vi.hoisted() sets env vars
 * before any import that pulls in db/connection.ts. We also set UPLOAD_DIR to a
 * temp directory so uploads don't land in the source tree.
 *
 * Rate-limit note: login is rate-limited (5 attempts / 15 min / IP). We perform
 * exactly 2 logins (admin + non-admin user), staying safely under the cap.
 */

// ─── Magic-byte buffers (in-memory fixtures) ──────────────────────────────────

/** Minimal valid PNG header (8 bytes signature). */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A small valid-ish PNG: signature + some dummy trailing bytes. */
const VALID_PNG_BUFFER = Buffer.concat([PNG_MAGIC, Buffer.alloc(32)]);

/** Bytes that look like a PNG by extension but have wrong magic bytes. */
const FAKE_PNG_BUFFER = Buffer.from('This is not a PNG file at all!!');

/** A PDF-like buffer (wrong magic) but we'll declare it as image/png to trigger mismatch. */
const PDF_MAGIC_BUFFER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4

// ─── Environment setup (must run before any import of db/connection.ts) ───────

const UPLOAD_TEST_DIR = join(tmpdir(), `itticket-attach-uploads-${process.pid}-${Date.now()}`);

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');

  const dbPath = join(tmpdir(), `itticket-attach-test-${process.pid}-${Date.now()}.sqlite`);
  const uploadDir = join(tmpdir(), `itticket-attach-uploads-${process.pid}-${Date.now()}`);

  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-attach-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-attach-0123456789abcdef0123456789abcdef';
  process.env.UPLOAD_DIR = uploadDir;

  return { DB_PATH: dbPath };
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

let otherAgent: ReturnType<typeof request.agent>;
let otherToken: string;

/** Ticket owned by `assignedUserId` (via assigned_to). */
let ticketId: string;
let adminUserId: string;
let assignedUserId: string;
let otherUserId: string;

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Ensure the temp upload dir exists (attachments.ts mkdirSync runs at module
  // load time, but process.env.UPLOAD_DIR is already set via vi.hoisted).
  if (!existsSync(UPLOAD_TEST_DIR)) {
    mkdirSync(UPLOAD_TEST_DIR, { recursive: true });
  }

  initializeDatabase();

  // Seed users.
  adminUserId = randomUUID();
  assignedUserId = randomUUID();
  otherUserId = randomUUID();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  const otherHash = await bcrypt.hash('Other-P@ss1234!', 10);

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  ).run(adminUserId, 'admin@attachtest.local', adminHash, 'admin', 'Attach Admin');

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  ).run(assignedUserId, 'assigned@attachtest.local', userHash, 'user', 'Assigned User');

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  ).run(otherUserId, 'other@attachtest.local', otherHash, 'user', 'Other User');

  // Seed a ticket assigned to `assignedUserId`.
  // SQLite doesn't enforce FK by default so we can use a user UUID for
  // requester_id even though it nominally references contacts(id).
  ticketId = randomUUID();
  db.prepare(
    `INSERT INTO tickets (id, title, description, status, assigned_to) VALUES (?, ?, ?, ?, ?)`
  ).run(ticketId, 'Attachment Test Ticket', 'Used by attachments.test.ts', 'open', assignedUserId);

  app = createApp();

  // ── Admin session ──
  adminAgent = request.agent(app);
  const adminLogin = await adminAgent
    .post('/api/auth/login')
    .send({ email: 'admin@attachtest.local', password: 'Admin-P@ss1234!' });
  expect(adminLogin.status).toBe(200);
  adminToken = adminLogin.body.accessToken;

  const adminCsrf = await adminAgent
    .get('/api/csrf-token')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(adminCsrf.status).toBe(200);
  adminCsrfToken = adminCsrf.body.csrfToken;

  // ── Assigned user session ──
  userAgent = request.agent(app);
  const userLogin = await userAgent
    .post('/api/auth/login')
    .send({ email: 'assigned@attachtest.local', password: 'User-P@ss1234!' });
  expect(userLogin.status).toBe(200);
  userToken = userLogin.body.accessToken;

  const userCsrf = await userAgent
    .get('/api/csrf-token')
    .set('Authorization', `Bearer ${userToken}`);
  expect(userCsrf.status).toBe(200);
  userCsrfToken = userCsrf.body.csrfToken;

  // ── Unrelated user session ──
  otherAgent = request.agent(app);
  const otherLogin = await otherAgent
    .post('/api/auth/login')
    .send({ email: 'other@attachtest.local', password: 'Other-P@ss1234!' });
  expect(otherLogin.status).toBe(200);
  otherToken = otherLogin.body.accessToken;
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
  // Remove temp upload dir.
  if (existsSync(UPLOAD_TEST_DIR)) {
    try {
      rmSync(UPLOAD_TEST_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/attachments/ticket/:ticketId — upload allowlist', () => {
  it('accepts a valid PNG file (correct magic bytes + allowed MIME + extension)', async () => {
    const res = await adminAgent
      .post(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', VALID_PNG_BUFFER, { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.ticket_id).toBe(ticketId);
    expect(res.body.file_name).toBe('test.png');
    expect(res.body.file_type).toBe('image/png');
    expect(res.body.url).toMatch(/^\/api\/attachments\/file\//);
  });

  it('rejects a file with a disallowed MIME type (text/html) with 400', async () => {
    const res = await adminAgent
      .post(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', Buffer.from('<html><body>XSS</body></html>'), {
        filename: 'evil.html',
        contentType: 'text/html',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it('rejects a file with a disallowed extension (.exe) with 400', async () => {
    // application/octet-stream is not in the MIME allowlist — rejected by MIME check first.
    const res = await adminAgent
      .post(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', Buffer.from('MZ\x90\x00'), {
        filename: 'malware.exe',
        contentType: 'application/octet-stream',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it('rejects a file with matching allowed MIME but disallowed extension with 400', async () => {
    // Mime type is valid (image/png) but extension is .xyz which is not allowed.
    const res = await adminAgent
      .post(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', VALID_PNG_BUFFER, {
        filename: 'image.xyz',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it('returns 400 when no file is attached', async () => {
    const res = await adminAgent
      .post(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no file/i);
  });

  it('returns 404 when uploading to a non-existent ticket', async () => {
    const nonExistentId = randomUUID();
    const res = await adminAgent
      .post(`/api/attachments/ticket/${nonExistentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', VALID_PNG_BUFFER, { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/ticket not found/i);
  });
});

describe('POST /api/attachments/ticket/:ticketId — magic-byte mismatch', () => {
  it('rejects a file declared as image/png but with non-PNG content (401 content mismatch)', async () => {
    // FAKE_PNG_BUFFER has no PNG magic bytes — should be caught by hasMagicByteMatch.
    const res = await adminAgent
      .post(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', FAKE_PNG_BUFFER, { filename: 'fake.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/i);
  });

  it('rejects a file with PDF magic bytes declared as image/png', async () => {
    // PDF_MAGIC_BUFFER starts with %PDF but is sent as image/png.
    const res = await adminAgent
      .post(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', PDF_MAGIC_BUFFER, { filename: 'trickery.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/i);
  });

  it('accepts a text/plain file (no magic-byte rule → pass-through)', async () => {
    // text/plain has no magic-byte signature — hasMagicByteMatch returns true.
    const res = await adminAgent
      .post(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', Buffer.from('Hello, world!'), {
        filename: 'readme.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(201);
    expect(res.body.file_type).toBe('text/plain');
  });
});

describe('GET /api/attachments/ticket/:ticketId — list attachments (authorization)', () => {
  it('returns 200 and the attachment list for an admin', async () => {
    const res = await adminAgent
      .get(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // We uploaded at least 2 valid attachments above (PNG + txt).
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    // Each item must include a URL.
    expect(res.body[0].url).toMatch(/^\/api\/attachments\/file\//);
  });

  it('returns 200 for an assigned user (authorized non-admin)', async () => {
    const res = await userAgent
      .get(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 403 for a user who is not admin/requester/assignee', async () => {
    const res = await otherAgent
      .get(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app).get(`/api/attachments/ticket/${ticketId}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/attachments/file/:id — serve file (authorization)', () => {
  let attachmentId: string;

  beforeAll(async () => {
    // Upload a fresh attachment to get a stable ID for file-serve tests.
    const res = await adminAgent
      .post(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', VALID_PNG_BUFFER, { filename: 'serve-test.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    attachmentId = res.body.id;
  });

  it('returns 200 and serves the file for an admin', async () => {
    const res = await adminAgent
      .get(`/api/attachments/file/${attachmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('returns 200 and serves the file for the assigned user', async () => {
    const res = await userAgent
      .get(`/api/attachments/file/${attachmentId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
  });

  it('returns 403 when an unrelated user attempts to download the file', async () => {
    const res = await otherAgent
      .get(`/api/attachments/file/${attachmentId}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });

  it('returns 404 for a non-existent attachment ID', async () => {
    const res = await adminAgent
      .get(`/api/attachments/file/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app).get(`/api/attachments/file/${attachmentId}`);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/attachments/:id', () => {
  let deleteAttachmentId: string;

  beforeAll(async () => {
    // Upload an attachment that we will delete in the tests.
    const res = await adminAgent
      .post(`/api/attachments/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', VALID_PNG_BUFFER, { filename: 'to-delete.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    deleteAttachmentId = res.body.id;
  });

  it('returns 403 when an unrelated user attempts to delete an attachment', async () => {
    // Fetch a valid CSRF token for the other user's session.
    const otherCsrf = await otherAgent
      .get('/api/csrf-token')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(otherCsrf.status).toBe(200);
    const otherCsrfToken = otherCsrf.body.csrfToken;

    const res = await otherAgent
      .delete(`/api/attachments/${deleteAttachmentId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .set('x-csrf-token', otherCsrfToken);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });

  it('returns 200 and removes the attachment when deleted by an admin', async () => {
    const res = await adminAgent
      .delete(`/api/attachments/${deleteAttachmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
  });

  it('returns 404 when trying to delete an already-deleted attachment', async () => {
    const res = await adminAgent
      .delete(`/api/attachments/${deleteAttachmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);

    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-existent attachment ID', async () => {
    const res = await adminAgent
      .delete(`/api/attachments/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);

    expect(res.status).toBe(404);
  });
});
