import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Tests for invoice authenticity (#2/#3): gapless invoice numbering, VAT, the
 * billable filter, and re-billing prevention via time_entries.invoice_id.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-billauth-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-billauth-0123456789abcdef01234567';
  process.env.JWT_SECRET = 'test-jwt-secret-billauth-0123456789abcdef0123456789';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;
let agent: ReturnType<typeof request.agent>;
let token: string;
let csrf: string;
let companyId: string;
let ticketId: string;

const PERIOD_START = '2026-03-01T00:00:00.000Z';
const PERIOD_END = '2026-04-01T00:00:00.000Z';

beforeAll(async () => {
  initializeDatabase();

  const adminId = randomUUID();
  companyId = randomUUID();
  ticketId = randomUUID();
  const hash = await bcrypt.hash('Adm1n-BillAuth-9!', 10);
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(adminId, 'admin@billauth.local', hash, 'admin', 'BillAuth Admin');
  db.prepare('INSERT INTO companies (id, name) VALUES (?, ?)').run(companyId, 'BillAuth AB');
  db.prepare('INSERT INTO tickets (id, title, description, company_id) VALUES (?, ?, ?, ?)')
    .run(ticketId, 'Auth Ticket', 'Desc', companyId);
  db.prepare('INSERT INTO billing_rates (id, company_id, rate_per_hour, currency) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), companyId, 800, 'SEK');

  // 60 + 30 billable minutes, plus 120 NON-billable minutes (must be excluded).
  db.prepare('INSERT INTO time_entries (id, ticket_id, duration_minutes, billable, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(randomUUID(), ticketId, 60, '2026-03-10T09:00:00.000Z');
  db.prepare('INSERT INTO time_entries (id, ticket_id, duration_minutes, billable, created_at) VALUES (?, ?, ?, 1, ?)')
    .run(randomUUID(), ticketId, 30, '2026-03-11T09:00:00.000Z');
  db.prepare('INSERT INTO time_entries (id, ticket_id, duration_minutes, billable, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(randomUUID(), ticketId, 120, '2026-03-12T09:00:00.000Z');

  app = createApp();
  agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email: 'admin@billauth.local', password: 'Adm1n-BillAuth-9!' });
  token = login.body.accessToken;
  const c = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  csrf = c.body.csrfToken;
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

function preview() {
  return agent.post('/api/billing/invoices/preview')
    .set('Authorization', `Bearer ${token}`).set('x-csrf-token', csrf)
    .send({ company_id: companyId, period_start: PERIOD_START, period_end: PERIOD_END });
}

describe('preview — billable filter + VAT', () => {
  it('excludes non-billable entries and returns 25% VAT by default', async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    // Only the 90 billable minutes count → 1.5h, 1200 net (120 non-billable excluded).
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.total_amount).toBe(1200);
    expect(res.body.vat_rate).toBe(0.25);
    expect(res.body.vat_amount).toBe(300);
    expect(res.body.total_incl_vat).toBe(1500);
  });
});

describe('create — gapless number, VAT persistence, re-billing prevention', () => {
  it('assigns a gapless invoice_number and persists default VAT', async () => {
    const res = await agent.post('/api/billing/invoices')
      .set('Authorization', `Bearer ${token}`).set('x-csrf-token', csrf)
      .send({
        company_id: companyId, period_start: PERIOD_START, period_end: PERIOD_END,
        lines: [{ ticket_id: ticketId, description: 'Auth Ticket', hours: 1.5, rate: 800, amount: 1200 }],
      });
    expect(res.status).toBe(201);
    expect(typeof res.body.invoice_number).toBe('number');
    expect(res.body.invoice_number).toBeGreaterThanOrEqual(1);
    expect(res.body.total_amount).toBe(1200);
    expect(res.body.vat_rate).toBe(0.25);
    expect(res.body.vat_amount).toBe(300);
  });

  it('stamps billed time entries so a re-preview excludes them (no double-billing)', async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    // The two billable entries are now stamped with invoice_id → nothing left to bill.
    expect(res.body.lines).toHaveLength(0);
    expect(res.body.total_amount).toBe(0);
  });

  it('assigns the next consecutive number to a second invoice and honours a custom VAT rate', async () => {
    const first = (await agent.get('/api/billing/invoices').set('Authorization', `Bearer ${token}`))
      .body[0].invoice_number as number;

    const res = await agent.post('/api/billing/invoices')
      .set('Authorization', `Bearer ${token}`).set('x-csrf-token', csrf)
      .send({
        company_id: companyId, period_start: '2026-05-01T00:00:00.000Z', period_end: '2026-06-01T00:00:00.000Z',
        vat_rate: 0.06,
        lines: [{ description: 'Fast pris', hours: 2, rate: 1000, amount: 2000 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.invoice_number).toBe(first + 1);
    expect(res.body.vat_rate).toBe(0.06);
    expect(res.body.vat_amount).toBe(120); // 2000 * 0.06
  });
});
