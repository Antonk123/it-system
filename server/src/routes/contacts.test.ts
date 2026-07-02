import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for the contacts routes.
 *
 * Regression focus: PUT /api/contacts/:id must persist edits. A regression
 * (audit-v2) added `safeUpdates.updated_at = ...` but the contacts table has
 * no updated_at column → every edit threw SqliteError → HTTP 500.
 *
 * Audit fixes covered here:
 *  - H2: POST /import/preview and /import/confirm must require admin (they
 *    bulk-insert contacts + auto-create companies, same as POST /, which
 *    already has requireAdmin).
 *  - M10-contacts: a non-CSV upload to /import/preview must hit multer's
 *    fileFilter and return 400 (not fall through to the central 500 handler).
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-contacts-test-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-contacts-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-contacts-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;
let adminAgent: ReturnType<typeof request.agent>;
let adminToken: string;
let adminCsrf: string;
let contactId: string;

let userAgent: ReturnType<typeof request.agent>;
let userToken: string;
let userCsrf: string;

beforeAll(async () => {
  initializeDatabase();

  const adminId = randomUUID();
  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(adminId, 'admin@contactstest.local', adminHash, 'admin', 'Contacts Admin');

  const userId = randomUUID();
  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, 'user@contactstest.local', userHash, 'user', 'Contacts User');

  contactId = randomUUID();
  db.prepare(`INSERT INTO contacts (id, name, email, phone) VALUES (?, ?, ?, ?)`)
    .run(contactId, 'Gammalt Namn', 'old@contactstest.local', '070-0000000');

  app = createApp();
  adminAgent = request.agent(app);
  const login = await adminAgent.post('/api/auth/login').send({ email: 'admin@contactstest.local', password: 'Admin-P@ss1234!' });
  expect(login.status).toBe(200);
  adminToken = login.body.accessToken;
  const csrf = await adminAgent.get('/api/csrf-token').set('Authorization', `Bearer ${adminToken}`);
  adminCsrf = csrf.body.csrfToken;

  userAgent = request.agent(app);
  const userLogin = await userAgent.post('/api/auth/login').send({ email: 'user@contactstest.local', password: 'User-P@ss1234!' });
  expect(userLogin.status).toBe(200);
  userToken = userLogin.body.accessToken;
  const userCsrfRes = await userAgent.get('/api/csrf-token').set('Authorization', `Bearer ${userToken}`);
  userCsrf = userCsrfRes.body.csrfToken;
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('PUT /api/contacts/:id', () => {
  it('persists a name edit (200, not 500)', async () => {
    const res = await adminAgent.put(`/api/contacts/${contactId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ name: 'Nytt Namn' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Nytt Namn');
    const row = db.prepare('SELECT name FROM contacts WHERE id = ?').get(contactId) as { name: string };
    expect(row.name).toBe('Nytt Namn');
  });

  it('updates phone + department together', async () => {
    const res = await adminAgent.put(`/api/contacts/${contactId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ phone: '073-1112222', department: 'IT' });

    expect(res.status).toBe(200);
    const row = db.prepare('SELECT phone, department FROM contacts WHERE id = ?').get(contactId) as { phone: string; department: string };
    expect(row.phone).toBe('073-1112222');
    expect(row.department).toBe('IT');
  });
});

describe('POST /api/contacts/import/preview and /import/confirm (admin-only)', () => {
  it('rejects a non-admin on POST /import/confirm → 403', async () => {
    const res = await userAgent.post('/api/contacts/import/confirm')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ contacts: [{ name: 'Should Not Insert', email: 'blocked@contactstest.local' }] });

    expect(res.status).toBe(403);
    const row = db.prepare('SELECT id FROM contacts WHERE email = ?').get('blocked@contactstest.local');
    expect(row).toBeUndefined();
  });

  it('rejects a non-admin on POST /import/preview → 403', async () => {
    const res = await userAgent.post('/api/contacts/import/preview')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .attach('file', Buffer.from('Namn,Email\nKalle,kalle@contactstest.local'), { filename: 'contacts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(403);
  });

  it('lets an admin import valid contacts via POST /import/confirm → 200', async () => {
    const email = `imported-${randomUUID()}@contactstest.local`;
    const res = await adminAgent.post('/api/contacts/import/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .send({ contacts: [{ name: 'Ny Kontakt', email }] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(1);
    const row = db.prepare('SELECT name FROM contacts WHERE email = ?').get(email) as { name: string } | undefined;
    expect(row?.name).toBe('Ny Kontakt');
  });

  it('rejects a non-CSV file on POST /import/preview → 400, not 500 (multer fileFilter error)', async () => {
    const res = await adminAgent.post('/api/contacts/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrf)
      .attach('file', Buffer.from('not a csv, just plain text'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
