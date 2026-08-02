import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'node:path';
import { tmpdir as osTmpdir } from 'node:os';
import http from 'node:http';
import { randomUUID, randomBytes, createHash } from 'crypto';

/**
 * Integration tests for the backup/restore endpoints.
 *
 * ⚠️  process.exit constraint: A successful restore sends its HTTP response
 *     (res.json) BEFORE scheduling `setTimeout(() => process.exit(0), 1500)`
 *     (backup.ts ~line 330-339). Supertest resolves on the response, so we can
 *     assert the happy path as long as `process.exit` is mocked first — see the
 *     'successful restore path (M14 happy path)' describe block at the bottom
 *     of this file. It runs LAST and closes the shared `db` handle + rewrites
 *     DB_PATH/UPLOAD_DIR, so nothing may run after it in this file.
 *
 * Bootstrap mirrors app.test.ts exactly: vi.hoisted() sets env vars first,
 * then we import createApp + DB helpers and seed a temp SQLite file.
 *
 * Rate-limit note: the login route is rate-limited to 5 attempts / 15 min per
 * IP. To stay safely below that cap we share a single login session per role
 * across all tests in this file (2 logins total: one admin, one regular user).
 * The restore route itself is separately rate-limited to 5 requests / 15 min
 * per IP (only counted for requests that pass admin auth) — this file makes
 * exactly 5 such requests total (4 pre-existing 400-path tests + the 1 new
 * happy-path test), staying at the cap rather than over it.
 */

const USER_EMAIL = 'user@backuptest.local';
const USER_PASSWORD = 'UserP@ss1234!';
const ADMIN_EMAIL = 'admin@backuptest.local';
const ADMIN_PASSWORD = 'Adm1n-S3cure-Pw!';

// Set process.env BEFORE any import that transitively pulls in db/connection.ts.
// UPLOAD_DIR is read at backup.ts module-load time (same as kb.ts/attachments.ts),
// so it must be set here too — otherwise the M14 happy-path restore below would
// mirror uploads into the real server/data/uploads directory on disk.
const { DB_PATH, UPLOAD_DIR } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-backup-test-${process.pid}-${Date.now()}.sqlite`);
  const uploadDir = join(tmpdir(), `itticket-backup-uploads-${process.pid}-${Date.now()}`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-backup-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-backup-0123456789abcdef0123456789abcdef';
  process.env.UPLOAD_DIR = uploadDir;
  return { DB_PATH: dbPath, UPLOAD_DIR: uploadDir };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { ZipArchive } from 'archiver';
import { PassThrough } from 'node:stream';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';
import { stopBackupScheduler } from '../lib/backupScheduler.js';
import { performRestoreSwap, logRestoreAudit } from './backup.js';

let app: ReturnType<typeof createApp>;

// Shared sessions — created once in beforeAll so we never exceed the rate limit.
let adminAgent: ReturnType<typeof request.agent>;
let adminToken: string;
let adminCsrfToken: string;
let adminId: string;

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
    const archive = new ZipArchive({ zlib: { level: 1 } });
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

/**
 * Build a real, valid backup ZIP for the M14 happy-path restore test: a genuine
 * SQLite file (correct magic header, opens with better-sqlite3, contains both
 * `tickets` and `users` so it passes the restore route's table check) plus a
 * throwaway `__restore_marker` row so the test can prove the file on DB_PATH
 * was actually replaced (not just that *a* valid db exists there), and one
 * uploads file to verify uploads mirroring.
 */
async function buildValidBackupZip(
  markerValue: string,
  uploadFileName: string,
  uploadContent: string,
): Promise<Buffer> {
  const Database = (await import('better-sqlite3')).default;
  const srcDir = mkdtempSync(join(osTmpdir(), 'backup-happy-src-'));
  const srcDbPath = join(srcDir, 'database.sqlite');

  const srcDb = new Database(srcDbPath);
  srcDb.exec(`
    CREATE TABLE tickets (id INTEGER PRIMARY KEY);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE __restore_marker (id INTEGER PRIMARY KEY, marker TEXT NOT NULL);
    -- Fynd F1: samma form som produktionsschemat (migration 051 + 066), inkl.
    -- api_key_id, så att M14-happy-path-testet kan bevisa att backup_restore-
    -- raden verkligen landar i DEN HÄR (återställda) filen via den riktiga
    -- routen — inte bara via ett direkt anrop av logRestoreAudit.
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      api_key_id TEXT
    );
  `);
  srcDb.prepare('INSERT INTO __restore_marker (marker) VALUES (?)').run(markerValue);
  srcDb.close();

  const dbBytes = readFileSync(srcDbPath);
  rmSync(srcDir, { recursive: true, force: true });

  return buildZipBuffer([
    { name: 'data/database.sqlite', content: dbBytes },
    { name: `data/uploads/${uploadFileName}`, content: uploadContent },
  ]);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  initializeDatabase();

  adminId = randomUUID();
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
    stopBackupScheduler();
  } catch {
    /* ignore */
  }
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
  // run-now-testet skriver verkliga backup-filer till dirname(DB_PATH)/backups.
  try {
    const { dirname, join } = require('node:path') as typeof import('node:path');
    rmSync(join(dirname(DB_PATH), 'backups'), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  // Städa UPLOAD_DIR (mkdirSync'ad av attachments.ts/kb.ts vid modul-load, och
  // skriven till av M14-happy-path-testet nedan).
  try {
    rmSync(UPLOAD_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    rmSync(`${DB_PATH}.pre-restore`, { force: true });
  } catch {
    /* ignore */
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

  it('skriver en audit-rad vid nedladdning (session, ingen API-nyckel → api_key_id NULL)', async () => {
    const row = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'backup_download' ORDER BY created_at DESC, rowid DESC LIMIT 1"
    ).get() as { api_key_id: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.api_key_id).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Fynd F2: audit-raden för backup_download loggades tidigare EFTER
  // archive.finalize() — en klient som avbryter anslutningen sent kunde i
  // praktiken ha fått hela databasen utan att en audit-rad skrevs. Nu loggas
  // avsikten INNAN archive.pipe(res) börjar strömma. Bevis: avbryt anslutningen
  // riktigt (socket-destroy) så snart FÖRSTA datachunken kommit — dvs. mitt i
  // strömmen, innan finalize() hunnit slutföras — och verifiera att raden ändå
  // finns. supertest buffrar hela svaret internt, så vi går runt det och pratar
  // rått HTTP mot en riktig lyssnande socket (app.listen(0)).
  // -------------------------------------------------------------------------
  it('skriver audit-raden INNAN strömningen är klar (F2): en tidigt avbruten nedladdning ger ändå en rad', async () => {
    // G2: räkna befintliga backup_download-rader FÖRE denna request och kräv
    // exakt EN NY rad efteråt. Utan detta hittar `expect(row).toBeDefined()`
    // bara den gamla raden från ett tidigare test i samma describe ("returns
    // 200..." ovan skriver redan en rad) — testet blir grönt oavsett om DENNA
    // request faktiskt loggar något, dvs. regressionsskyddet är verkningslöst.
    // Bevisat: att flytta tillbaka logAudit-anropet till efter
    // archive.finalize() (exakt buggen detta test ska skydda mot) gav 31/31
    // grönt innan denna fix — se rapporten.
    const before = (
      db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE action = 'backup_download'").get() as { count: number }
    ).count;

    const server = app.listen(0);
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      await new Promise<void>((resolve) => {
        const httpReq = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/backup',
            headers: { Authorization: `Bearer ${adminToken}` },
          },
          (res) => {
            // Förstör anslutningen så fort första chunken kommit — innan
            // strömmen (och därmed ev. arkivet) hunnit bli klar.
            res.once('data', () => {
              httpReq.destroy();
            });
            res.on('error', () => resolve());
            res.on('close', () => resolve());
          },
        );
        httpReq.on('error', () => resolve()); // destroy() ger ett förväntat socket-fel
        httpReq.end();
      });

      // Ge servern en kort stund att hantera avbrottet (res 'close'/'error').
      await new Promise((r) => setTimeout(r, 200));

      const after = (
        db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE action = 'backup_download'").get() as { count: number }
      ).count;
      expect(after).toBe(before + 1);

      const row = db.prepare(
        "SELECT * FROM audit_log WHERE action = 'backup_download' ORDER BY created_at DESC, rowid DESC LIMIT 1"
      ).get() as { created_at: string } | undefined;
      expect(row).toBeDefined();
    } finally {
      server.close();
    }
  });

  // -------------------------------------------------------------------------
  // G2: den avbrutna-nedladdning-testet ovan (F2) visade sig sakna verkliga
  // tänder — arkivets `finalize()` beror på arkiverarens EGNA interna modul
  // ('_module' i archiver/lib/core.js), inte på om HTTP-destinationen (`res`)
  // faktiskt tog emot bytes. En avbruten socket får därför `finalize()` att
  // fortfarande lyckas (den lilla test-databasen hinner strömmas/köas innan
  // avbrottet slår igenom) — testet ovan bevisar alltså inget om ORDNINGEN
  // mellan logAudit och finalize(), bara att en rad finns (vilket den redan
  // gjorde från ett tidigare test i samma describe, se G2 i fyndrapporten).
  //
  // Detta test bevisar ordningen direkt och deterministiskt: mocka
  // ZipArchive.prototype.finalize (samma klass-referens som backup.ts's
  // `new ZipArchive(...)` använder — samma modul-cache) till att kasta
  // OMEDELBART, utan någon nätverksrace. Om logAudit körs FÖRE finalize()
  // (den avsedda ordningen) skrivs audit-raden ändå, trots att hela
  // arkiveringen sedan misslyckas. Om logAudit istället låg EFTER
  // `await archive.finalize()` (den ursprungliga F2-buggen) skulle undantaget
  // hoppa förbi logAudit-anropet helt — ingen rad skulle skrivas. Detta test
  // FALLERAR om buggen återinförs (bevisat i rapporten: temporär flytt av
  // logAudit-anropet + full körning av filen).
  // -------------------------------------------------------------------------
  it('audit-raden är redan skriven innan finalize() ens anropas — överlever ett fel i arkiveringen (G2)', async () => {
    const before = (
      db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE action = 'backup_download'").get() as { count: number }
    ).count;

    const finalizeSpy = vi
      .spyOn(ZipArchive.prototype, 'finalize')
      .mockImplementation(() => Promise.reject(new Error('simulated finalize failure (G2 test)')));

    try {
      const res = await adminAgent
        .get('/api/backup')
        .set('Authorization', `Bearer ${adminToken}`);
      // finalize() kastar innan några headers hunnit skickas → ytterkatchen
      // i backup.ts svarar 500.
      expect(res.status).toBe(500);
    } finally {
      finalizeSpy.mockRestore();
    }

    const after = (
      db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE action = 'backup_download'").get() as { count: number }
    ).count;
    // Trots att hela arkiveringen misslyckades skrevs audit-raden — den låg
    // FÖRE finalize()-anropet, inte efter.
    expect(after).toBe(before + 1);
  });

  // -------------------------------------------------------------------------
  // Fynd F4: ände-till-ände-bevis för attributionen (migration 066). Kedjan är
  // enhetstestad i båda ändar (auth.ts sätter req.apiKey.id, logAudit skriver
  // kolumnen) men inget test bevisade tidigare att en riktig API-nyckel-
  // autentiserad admin-åtgärd faktiskt landar med RÄTT nyckels id (inte NULL).
  // -------------------------------------------------------------------------
  it('attribuerar audit-raden till den faktiska API-nyckelns id, inte NULL (F4)', async () => {
    const rawKey = `itk_live_${randomBytes(16).toString('hex')}`;
    const keyPrefix = rawKey.substring('itk_live_'.length, 'itk_live_'.length + 8);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyId = randomUUID();

    db.prepare(
      `INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(keyId, 'F4-test-nyckel', keyPrefix, keyHash, adminId, JSON.stringify(['read', 'admin']));

    const res = await request(app)
      .get('/api/backup')
      .set('Authorization', `Bearer ${rawKey}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);

    const row = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'backup_download' AND api_key_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
    ).get(keyId) as { api_key_id: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.api_key_id).toBe(keyId);
    expect(row!.api_key_id).not.toBeNull();
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
    // A valid ZIP with an allowlisted entry (data/uploads/*) but no
    // data/database.sqlite, so it passes the entry allowlist and then hits
    // the missing-database check.
    const emptyZip = await buildZipBuffer([
      { name: 'data/uploads/keep.txt', content: 'hello' },
    ]);

    const res = await adminAgent
      .post('/api/backup/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .attach('file', emptyZip, { filename: 'backup.zip', contentType: 'application/zip' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/database\.sqlite/i);
  });

  it('returns 400 when the ZIP contains a zip-slip entry (../ path)', async () => {
    // archiver normalises paths (strips `../`), so we build raw ZIP bytes that
    // preserve the traversal path verbatim. buildRawZipSlip() writes a minimal
    // valid ZIP with a single stored entry whose filename starts with `../`.
    // unzipper passes that path directly to the backup.ts `entry.path` check,
    // which triggers the zip-slip guard. Post audit-v3 the guard tags this as a
    // validationError, so the outer catch returns 400 (client error) rather
    // than 500 — a malicious/invalid ZIP is a bad request, not a server fault.
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

    // The zip-slip guard rejects with a validationError → outer catch → 400.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oväntade eller osäkra/i);
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

// ---------------------------------------------------------------------------
// GET /api/backup/config — schemainställningar
// ---------------------------------------------------------------------------

describe('GET /api/backup/config', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/backup/config');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await userAgent
      .get('/api/backup/config')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 with the config shape for an admin', async () => {
    const res = await adminAgent
      .get('/api/backup/config')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.enabled).toBe('boolean');
    expect(res.body.time).toMatch(/^\d{2}:\d{2}$/);
    expect(typeof res.body.retentionDays).toBe('number');
    expect(res.body).toHaveProperty('lastRunAt');
    expect(res.body).toHaveProperty('lastStatus');
    expect(res.body).toHaveProperty('nextRunAt');
  });

  it('exposes failure counters for the admin UI (M13)', async () => {
    const res = await adminAgent
      .get('/api/backup/config')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.consecutiveFailures).toBe('number');
    expect(typeof res.body.offsiteFailureCount).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// PUT /api/backup/config
// ---------------------------------------------------------------------------

describe('PUT /api/backup/config', () => {
  it('returns 403 for a non-admin user', async () => {
    const csrfRes = await userAgent.get('/api/csrf-token').set('Authorization', `Bearer ${userToken}`);
    const userCsrf: string = csrfRes.body.csrfToken;
    const res = await userAgent
      .put('/api/backup/config')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ enabled: true, time: '03:00', retentionDays: 7 });
    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid time', async () => {
    const res = await adminAgent
      .put('/api/backup/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ enabled: true, time: '25:00', retentionDays: 7 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid retentionDays', async () => {
    const res = await adminAgent
      .put('/api/backup/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ enabled: true, time: '03:00', retentionDays: 0 });
    expect(res.status).toBe(400);
  });

  it('persists a valid config and reflects it on GET', async () => {
    const put = await adminAgent
      .put('/api/backup/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ enabled: false, time: '02:30', retentionDays: 14 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ enabled: false, time: '02:30', retentionDays: 14 });

    const get = await adminAgent
      .get('/api/backup/config')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(get.body).toMatchObject({ enabled: false, time: '02:30', retentionDays: 14 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/backup/run-now
// ---------------------------------------------------------------------------

describe('POST /api/backup/run-now', () => {
  it('returns 401 or 403 when no token is provided', async () => {
    const res = await request(app).post('/api/backup/run-now');
    expect([401, 403]).toContain(res.status);
  });

  it('returns 403 for a non-admin user', async () => {
    const csrfRes = await userAgent.get('/api/csrf-token').set('Authorization', `Bearer ${userToken}`);
    const userCsrf: string = csrfRes.body.csrfToken;
    const res = await userAgent
      .post('/api/backup/run-now')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf);
    expect(res.status).toBe(403);
  });

  it('runs a backup and returns 200 with success status for an admin', async () => {
    const res = await adminAgent
      .post('/api/backup/run-now')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.lastSizeBytes).toBeGreaterThan(0);

    const row = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'backup_run_now' ORDER BY created_at DESC, rowid DESC LIMIT 1"
    ).get() as { api_key_id: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.api_key_id).toBeNull();
  });

  it('rejects a concurrent run-now with 409 (in-flight guard)', async () => {
    const fire = () =>
      adminAgent
        .post('/api/backup/run-now')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-csrf-token', adminCsrfToken);
    const [a, b] = await Promise.all([fire(), fire()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

// ---------------------------------------------------------------------------
// performRestoreSwap — fynd M14: den lyckade restore-vägen kunde aldrig testas
// via routen (process.exit(0)); swap-logiken testas därför direkt här.
// ---------------------------------------------------------------------------

describe('performRestoreSwap (M14)', () => {
  // Temp-miljö som speglar restore-läget: live-DB med -wal/-shm-sidofiler,
  // extraherad backup-DB + uploads, och en dest-uploads med gammalt innehåll.
  const setup = () => {
    const dir = mkdtempSync(join(osTmpdir(), 'restore-swap-'));

    const dbPath = join(dir, 'live', 'database.sqlite');
    mkdirSync(dirname(dbPath), { recursive: true });
    writeFileSync(dbPath, 'OLD DB CONTENT');
    writeFileSync(`${dbPath}-wal`, 'wal');
    writeFileSync(`${dbPath}-shm`, 'shm');

    const restoredDbPath = join(dir, 'extracted', 'data', 'database.sqlite');
    mkdirSync(dirname(restoredDbPath), { recursive: true });
    writeFileSync(restoredDbPath, 'NEW DB CONTENT');

    const uploadsSrc = join(dir, 'extracted', 'data', 'uploads');
    mkdirSync(uploadsSrc, { recursive: true });
    writeFileSync(join(uploadsSrc, 'restored.txt'), 'from backup');

    const uploadsDest = join(dir, 'live', 'uploads');
    mkdirSync(uploadsDest, { recursive: true });
    writeFileSync(join(uploadsDest, 'stale.txt'), 'should be removed');

    return { dir, dbPath, restoredDbPath, uploadsSrc, uploadsDest };
  };

  it('swaps the DB file, deletes sidecars, mirrors uploads and removes the rollback copy', () => {
    const { dir, dbPath, restoredDbPath, uploadsSrc, uploadsDest } = setup();
    const closeDb = vi.fn();

    performRestoreSwap({ restoredDbPath, dbPath, uploadsSrc, uploadsDest, closeDb });

    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(readFileSync(dbPath, 'utf8')).toBe('NEW DB CONTENT');
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
    // uploads speglar backupen exakt: nytt innehåll in, gammalt bort.
    expect(readFileSync(join(uploadsDest, 'restored.txt'), 'utf8')).toBe('from backup');
    expect(existsSync(join(uploadsDest, 'stale.txt'))).toBe(false);
    // rollback-kopian städad efter lyckad swap.
    expect(existsSync(`${dbPath}.pre-restore`)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves uploadsDest untouched when the backup contains no uploads directory', () => {
    const { dir, dbPath, restoredDbPath, uploadsSrc, uploadsDest } = setup();
    rmSync(uploadsSrc, { recursive: true, force: true });

    performRestoreSwap({ restoredDbPath, dbPath, uploadsSrc, uploadsDest });

    expect(readFileSync(dbPath, 'utf8')).toBe('NEW DB CONTENT');
    expect(readFileSync(join(uploadsDest, 'stale.txt'), 'utf8')).toBe('should be removed');

    rmSync(dir, { recursive: true, force: true });
  });

  it('rolls back the DB file and rethrows when closeDb throws', () => {
    const { dir, dbPath, restoredDbPath, uploadsSrc, uploadsDest } = setup();

    expect(() =>
      performRestoreSwap({
        restoredDbPath,
        dbPath,
        uploadsSrc,
        uploadsDest,
        closeDb: () => {
          throw new Error('checkpoint failed');
        },
      }),
    ).toThrow('checkpoint failed');

    // Pre-restore-kopian har rullat tillbaka DB-filen; uploads orörda.
    expect(readFileSync(dbPath, 'utf8')).toBe('OLD DB CONTENT');
    expect(readFileSync(join(uploadsDest, 'stale.txt'), 'utf8')).toBe('should be removed');

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Fynd F1: logRestoreAudit — direkt anslutningstest mot en riktig sqlite-fil
// (ingen mockning), oberoende av den delade `db`-singleton/app-uppstarten.
// Bevisar dels normalfallet, dels fallbacken för en backup äldre än migration
// 066 (audit_log utan api_key_id-kolumnen) — utan att behöva köra hela HTTP-
// routen två gånger (den stänger den delade `db`-anslutningen permanent efter
// första lyckade restore, se M14-happy-path-kommentaren nedan).
// ---------------------------------------------------------------------------
describe('logRestoreAudit (F1)', () => {
  it('skriver backup_restore-raden i den angivna databasfilen, med api_key_id satt', async () => {
    const dir = mkdtempSync(join(osTmpdir(), 'restore-audit-'));
    const dbPath = join(dir, 'restored.sqlite');

    const Database = (await import('better-sqlite3')).default;
    const seedDb = new Database(dbPath);
    seedDb.exec(`
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        api_key_id TEXT
      );
    `);
    seedDb.close();

    const userId = randomUUID();
    const apiKeyId = randomUUID();
    await logRestoreAudit(dbPath, userId, '203.0.113.7', apiKeyId);

    const verifyDb = new Database(dbPath, { readonly: true });
    try {
      const row = verifyDb
        .prepare("SELECT * FROM audit_log WHERE action = 'backup_restore'")
        .get() as { user_id: string; ip_address: string; api_key_id: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.user_id).toBe(userId);
      expect(row!.ip_address).toBe('203.0.113.7');
      expect(row!.api_key_id).toBe(apiKeyId);
    } finally {
      verifyDb.close();
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('faller tillbaka till INSERT utan api_key_id när kolumnen saknas (pre-066-backup) — raden går inte förlorad', async () => {
    const dir = mkdtempSync(join(osTmpdir(), 'restore-audit-legacy-'));
    const dbPath = join(dir, 'restored-legacy.sqlite');

    const Database = (await import('better-sqlite3')).default;
    const seedDb = new Database(dbPath);
    // Migration 051-formen, INNAN migration 066 lade till api_key_id.
    seedDb.exec(`
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    seedDb.close();

    const userId = randomUUID();
    // Ska INTE kasta trots att kolumnen saknas i den återställda (gamla) filen.
    await expect(logRestoreAudit(dbPath, userId, '198.51.100.9', randomUUID())).resolves.toBeUndefined();

    const verifyDb = new Database(dbPath, { readonly: true });
    try {
      const row = verifyDb
        .prepare("SELECT * FROM audit_log WHERE action = 'backup_restore'")
        .get() as { user_id: string; ip_address: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.user_id).toBe(userId);
      expect(row!.ip_address).toBe('198.51.100.9');
    } finally {
      verifyDb.close();
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('kastar aldrig, även om databasfilen inte går att öppna (t.ex. saknas)', async () => {
    const bogusPath = join(osTmpdir(), `does-not-exist-${randomUUID()}`, 'nope.sqlite');
    await expect(
      logRestoreAudit(bogusPath, randomUUID(), '127.0.0.1', null)
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/backup/restore — successful restore path (M14 happy path)
//
// MUST run last: a successful restore closes the shared `db` handle (via the
// route's closeDb callback → wal_checkpoint + closeDatabase) and overwrites
// DB_PATH + UPLOAD_DIR with the uploaded backup's content. Any test after this
// one that touches `db` or the app's DB-backed routes would fail with
// "database connection is not open". Vitest runs tests within a file
// sequentially in declaration order (no `sequence.shuffle` / `.concurrent` is
// configured here or in vitest.config.ts), so appending this block at the very
// end of the file is sufficient to guarantee it runs after every other test in
// this file. Other test files are unaffected: each file sets its own
// per-process DB_PATH/UPLOAD_DIR via vi.hoisted() and vitest isolates module
// state per test file, so there is no cross-file `db` singleton to corrupt.
// ---------------------------------------------------------------------------

describe('POST /api/backup/restore — successful restore path (M14 happy path)', () => {
  it('extracts the ZIP, validates the DB, swaps DB_PATH + UPLOAD_DIR, cleans up the rollback file, returns 200, and schedules process.exit(0)', async () => {
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    try {
      // Prove uploads are truly *mirrored* (old content removed), not just
      // appended to — same invariant the performRestoreSwap unit tests assert.
      const staleUploadPath = join(UPLOAD_DIR, 'stale-before-restore.txt');
      mkdirSync(UPLOAD_DIR, { recursive: true });
      writeFileSync(staleUploadPath, 'this must vanish after restore');

      const marker = `RESTORE-MARKER-${randomUUID()}`;
      const uploadFileName = 'marker.txt';
      const uploadContent = `restored-upload-${randomUUID()}`;
      const zipBuffer = await buildValidBackupZip(marker, uploadFileName, uploadContent);

      const res = await adminAgent
        .post('/api/backup/restore')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-csrf-token', adminCsrfToken)
        .attach('file', zipBuffer, { filename: 'backup.zip', contentType: 'application/zip' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, restartRequired: true });

      // Rollback-kopian (${DB_PATH}.pre-restore) är borttagen efter lyckad restore.
      expect(existsSync(`${DB_PATH}.pre-restore`)).toBe(false);

      // DB_PATH har faktiskt bytts ut mot backupens innehåll — inte bara "en
      // giltig databas", utan just VÅR databas (unik markörrad). Öppnar en
      // FRISK anslutning eftersom routen redan stängt det delade `db`-handtaget.
      const Database = (await import('better-sqlite3')).default;
      const restoredDb = new Database(DB_PATH, { readonly: true });
      try {
        const tables = restoredDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as { name: string }[];
        const tableNames = new Set(tables.map((t) => t.name));
        expect(tableNames.has('tickets')).toBe(true);
        expect(tableNames.has('users')).toBe(true);

        const row = restoredDb
          .prepare('SELECT marker FROM __restore_marker LIMIT 1')
          .get() as { marker: string } | undefined;
        expect(row?.marker).toBe(marker);

        // Fynd F1: audit-raden för 'backup_restore' måste hamna i DEN HÄR
        // (återställda) databasfilen — inte i den redan stängda, gamla `db`-
        // anslutningen (som skulle kastat tyst) och inte i den gamla filen som
        // just ersattes. Bevisar den fulla routen (inte bara logRestoreAudit
        // direkt) — se de riktade enhetstesterna för logRestoreAudit nedan för
        // pre-066-fallbacken.
        const auditRow = restoredDb
          .prepare("SELECT * FROM audit_log WHERE action = 'backup_restore' ORDER BY created_at DESC, rowid DESC LIMIT 1")
          .get() as { user_id: string | null; api_key_id: string | null } | undefined;
        expect(auditRow).toBeDefined();
        expect(auditRow!.user_id).toBe(adminId);
        expect(auditRow!.api_key_id).toBeNull(); // sessionsinloggning, ingen API-nyckel
      } finally {
        restoredDb.close();
      }

      // UPLOAD_DIR speglar backupen: nytt innehåll finns, gammalt är borta.
      expect(readFileSync(join(UPLOAD_DIR, uploadFileName), 'utf8')).toBe(uploadContent);
      expect(existsSync(staleUploadPath)).toBe(false);

      // process.exit(0) är schemalagt via setTimeout(…, 1500) EFTER res.json() —
      // supertest har redan fått sitt svar (ovan), så vi väntar bara in den
      // riktiga timern (mockad process.exit förhindrar att vitest-processen dör).
      await new Promise((resolve) => setTimeout(resolve, 1700));
      expect(processExitSpy).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenCalledWith(0);
    } finally {
      processExitSpy.mockRestore();
    }
  }, 10_000);
});
