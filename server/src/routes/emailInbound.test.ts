import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * GET /api/email-inbound/status exponerar IMAP-värd och -användare och är därför
 * admin-only: 401 utan inloggning, 403 för vanlig användare, 200 för admin.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-emailinbound.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-emailinbound-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-emailinbound-0123456789abcdef0123456789abcdef';
  process.env.IMAP_HOST = 'imap.example.com';
  process.env.IMAP_USER = 'inbox@example.com';
  process.env.IMAP_PASS = 'hemligt';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;
let adminToken: string;
let userToken: string;

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

beforeAll(async () => {
  initializeDatabase();

  const insert = db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  );
  insert.run(randomUUID(), 'admin@emailinbound.local', await bcrypt.hash('Admin-P@ss1234!', 10), 'admin', 'Admin');
  insert.run(randomUUID(), 'user@emailinbound.local', await bcrypt.hash('User-P@ss1234!', 10), 'user', 'User');

  app = createApp();
  adminToken = await login('admin@emailinbound.local', 'Admin-P@ss1234!');
  userToken = await login('user@emailinbound.local', 'User-P@ss1234!');
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/email-inbound/status', () => {
  it('401 utan autentisering', async () => {
    const res = await request(app).get('/api/email-inbound/status');
    expect(res.status).toBe(401);
  });

  it('403 för vanlig användare, utan att läcka IMAP-uppgifter', async () => {
    const res = await request(app).get('/api/email-inbound/status').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('imap.example.com');
  });

  it('200 för admin med konfigurationsstatus', async () => {
    const res = await request(app).get('/api/email-inbound/status').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, host: 'imap.example.com', user: 'inbox@example.com' });
  });
});
