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

describe('contact validation, uniqueness and audit (POST/PUT/DELETE)', () => {
  const post = (body: unknown) => adminAgent.post('/api/contacts')
    .set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrf).send(body as object);
  const put = (id: string, body: unknown) => adminAgent.put(`/api/contacts/${id}`)
    .set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrf).send(body as object);

  it('POST rejects missing name/email, bad email, over-long fields and non-strings (400)', async () => {
    expect((await post({ email: 'a@b.se' })).status).toBe(400);
    expect((await post({ name: 'X' })).status).toBe(400);
    expect((await post({ name: 'X', email: 'not-an-email' })).status).toBe(400);
    expect((await post({ name: 'X', email: '<script>@b.se' })).status).toBe(400);
    expect((await post({ name: 'x'.repeat(201), email: 'long@b.se' })).status).toBe(400);
    expect((await post({ name: 'X', email: `${'a'.repeat(250)}@b.se` })).status).toBe(400);
    expect((await post({ name: 'X', email: 'ph@b.se', phone: '1'.repeat(51) })).status).toBe(400);
    expect((await post({ name: { a: 1 }, email: 'obj@b.se' })).status).toBe(400);
    expect((await post({ name: 'X', email: 'co@b.se', company_id: randomUUID() })).status).toBe(400);
  });

  it('POST strips HTML from name/phone/department and trims', async () => {
    const res = await post({ name: '  <b>Anna</b> ', email: ' anna@validation.test ', phone: '<i>070</i>', department: '<u>IT</u>' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Anna');
    expect(res.body.email).toBe('anna@validation.test');
    expect(res.body.phone).toBe('070');
    expect(res.body.department).toBe('IT');
  });

  it('POST returns 409 for a duplicate e-mail, case-insensitively', async () => {
    expect((await post({ name: 'Dup', email: 'dup@validation.test' })).status).toBe(201);
    const again = await post({ name: 'Dup 2', email: 'DUP@Validation.TEST' });
    expect(again.status).toBe(409);
  });

  it('PUT returns 409 when changing to another contact\'s e-mail, but allows keeping its own', async () => {
    const a = await post({ name: 'A', email: 'put-a@validation.test' });
    const b = await post({ name: 'B', email: 'put-b@validation.test' });
    expect((await put(b.body.id, { email: 'PUT-A@validation.test' })).status).toBe(409);
    expect((await put(b.body.id, { email: 'PUT-B@validation.test', name: 'B2' })).status).toBe(200);
    expect(a.status).toBe(201);
  });

  it('PUT validates provided fields and rejects an empty name', async () => {
    const c = await post({ name: 'V', email: 'put-v@validation.test' });
    expect((await put(c.body.id, { name: '   ' })).status).toBe(400);
    expect((await put(c.body.id, { email: 'nope' })).status).toBe(400);
    expect((await put(c.body.id, { phone: 'x'.repeat(51) })).status).toBe(400);
    expect((await put(c.body.id, {})).status).toBe(400);
    expect((await put(randomUUID(), { name: 'Z' })).status).toBe(404);
  });

  it('PUT clears phone with an empty string', async () => {
    const c = await post({ name: 'P', email: 'put-p@validation.test', phone: '123' });
    const res = await put(c.body.id, { phone: '' });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBeNull();
  });

  it('DELETE writes an audit row and 404s for unknown ids', async () => {
    const c = await post({ name: 'Del', email: 'del@validation.test' });
    const res = await adminAgent.delete(`/api/contacts/${c.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrf);
    expect(res.status).toBe(200);
    const audit = db.prepare("SELECT details FROM audit_log WHERE action = 'contact_delete' AND entity_id = ?")
      .get(c.body.id) as { details: string } | undefined;
    expect(audit?.details).toContain('del@validation.test');

    const missing = await adminAgent.delete(`/api/contacts/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrf);
    expect(missing.status).toBe(404);
  });

  it('dispatches contact.created and contact.updated webhooks', async () => {
    const hookId = randomUUID();
    db.prepare('INSERT INTO webhooks (id, url, events, secret) VALUES (?, ?, ?, ?)')
      .run(hookId, 'https://93.184.216.34/hook', JSON.stringify(['contact.created', 'contact.updated']), 'sec');
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const created = await post({ name: 'Hook', email: 'hook@validation.test' });
      await put(created.body.id, { name: 'Hook 2' });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const events = fetchMock.mock.calls.map((c) => ((c as unknown[])[1] as RequestInit).headers as Record<string, string>)
        .map((h) => h['X-Webhook-Event']);
      expect(events).toEqual(['contact.created', 'contact.updated']);
    } finally {
      vi.unstubAllGlobals();
      db.prepare('DELETE FROM webhooks WHERE id = ?').run(hookId);
    }
  });
});

describe('GET /api/contacts (bare array vs pagination, search)', () => {
  const get = (qs = '') => adminAgent.get(`/api/contacts${qs}`).set('Authorization', `Bearer ${adminToken}`);

  beforeAll(() => {
    const insert = db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)');
    for (let i = 0; i < 25; i++) insert.run(randomUUID(), `Pagtest ${String(i).padStart(2, '0')}`, `pag${i}@pagination.test`);
    insert.run(randomUUID(), '100% Match_Test', 'wild@pagination.test');
  });

  it('returns a bare array when no page param is given (legacy shape)', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('applies ?search to a bare-array response too', async () => {
    const res = await get('?search=pagination.test');
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(26);
  });

  it('returns { data, pagination } when page is given', async () => {
    const res = await get('?page=2&limit=10&search=pagination.test');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.pagination).toEqual({ page: 2, limit: 10, total: 26 });
  });

  it('clamps limit to 200 and page to >= 1', async () => {
    const res = await get('?page=0&limit=100000');
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(200);
  });

  it('escapes LIKE wildcards in search', async () => {
    const res = await get('?page=1&search=100%25%20Match_');
    expect(res.body.data).toHaveLength(1);
    expect((await get('?page=1&search=%25')).body.pagination.total).toBe(1);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/contacts?page=1')).status).toBe(401);
  });
});

describe('POST /api/contacts/import/confirm validation', () => {
  const confirm = (contacts: unknown) => adminAgent.post('/api/contacts/import/confirm')
    .set('Authorization', `Bearer ${adminToken}`).set('x-csrf-token', adminCsrf).send({ contacts });

  it('aborts the whole import on a duplicate against existing contacts (case-insensitive)', async () => {
    const res = await confirm([
      { name: 'Fresh', email: 'fresh-import@import.test' },
      { name: 'Existing', email: 'OLD@contactstest.local' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.rowErrors).toEqual([{ row: 2, errors: ['E-post finns redan i systemet'] }]);
    expect(db.prepare('SELECT id FROM contacts WHERE email = ?').get('fresh-import@import.test')).toBeUndefined();
  });

  it('aborts on duplicates within the same batch', async () => {
    const res = await confirm([
      { name: 'A', email: 'same@import.test' },
      { name: 'B', email: 'SAME@import.test' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.rowErrors[0].row).toBe(2);
  });

  it('validates name length (200), phone length and email format per row', async () => {
    const res = await confirm([
      { name: 'x'.repeat(201), email: 'a1@import.test' },
      { name: 'ok', email: 'bad' },
      { name: 'ok', email: 'a3@import.test', phone: '1'.repeat(51) },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.rowErrors.map((r: { row: number }) => r.row)).toEqual([1, 2, 3]);
  });

  it('accepts a 150-char name (previous limit was 100) and sanitizes HTML', async () => {
    const res = await confirm([{ name: `<b>${'n'.repeat(150)}</b>`, email: 'long-ok@import.test', phone: ' 070 ', company: ' Importbolaget ' }]);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    const row = db.prepare('SELECT name, phone FROM contacts WHERE email = ?').get('long-ok@import.test') as { name: string; phone: string };
    expect(row.name).toBe('n'.repeat(150));
    expect(row.phone).toBe('070');
    expect(db.prepare("SELECT id FROM audit_log WHERE action = 'contact_import'").get()).toBeDefined();
  });

  it('rejects a non-array body and a non-object row', async () => {
    expect((await confirm('nope')).status).toBe(400);
    expect((await confirm([null])).status).toBe(400);
  });
});
