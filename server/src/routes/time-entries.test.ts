import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Tests for time-entries (#3): the billable flag, work_date, and the edit (PUT)
 * route — including its creator/admin authorization.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-timeentries-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-timeentries-0123456789abcdef0123';
  process.env.JWT_SECRET = 'test-jwt-secret-timeentries-0123456789abcdef01234';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;
let owner: { agent: ReturnType<typeof request.agent>; token: string; csrf: string; id: string };
let other: { agent: ReturnType<typeof request.agent>; token: string; csrf: string; id: string };
let ticketId: string;

async function login(email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  const token = res.body.accessToken as string;
  const c = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  return { agent, token, csrf: c.body.csrfToken as string };
}

beforeAll(async () => {
  initializeDatabase();

  const ownerId = randomUUID();
  const otherId = randomUUID();
  ticketId = randomUUID();
  const hash = await bcrypt.hash('Time-P@ss-1234!', 10);
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, 'owner@time.local', hash, 'user', 'Owner');
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(otherId, 'other@time.local', hash, 'user', 'Other');
  // Ticket assigned to owner so they may log time.
  db.prepare('INSERT INTO tickets (id, title, description, assigned_to, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(ticketId, 'Time Ticket', 'Desc', ownerId, ownerId);

  app = createApp();
  const o = await login('owner@time.local', 'Time-P@ss-1234!');
  owner = { ...o, id: ownerId };
  const ot = await login('other@time.local', 'Time-P@ss-1234!');
  other = { ...ot, id: otherId };
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

function postEntry(body: Record<string, unknown>) {
  return owner.agent.post(`/api/time-entries/${ticketId}`)
    .set('Authorization', `Bearer ${owner.token}`).set('x-csrf-token', owner.csrf).send(body);
}

describe('POST /api/time-entries/:ticketId — billable + work_date', () => {
  it('defaults billable to true (1) when not provided', async () => {
    const res = await postEntry({ duration_minutes: 60 });
    expect(res.status).toBe(201);
    expect(res.body.billable).toBe(1);
  });

  it('persists billable=false and work_date when provided', async () => {
    const res = await postEntry({ duration_minutes: 45, billable: false, work_date: '2026-03-20' });
    expect(res.status).toBe(201);
    expect(res.body.billable).toBe(0);
    expect(res.body.work_date).toBe('2026-03-20');
  });
});

describe('PUT /api/time-entries/:ticketId/:id — edit', () => {
  let entryId: string;

  it('edits duration, note, billable and work_date', async () => {
    const created = await postEntry({ duration_minutes: 30, note: 'first' });
    entryId = created.body.id;

    const res = await owner.agent.put(`/api/time-entries/${ticketId}/${entryId}`)
      .set('Authorization', `Bearer ${owner.token}`).set('x-csrf-token', owner.csrf)
      .send({ duration_minutes: 90, note: 'edited', billable: false, work_date: '2026-03-21' });

    expect(res.status).toBe(200);
    expect(res.body.duration_minutes).toBe(90);
    expect(res.body.note).toBe('edited');
    expect(res.body.billable).toBe(0);
    expect(res.body.work_date).toBe('2026-03-21');
  });

  it('rejects an out-of-range duration (400)', async () => {
    const res = await owner.agent.put(`/api/time-entries/${ticketId}/${entryId}`)
      .set('Authorization', `Bearer ${owner.token}`).set('x-csrf-token', owner.csrf)
      .send({ duration_minutes: 5000 });
    expect(res.status).toBe(400);
  });

  it('forbids a non-owner non-admin from editing (403)', async () => {
    const res = await other.agent.put(`/api/time-entries/${ticketId}/${entryId}`)
      .set('Authorization', `Bearer ${other.token}`).set('x-csrf-token', other.csrf)
      .send({ duration_minutes: 10 });
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown entry', async () => {
    const res = await owner.agent.put(`/api/time-entries/${ticketId}/${randomUUID()}`)
      .set('Authorization', `Bearer ${owner.token}`).set('x-csrf-token', owner.csrf)
      .send({ duration_minutes: 10 });
    expect(res.status).toBe(404);
  });

  it('forbids editing an already-invoiced entry (409) — would desync the invoice', async () => {
    const created = await postEntry({ duration_minutes: 20 });
    const id = created.body.id;
    // Stamp with a real invoice (invoice_id has a FK to invoices(id)).
    const compId = randomUUID();
    const invId = randomUUID();
    db.prepare('INSERT INTO companies (id, name) VALUES (?, ?)').run(compId, 'Inv Co');
    db.prepare('INSERT INTO invoices (id, company_id, period_start, period_end) VALUES (?, ?, ?, ?)')
      .run(invId, compId, '2026-03-01', '2026-04-01');
    db.prepare('UPDATE time_entries SET invoice_id = ? WHERE id = ?').run(invId, id);

    const res = await owner.agent.put(`/api/time-entries/${ticketId}/${id}`)
      .set('Authorization', `Bearer ${owner.token}`).set('x-csrf-token', owner.csrf)
      .send({ duration_minutes: 25 });
    expect(res.status).toBe(409);
  });
});
