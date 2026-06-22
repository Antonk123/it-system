import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Regression test for GET /api/tickets/:id/history authorization.
 *
 * The audit-v2 LOW wave added an unconditional canAccessTicket() gate that did
 * NOT mirror PUT /:id (which leaves UNASSIGNED tickets open for self-service
 * pickup). Result: a non-owning agent could view + edit an unassigned queue
 * ticket but got 403 on its history → empty activity panel. The fix mirrors PUT.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-tkhist-test-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-tkhist-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-tkhist-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;
let userBAgent: ReturnType<typeof request.agent>;
let userBToken: string;
let adminAgent: ReturnType<typeof request.agent>;
let adminToken: string;

let unassignedTicket: string;
let assignedToOtherTicket: string;

beforeAll(async () => {
  initializeDatabase();

  const adminId = randomUUID();
  const userBId = randomUUID();
  const userCId = randomUUID();
  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const userHash = await bcrypt.hash('User-P@ss1234!', 10);

  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(adminId, 'admin@tkhist.local', adminHash, 'admin', 'Admin');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(userBId, 'b@tkhist.local', userHash, 'user', 'Agent B');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(userCId, 'c@tkhist.local', userHash, 'user', 'Agent C');

  // Unassigned, created_by = userC (so userB is NOT owner) → self-service-öppet.
  unassignedTicket = randomUUID();
  db.prepare(`INSERT INTO tickets (id, title, description, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(unassignedTicket, 'Unassigned queue', 'x', 'open', null, userCId);
  db.prepare(`INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), unassignedTicket, userCId, 'created', null, 'open');

  // Assigned to userC (not userB) → skyddat för icke-ägare.
  assignedToOtherTicket = randomUUID();
  db.prepare(`INSERT INTO tickets (id, title, description, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(assignedToOtherTicket, 'Assigned to C', 'x', 'open', userCId, userCId);

  app = createApp();

  adminAgent = request.agent(app);
  const adminLogin = await adminAgent.post('/api/auth/login').send({ email: 'admin@tkhist.local', password: 'Admin-P@ss1234!' });
  adminToken = adminLogin.body.accessToken;

  userBAgent = request.agent(app);
  const bLogin = await userBAgent.post('/api/auth/login').send({ email: 'b@tkhist.local', password: 'User-P@ss1234!' });
  userBToken = bLogin.body.accessToken;
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/tickets/:id/history — authz mirrors PUT', () => {
  it('non-owner agent CAN read history of an UNASSIGNED ticket (self-service)', async () => {
    const res = await userBAgent.get(`/api/tickets/${unassignedTicket}/history`)
      .set('Authorization', `Bearer ${userBToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('non-owner agent is BLOCKED (403) from history of a ticket assigned to someone else', async () => {
    const res = await userBAgent.get(`/api/tickets/${assignedToOtherTicket}/history`)
      .set('Authorization', `Bearer ${userBToken}`);
    expect(res.status).toBe(403);
  });

  it('admin CAN read history of an assigned ticket', async () => {
    const res = await adminAgent.get(`/api/tickets/${assignedToOtherTicket}/history`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for a non-existent ticket', async () => {
    const res = await adminAgent.get(`/api/tickets/${randomUUID()}/history`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
