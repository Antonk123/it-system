import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'crypto';
import RawDatabase from 'better-sqlite3';

/**
 * IDOR authorization test for GET /api/shares/ticket/:ticketId, plus (from
 * the expires_at hardening pass) expiry validation, fail-closed public-route
 * expiry enforcement, and audit-log coverage for share_create/share_delete.
 *
 * UNIQUE DB_PATH suffix (-shares) so parallel suites don't collide.
 */

const { DB_PATH, UPLOAD_DIR } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-shares.sqlite`);
  const uploadDir = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-shares-uploads`);
  process.env.DB_PATH = dbPath;
  process.env.UPLOAD_DIR = uploadDir;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-shares-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-shares-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath, UPLOAD_DIR: uploadDir };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';
import { migrations } from '../db/migrations.js';

// Converts a SQLite `datetime('now', ...)` string ("YYYY-MM-DD HH:MM:SS", UTC,
// no offset marker) to epoch ms. Comparing raw strings works for ordering but
// not for window-math, so tests need this to compute now±Nd.
function sqliteDateToMs(s: string): number {
  return new Date(s.replace(' ', 'T') + 'Z').getTime();
}

let app: ReturnType<typeof createApp>;

let adminToken: string;
let ownerToken: string;
let strangerToken: string;

let adminId: string;
let ownerId: string;
let strangerId: string;

let ticketId: string;

// Persistent cookie-jar agent + matching CSRF token for the owner, used by
// every POST/DELETE test below — the plain `ownerToken` above is a bare JWT
// with no cookie jar, so it can't carry the CSRF double-submit cookie that
// app.ts requires for mutating requests (GET is CSRF-exempt by default,
// which is why the pre-existing IDOR tests above never needed this).
let ownerAgent: ReturnType<typeof request.agent>;
let ownerCsrf: string;

async function loginToken(email: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  const token = login.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  return { agent, token, csrf: csrfRes.body.csrfToken as string };
}

beforeAll(async () => {
  initializeDatabase();
  mkdirSync(UPLOAD_DIR, { recursive: true });

  adminId = randomUUID();
  ownerId = randomUUID();
  strangerId = randomUUID();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const ownerHash = await bcrypt.hash('Owner-P@ss1234!', 10);
  const strangerHash = await bcrypt.hash('Stranger-P@ss1234!', 10);

  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(adminId, 'admin@sharestest.local', adminHash, 'admin', 'Shares Admin');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(ownerId, 'owner@sharestest.local', ownerHash, 'user', 'Shares Owner');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(strangerId, 'stranger@sharestest.local', strangerHash, 'user', 'Shares Stranger');

  ticketId = randomUUID();
  db.prepare(`INSERT INTO tickets (id, title, description, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(ticketId, 'Shares Test Ticket', 'owner ticket', 'open', null, ownerId);

  app = createApp();

  adminToken = await loginToken('admin@sharestest.local', 'Admin-P@ss1234!');
  ownerToken = await loginToken('owner@sharestest.local', 'Owner-P@ss1234!');
  strangerToken = await loginToken('stranger@sharestest.local', 'Stranger-P@ss1234!');

  ({ agent: ownerAgent, csrf: ownerCsrf } = await loginAgent('owner@sharestest.local', 'Owner-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
  try { rmSync(UPLOAD_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('GET /api/shares/ticket/:ticketId — authorization', () => {
  it('returns 200 for the ticket owner (created_by)', async () => {
    const res = await request(app)
      .get(`/api/shares/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
  });

  it('returns 200 for an admin', async () => {
    const res = await request(app)
      .get(`/api/shares/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('returns 403 for a logged-in stranger (no relationship to the ticket)', async () => {
    const res = await request(app)
      .get(`/api/shares/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app).get(`/api/shares/ticket/${ticketId}`);
    expect(res.status).toBe(401);
  });
});

function insertTicket(ownerIdForTicket: string, title = 'Expiry Test Ticket'): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO tickets (id, title, description, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, title, 'expiry test', 'open', null, ownerIdForTicket);
  return id;
}

describe('POST /api/shares/ticket/:ticketId — expiresInDays validation and default expiry', () => {
  it('defaults to ~30 days when expiresInDays is omitted', async () => {
    const tid = insertTicket(ownerId);
    const before = Date.now();
    const res = await ownerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.share_token).toBeTruthy();
    const expiresMs = sqliteDateToMs(res.body.expires_at);
    expect(expiresMs).toBeGreaterThan(before + 29 * 24 * 3600 * 1000);
    expect(expiresMs).toBeLessThan(before + 31 * 24 * 3600 * 1000);
  });

  it('accepts expiresInDays: 7 and returns an expiry ~7 days out', async () => {
    const tid = insertTicket(ownerId);
    const before = Date.now();
    const res = await ownerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({ expiresInDays: 7 });
    expect(res.status).toBe(201);
    const expiresMs = sqliteDateToMs(res.body.expires_at);
    expect(expiresMs).toBeGreaterThan(before + 6 * 24 * 3600 * 1000);
    expect(expiresMs).toBeLessThan(before + 8 * 24 * 3600 * 1000);
  });

  it.each([0, 366, 'abc'])('rejects expiresInDays=%p with 400 and the contracted message', async (value) => {
    const tid = insertTicket(ownerId);
    const res = await ownerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({ expiresInDays: value });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('expiresInDays must be an integer between 1 and 365');
  });
});

describe('GET /api/shares/public/:token — fail-closed expiry enforcement', () => {
  it('valid token → 200 with share_expires_at; SAME token after expiry → 404 identical to an invalid token', async () => {
    const tid = insertTicket(ownerId, 'Public View Expiry Ticket');
    const createRes = await ownerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({});
    expect(createRes.status).toBe(201);
    const token = createRes.body.share_token as string;

    const okRes = await request(app).get(`/api/shares/public/${token}`);
    expect(okRes.status).toBe(200);
    expect(okRes.body.share_expires_at).toBeTruthy();

    // Reference: an outright invalid token's 404 body — the pair proves no oracle.
    const invalidRes = await request(app).get('/api/shares/public/this-token-does-not-exist');
    expect(invalidRes.status).toBe(404);

    db.prepare("UPDATE ticket_shares SET expires_at = datetime('now', '-1 day') WHERE share_token = ?").run(token);

    const expiredRes = await request(app).get(`/api/shares/public/${token}`);
    expect(expiredRes.status).toBe(404);
    expect(expiredRes.body).toEqual(invalidRes.body);
  });

  it('a legacy row with expires_at IS NULL is treated as expired (fail-closed)', async () => {
    const tid = insertTicket(ownerId, 'Legacy NULL Expiry Ticket');
    const id = randomUUID();
    const token = randomBytes(16).toString('hex');
    db.prepare(
      `INSERT INTO ticket_shares (id, ticket_id, share_token, created_by, expires_at) VALUES (?, ?, ?, ?, NULL)`
    ).run(id, tid, token, ownerId);

    const res = await request(app).get(`/api/shares/public/${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/shares/public/file/:token/:attachmentId — fail-closed expiry enforcement', () => {
  it('valid token → 200; SAME token after expiry → 404', async () => {
    const tid = insertTicket(ownerId, 'File Route Expiry Ticket');
    const createRes = await ownerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({});
    expect(createRes.status).toBe(201);
    const token = createRes.body.share_token as string;

    const attachmentId = randomUUID();
    const fileName = `expiry-test-${attachmentId}.txt`;
    writeFileSync(join(UPLOAD_DIR, fileName), 'hello');
    db.prepare(
      `INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(attachmentId, tid, fileName, fileName, 'text/plain', 5);

    const okRes = await request(app).get(`/api/shares/public/file/${token}/${attachmentId}`);
    expect(okRes.status).toBe(200);

    db.prepare("UPDATE ticket_shares SET expires_at = datetime('now', '-1 day') WHERE share_token = ?").run(token);

    const expiredRes = await request(app).get(`/api/shares/public/file/${token}/${attachmentId}`);
    expect(expiredRes.status).toBe(404);
  });
});

describe('GET /ticket/:ticketId + POST — expired share is invisible, POST mints a fresh one', () => {
  it('GET reports null for an expired share; a subsequent POST mints a NEW token with a fresh expiry', async () => {
    const tid = insertTicket(ownerId, 'Reissue Ticket');
    const createRes = await ownerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({});
    expect(createRes.status).toBe(201);
    const oldToken = createRes.body.share_token as string;

    db.prepare("UPDATE ticket_shares SET expires_at = datetime('now', '-1 day') WHERE share_token = ?").run(oldToken);

    const getRes = await request(app)
      .get(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.share_token).toBeNull();
    expect(getRes.body.expires_at).toBeNull();

    const before = Date.now();
    const reissueRes = await ownerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({});
    expect(reissueRes.status).toBe(201);
    expect(reissueRes.body.share_token).not.toBe(oldToken);
    const expiresMs = sqliteDateToMs(reissueRes.body.expires_at);
    expect(expiresMs).toBeGreaterThan(before + 29 * 24 * 3600 * 1000);

    // Only one row should remain for this ticket — the expired one was deleted.
    const rowCount = (
      db.prepare('SELECT COUNT(*) AS n FROM ticket_shares WHERE ticket_id = ?').get(tid) as { n: number }
    ).n;
    expect(rowCount).toBe(1);
  });
});

describe('POST /api/shares/ticket/:ticketId — authorization precedes the idempotent return', () => {
  it('a logged-in stranger gets 403 and NO token, even when an active share already exists', async () => {
    const tid = insertTicket(ownerId, 'IDOR Idempotent Return Ticket');
    const createRes = await ownerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({});
    expect(createRes.status).toBe(201);

    const { agent: strangerAgent, token: strangerBearar, csrf: strangerCsrf } =
      await loginAgent('stranger@sharestest.local', 'Stranger-P@ss1234!');
    const res = await strangerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${strangerBearar}`)
      .set('x-csrf-token', strangerCsrf)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.share_token).toBeUndefined();
  });

  // Sharpest instance of the isEffectiveAdmin bug class: canAccessTicket()
  // used to take a bare `{id, role}` and short-circuit true for role==='admin'
  // regardless of the authenticating API key's own scope. A key scoped only
  // ['write'] (no 'admin'), bound to an admin who has no relation to the
  // ticket, could mint an UNAUTHENTICATED public share token for it — worse
  // than the 8 inline-check sites fixed alongside this, since the payoff here
  // is a standing public credential, not just a one-off action.
  it('an admin-owner API key WITHOUT admin scope cannot mint a share for a ticket it has no relation to (403)', async () => {
    const tid = insertTicket(ownerId, 'Scoped-Key Escalation Ticket');

    const rawKey = `itk_live_${randomBytes(16).toString('hex')}`;
    const keyPrefix = rawKey.substring('itk_live_'.length, 'itk_live_'.length + 8);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    db.prepare(
      `INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), 'scoped-test-key', keyPrefix, keyHash, adminId, JSON.stringify(['read', 'write']));

    const res = await request(app)
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${rawKey}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.share_token).toBeUndefined();
  });
});

describe('migration 067 — add_ticket_shares_expires_at, run directly against a fresh test DB', () => {
  it('adds expires_at and backfills a NULL row with a future expiry', () => {
    const migration067 = migrations.find((m) => m.id === '067');
    expect(migration067).toBeDefined();

    const rawDb = new RawDatabase(':memory:');
    rawDb.exec(`
      CREATE TABLE ticket_shares (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        share_token TEXT UNIQUE NOT NULL,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    rawDb.prepare(
      `INSERT INTO ticket_shares (id, ticket_id, share_token, created_by) VALUES (?, ?, ?, NULL)`
    ).run(randomUUID(), randomUUID(), randomBytes(16).toString('hex'));

    const tableExists = (name: string) =>
      !!rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
    const columnExists = (tableName: string, columnName: string) => {
      if (!tableExists(tableName)) return false;
      const columns = rawDb.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
      return columns.some((c) => c.name === columnName);
    };

    migration067!.up(rawDb, { tableExists, columnExists });

    const row = rawDb.prepare('SELECT expires_at FROM ticket_shares').get() as { expires_at: string | null };
    expect(row.expires_at).not.toBeNull();
    expect(sqliteDateToMs(row.expires_at as string)).toBeGreaterThan(Date.now());

    rawDb.close();
  });
});

describe('Audit logging — share_create / share_delete', () => {
  const countAudit = (action: string) =>
    (db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action) as { n: number }).n;

  it('POST creates exactly +1 audit_log row with action share_create, correct entity/details', async () => {
    const tid = insertTicket(ownerId, 'Audit Create Ticket');
    const before = countAudit('share_create');

    const res = await ownerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({});
    expect(res.status).toBe(201);

    const after = countAudit('share_create');
    expect(after).toBe(before + 1);

    const row = db.prepare(
      "SELECT * FROM audit_log WHERE action = 'share_create' AND entity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
    ).get(tid) as { user_id: string; entity_type: string; details: string | null; api_key_id: string | null };
    expect(row.user_id).toBe(ownerId);
    expect(row.entity_type).toBe('ticket_share');
    expect(row.details).toContain(tid);
    expect(row.details).toContain(res.body.expires_at);
    expect(row.api_key_id).toBeNull();
  });

  it('DELETE creates exactly +1 audit_log row with action share_delete', async () => {
    const tid = insertTicket(ownerId, 'Audit Delete Ticket');
    await ownerAgent
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf)
      .send({});

    const before = countAudit('share_delete');

    const res = await ownerAgent
      .delete(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-csrf-token', ownerCsrf);
    expect(res.status).toBe(200);

    const after = countAudit('share_delete');
    expect(after).toBe(before + 1);
  });

  it('a share created via an API key attributes the audit row to that key (api_key_id set, not NULL)', async () => {
    const tid = insertTicket(ownerId, 'Audit API Key Ticket');

    const rawKey = `itk_live_${randomBytes(16).toString('hex')}`;
    const keyPrefix = rawKey.substring('itk_live_'.length, 'itk_live_'.length + 8);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyId = randomUUID();
    db.prepare(
      `INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(keyId, 'shares-test-key', keyPrefix, keyHash, ownerId, JSON.stringify(['read', 'write']));

    const res = await request(app)
      .post(`/api/shares/ticket/${tid}`)
      .set('Authorization', `Bearer ${rawKey}`)
      .send({});
    expect(res.status).toBe(201);

    const row = db.prepare(
      "SELECT api_key_id FROM audit_log WHERE action = 'share_create' AND entity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
    ).get(tid) as { api_key_id: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.api_key_id).toBe(keyId);
    expect(row!.api_key_id).not.toBeNull();
  });
});
