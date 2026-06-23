import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * IDOR authorization test for GET /api/shares/ticket/:ticketId.
 *
 * A logged-in stranger must not be able to read a ticket's share token.
 * Owner (created_by) → 200; stranger → 403; no token → 401.
 *
 * UNIQUE DB_PATH suffix (-shares) so parallel suites don't collide.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-shares.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-shares-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-shares-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;

let adminToken: string;
let ownerToken: string;
let strangerToken: string;

let adminId: string;
let ownerId: string;
let strangerId: string;

let ticketId: string;

async function loginToken(email: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

beforeAll(async () => {
  initializeDatabase();

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
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
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
