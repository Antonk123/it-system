import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Integration tests for the backup/restore endpoints.
 *
 * ⚠️  process.exit constraint: A successful restore calls process.exit(0) after
 *     ~1500 ms. We NEVER test a successful restore path here — it would kill the
 *     vitest runner. All tests target early-return paths:
 *       - Auth failures (401 / 403)
 *       - Missing/invalid upload body (400)
 *       - Zip-slip rejection (500 from the caught error)
 *       - Missing database.sqlite inside ZIP (400)
 *
 * Bootstrap mirrors app.test.ts exactly: vi.hoisted() sets env vars first,
 * then we import createApp + DB helpers and seed a temp SQLite file.
 *
 * Rate-limit note: the login route is rate-limited to 5 attempts / 15 min per
 * IP. To stay safely below that cap we share a single login session per role
 * across all tests in this file (2 logins total: one admin, one regular user).
 */

const USER_EMAIL = 'user@backuptest.local';
const USER_PASSWORD = 'UserP@ss1234!';
const ADMIN_EMAIL = 'admin@backuptest.local';
const ADMIN_PASSWORD = 'Adm1n-S3cure-Pw!';

// Set process.env BEFORE any import that transitively pulls in db/connection.ts.
const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-backup-test-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-backup-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-backup-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;

// Shared sessions — created once in beforeAll so we never exceed the rate limit.
let adminAgent: ReturnType<typeof request.agent>;
let adminToken: string;
let adminCsrfToken: string;

let userAgent: ReturnType<typeof request.agent>;
let userToken: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an in-memory ZIP buffer using archiver.
 * NOTE: archiver normalises paths — it strips leading `../` components.
 * Use buildRawZipSlip() when you need to preserve a path-traversal entry.
 * entries: array of { name, content } where name is the in-archive path.
 */
function buildZipBuffer(entries: { name: string; content: Buffer | string }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 1 } });
    const chunks: Buffer[] = [];
    const passThrough = new PassThrough();
    passThrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passThrough.on('end', () => resolve(Buffer.concat(chunks)));
    passThrough.on('error', reject);
    archive.pipe(passThrough);
    for (const entry of entries) {
      archive.append(
        typeof entry.content === 'string' ? entry.content : entry.content,
        { name: entry.name },
      );
    }
    archive.finalize().catch(reject);
  });
}

/**
 * Build a minimal valid ZIP containing a single uncompressed file whose stored
 * name begins with `../` — archiver strips those segments, so we write raw ZIP
 * bytes instead. The format is: local file header + data + central directory +
 * end-of-central-directory record (all fields little-endian).
 */
function buildRawZipSlip(filename: string, content: Buffer): Buffer {
  const nameBytes = Buffer.from(filename, 'utf8');
  const fileSize = content.length;

  // CRC-32 (standard ZIP checksum)
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  let crcVal = 0xffffffff;
  for (let i = 0; i < content.length; i++) {
    crcVal = crcTable[(crcVal ^ content[i]) & 0xff] ^ (crcVal >>> 8);
  }
  const crc = (crcVal ^ 0xffffffff) >>> 0;

  // Local file header (30 bytes + filename)
  const lfh = Buffer.alloc(30 + nameBytes.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0, 6);
  lfh.writeUInt16LE(0, 8);  // stored (no compression)
  lfh.writeUInt16LE(0, 10);
  lfh.writeUInt16LE(0, 12);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(fileSize, 18);
  lfh.writeUInt32LE(fileSize, 22);
  lfh.writeUInt16LE(nameBytes.length, 26);
  lfh.writeUInt16LE(0, 28);
  nameBytes.copy(lfh, 30);

  const cdOffset = lfh.length + fileSize;

  // Central directory header (46 bytes + filename)
  const cdh = Buffer.alloc(46 + nameBytes.length);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(0, 10);
  cdh.writeUInt16LE(0, 12);
  cdh.writeUInt16LE(0, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(fileSize, 20);
  cdh.writeUInt32LE(fileSize, 24);
  cdh.writeUInt16LE(nameBytes.length, 28);
  cdh.writeUInt16LE(0, 30);
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36);
  cdh.writeUInt32LE(0, 38);
  cdh.writeUInt32LE(0, 42);  // offset of local file header
  nameBytes.copy(cdh, 46);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdh.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lfh, content, cdh, eocd]);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  initializeDatabase();

  const adminId = randomUUID();
  const userId = randomUUID();

  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const userHash = await bcrypt.hash(USER_PASSWORD, 10);

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`,
  ).run(adminId, ADMIN_EMAIL, adminHash, 'admin', 'Backup Admin');

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, USER_EMAIL, userHash, 'user', 'Regular User');

  app = createApp();

  // Login once as admin — reused by all admin tests.
  adminAgent = request.agent(app);
  const adminLogin = await adminAgent
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(adminLogin.status).toBe(200);
  adminToken = adminLogin.body.accessToken;

  // Fetch a CSRF token for the admin session.
  const csrfRes = await adminAgent
    .get('/api/csrf-token')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(csrfRes.status).toBe(200);
  adminCsrfToken = csrfRes.body.csrfToken;

  // Login once as regular user — reused by all non-admin tests.
  userAgent = request.agent(app);
  const userLogin = await userAgent
    .post('/api/auth/login')
    .send({ email: USER_EMAIL, password: USER_PASSWORD });
  expect(userLogin.status).toBe(200);
  userToken = userLogin.body.accessToken;
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
});

// ---------------------------------------------------------------------------
// GET /api/backup — download
// ---------------------------------------------------------------------------

describe('GET /api/backup', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/backup');
    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-admin user requests the backup', async () => {
    const res = await userAgent
      .get('/api/backup')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 with Content-Type application/zip for an admin', async () => {
    const res = await adminAgent
      .get('/api/backup')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
    // Content-Disposition must include "attachment" and a .zip filename.
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/\.zip/);
  });
});

// ---------------------------------------------------------------------------
// POST /api/backup/restore — upload
// ---------------------------------------------------------------------------

describe('POST /api/backup/restore', () => {
  it('returns 401 or 403 when no token is provided', async () => {
    // No auth at all. Depending on whether CSRF fires before auth middleware,
    // we get 401 (auth missing) or 403 (CSRF missing). Either way the request
    // is rejected before any DB access.
    const res = await request(app).post('/api/backup/restore');
    expect([401, 403]).toContain(res.status);
  });

  it('returns 403 when a non-admin user uploads a restore file', async () => {
    const userCsrfRes = await userAgent
      .get('/api/csrf-token')
      .set('Authorization', `Bearer ${userToken}`);
    expect(userCsrfRes.status).toBe(200);
    const userCsrfToken: string = userCsrfRes.body.csrfToken;

    const fakeZip = await buildZipBuffer([{ name: 'dummy.txt', content: 'data' }]);

    const res = await userAgent
      .post('/api/backup/restore')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrfToken)
      .attach('file', fakeZip, { filename: 'backup.zip', contentType: 'application/zip' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when no file is attached', async () => {
    const res = await adminAgent
      .post('/api/backup/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);
    // No file → multer stores nothing → req.file is undefined → 400
    expect(res.status).toBe(400);
  });

  it('returns 400 when a ZIP does not contain data/database.sqlite', async () => {
    // A valid ZIP but with no data/database.sqlite inside.
    const emptyZip = await buildZipBuffer([
      { name: 'somefile.txt', content: 'hello' },
    ]);

    const res = await adminAgent
      .post('/api/backup/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', emptyZip, { filename: 'backup.zip', contentType: 'application/zip' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/database\.sqlite/i);
  });

  it('returns 500 when the ZIP contains a zip-slip entry (../ path)', async () => {
    // archiver normalises paths (strips `../`), so we build raw ZIP bytes that
    // preserve the traversal path verbatim. buildRawZipSlip() writes a minimal
    // valid ZIP with a single stored entry whose filename starts with `../`.
    // unzipper passes that path directly to the backup.ts `entry.path` check,
    // which triggers the zip-slip guard and rejects the extraction promise.
    // The outer catch block returns 500.
    const zipSlipZip = buildRawZipSlip(
      '../../../etc/evil',
      Buffer.from('malicious content'),
    );

    const res = await adminAgent
      .post('/api/backup/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', zipSlipZip, {
        filename: 'malicious.zip',
        contentType: 'application/zip',
      });

    // The zip-slip guard rejects → promise rejects → outer catch → 500
    expect(res.status).toBe(500);
  });

  it('returns 400 when the database.sqlite inside the ZIP lacks required tables', async () => {
    // Create a real but invalid SQLite file: exists but has no 'tickets' or 'users' tables.
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { readFileSync, unlinkSync } = await import('node:fs');
    const Database = (await import('better-sqlite3')).default;

    const tempDbPath = join(tmpdir(), `backup-test-invalid-${randomUUID()}.sqlite`);
    const tempDb = new Database(tempDbPath);
    tempDb.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
    tempDb.close();

    const dbBytes = readFileSync(tempDbPath);
    try { unlinkSync(tempDbPath); } catch { /* ignore */ }

    const zipWithBadDb = await buildZipBuffer([
      { name: 'data/database.sqlite', content: dbBytes },
    ]);

    const res = await adminAgent
      .post('/api/backup/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', zipWithBadDb, {
        filename: 'backup.zip',
        contentType: 'application/zip',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tabeller/i);
  });
});
