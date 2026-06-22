import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for the contacts routes.
 *
 * Regression focus: PUT /api/contacts/:id must persist edits. A regression
 * (audit-v2) added `safeUpdates.updated_at = ...` but the contacts table has
 * no updated_at column → every edit threw SqliteError → HTTP 500.
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

beforeAll(async () => {
  initializeDatabase();

  const adminId = randomUUID();
  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(adminId, 'admin@contactstest.local', adminHash, 'admin', 'Contacts Admin');

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
