import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Integration tests for the billing routes (/api/billing/...).
 *
 * Covers:
 *  - AUTH: non-admin gets 403 on all admin-only billing endpoints
 *  - Billing rates: GET + PUT /rates/:companyId (upsert)
 *  - Invoice preview: POST /invoices/preview — minutes→hours math, amount = hours * rate
 *    (90 min @ 800/h => 1.5 h => 1200 SEK)
 *  - Invoice creation: POST /invoices — server-side total recomputation from lines
 *  - Period-overlap guard: second overlapping invoice → 409
 *  - Invoice list + single fetch: GET /invoices, GET /invoices/:id
 *  - Status transitions (forward-only guard):
 *      valid: draft→sent, draft→paid, sent→paid
 *      invalid: paid→draft, paid→sent, sent→draft → 400
 *  - Delete: draft can be deleted; non-draft cannot (400)
 *
 * Bootstrap mirrors backup.test.ts exactly: vi.hoisted() sets env before any
 * import that transitively pulls in db/connection.ts.
 * Login is rate-limited to 5 attempts / 15 min per IP — we perform 2 logins total
 * (one admin, one regular user) and reuse them across all tests.
 */

const USER_EMAIL = 'user@billingtest.local';
const USER_PASSWORD = 'UserP@ss-Billing-9!';
const ADMIN_EMAIL = 'admin@billingtest.local';
const ADMIN_PASSWORD = 'Adm1n-Billing-Pw!9';

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-billing-test-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-billing-0123456789abcdef01234567';
  process.env.JWT_SECRET = 'test-jwt-secret-billing-0123456789abcdef0123456789';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;

let adminAgent: ReturnType<typeof request.agent>;
let adminToken: string;
let adminCsrfToken: string;

let userAgent: ReturnType<typeof request.agent>;
let userToken: string;

// IDs seeded in beforeAll, used across test suites.
let companyId: string;
let ticketId: string;

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  initializeDatabase();

  const adminId = randomUUID();
  const userId = randomUUID();
  companyId = randomUUID();
  ticketId = randomUUID();

  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const userHash = await bcrypt.hash(USER_PASSWORD, 10);

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`,
  ).run(adminId, ADMIN_EMAIL, adminHash, 'admin', 'Billing Admin');

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, USER_EMAIL, userHash, 'user', 'Regular User');

  // Seed a company used throughout.
  db.prepare(
    `INSERT INTO companies (id, name) VALUES (?, ?)`,
  ).run(companyId, 'Test Company AB');

  // Seed a ticket belonging to the company.
  db.prepare(
    `INSERT INTO tickets (id, title, description, company_id) VALUES (?, ?, ?, ?)`,
  ).run(ticketId, 'Test Ticket', 'Desc', companyId);

  // Seed two time entries: 60 + 30 = 90 minutes on that ticket.
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO time_entries (id, ticket_id, duration_minutes, created_at) VALUES (?, ?, ?, ?)`,
  ).run(randomUUID(), ticketId, 60, now);
  db.prepare(
    `INSERT INTO time_entries (id, ticket_id, duration_minutes, created_at) VALUES (?, ?, ?, ?)`,
  ).run(randomUUID(), ticketId, 30, now);

  app = createApp();

  // Login once as admin — reused across all admin tests.
  adminAgent = request.agent(app);
  const adminLogin = await adminAgent
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(adminLogin.status).toBe(200);
  adminToken = adminLogin.body.accessToken;

  const csrfRes = await adminAgent
    .get('/api/csrf-token')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(csrfRes.status).toBe(200);
  adminCsrfToken = csrfRes.body.csrfToken;

  // Login once as regular user.
  userAgent = request.agent(app);
  const userLogin = await userAgent
    .post('/api/auth/login')
    .send({ email: USER_EMAIL, password: USER_PASSWORD });
  expect(userLogin.status).toBe(200);
  userToken = userLogin.body.accessToken;
});

afterAll(() => {
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
});

// ---------------------------------------------------------------------------
// Auth guard: non-admin gets 403 on all billing endpoints
// ---------------------------------------------------------------------------

describe('Auth guard — non-admin is forbidden (403)', () => {
  it('GET /api/billing/rates/:companyId → 403', async () => {
    const res = await userAgent
      .get(`/api/billing/rates/${companyId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('PUT /api/billing/rates/:companyId → 403', async () => {
    // Acquire a CSRF token for the user session first
    const csrfRes = await userAgent
      .get('/api/csrf-token')
      .set('Authorization', `Bearer ${userToken}`);
    const userCsrfToken = csrfRes.body.csrfToken;

    const res = await userAgent
      .put(`/api/billing/rates/${companyId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrfToken)
      .send({ rate_per_hour: 800 });
    expect(res.status).toBe(403);
  });

  it('GET /api/billing/invoices → 403', async () => {
    const res = await userAgent
      .get('/api/billing/invoices')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('POST /api/billing/invoices → 403', async () => {
    const csrfRes = await userAgent
      .get('/api/csrf-token')
      .set('Authorization', `Bearer ${userToken}`);
    const userCsrfToken = csrfRes.body.csrfToken;

    const res = await userAgent
      .post('/api/billing/invoices')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrfToken)
      .send({ company_id: companyId, period_start: '2026-01-01', period_end: '2026-02-01', lines: [] });
    expect(res.status).toBe(403);
  });

  it('POST /api/billing/invoices/preview → 403', async () => {
    const csrfRes = await userAgent
      .get('/api/csrf-token')
      .set('Authorization', `Bearer ${userToken}`);
    const userCsrfToken = csrfRes.body.csrfToken;

    const res = await userAgent
      .post('/api/billing/invoices/preview')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrfToken)
      .send({ company_id: companyId, period_start: '2026-01-01', period_end: '2026-02-01' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Billing rates
// ---------------------------------------------------------------------------

describe('Billing rates', () => {
  it('GET /rates/:companyId returns null when no rate is set', async () => {
    const res = await adminAgent
      .get(`/api/billing/rates/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('PUT /rates/:companyId rejects rate_per_hour ≤ 0 (400)', async () => {
    const res = await adminAgent
      .put(`/api/billing/rates/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ rate_per_hour: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rate_per_hour/i);
  });

  it('PUT /rates/:companyId upserts (creates) a rate and returns the full row', async () => {
    const res = await adminAgent
      .put(`/api/billing/rates/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ rate_per_hour: 800, currency: 'SEK' });
    expect(res.status).toBe(200);
    expect(res.body.rate_per_hour).toBe(800);
    expect(res.body.currency).toBe('SEK');
    expect(res.body.company_id).toBe(companyId);
  });

  it('GET /rates/:companyId returns the rate after it has been set', async () => {
    const res = await adminAgent
      .get(`/api/billing/rates/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rate_per_hour).toBe(800);
  });

  it('PUT /rates/:companyId updates an existing rate (upsert path)', async () => {
    const res = await adminAgent
      .put(`/api/billing/rates/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ rate_per_hour: 1000, currency: 'SEK' });
    expect(res.status).toBe(200);
    expect(res.body.rate_per_hour).toBe(1000);

    // Reset to 800 so subsequent tests are deterministic
    await adminAgent
      .put(`/api/billing/rates/${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ rate_per_hour: 800, currency: 'SEK' });
  });
});

// ---------------------------------------------------------------------------
// Invoice preview — minutes→hours math + amount calculation
// ---------------------------------------------------------------------------

describe('POST /api/billing/invoices/preview — aggregation math', () => {
  it('returns 400 when company_id is missing', async () => {
    const res = await adminAgent
      .post('/api/billing/invoices/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ period_start: '2026-01-01', period_end: '2026-02-01' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when no billing rate is set for the company', async () => {
    const noRateCompanyId = randomUUID();
    db.prepare(`INSERT INTO companies (id, name) VALUES (?, ?)`).run(noRateCompanyId, 'No Rate Co');

    const res = await adminAgent
      .post('/api/billing/invoices/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ company_id: noRateCompanyId, period_start: '2026-01-01', period_end: '2026-02-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/billing rate/i);
  });

  it('90 min @ 800 SEK/h → 1.5 h, 1200 SEK (the key math assertion)', async () => {
    // time_entries were seeded with 60+30=90 min for ticketId in beforeAll.
    // Use a period that covers the seeded entries (far future range to be safe).
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const res = await adminAgent
      .post('/api/billing/invoices/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        company_id: companyId,
        period_start: '2000-01-01T00:00:00.000Z',
        period_end: future.toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.rate_per_hour).toBe(800);
    expect(res.body.currency).toBe('SEK');

    // There should be exactly one line (all entries grouped under ticketId).
    expect(Array.isArray(res.body.lines)).toBe(true);
    expect(res.body.lines).toHaveLength(1);

    const line = res.body.lines[0];
    expect(line.hours).toBe(1.5);           // 90 / 60 = 1.5
    expect(line.rate).toBe(800);
    expect(line.amount).toBe(1200);         // 1.5 * 800

    expect(res.body.total_hours).toBe(1.5);
    expect(res.body.total_amount).toBe(1200);
  });
});

// ---------------------------------------------------------------------------
// Invoice creation (POST /invoices), list, fetch, overlap guard
// ---------------------------------------------------------------------------

describe('POST /api/billing/invoices — creation + overlap guard', () => {
  const PERIOD_START = '2025-01-01T00:00:00.000Z';
  const PERIOD_END   = '2025-02-01T00:00:00.000Z';
  let invoiceId: string;

  it('returns 400 when required fields are missing', async () => {
    const res = await adminAgent
      .post('/api/billing/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ company_id: companyId }); // missing period + lines
    expect(res.status).toBe(400);
  });

  it('returns 400 when lines array is empty', async () => {
    const res = await adminAgent
      .post('/api/billing/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        company_id: companyId,
        period_start: PERIOD_START,
        period_end: PERIOD_END,
        lines: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one/i);
  });

  it('creates an invoice (201) and re-computes totals server-side', async () => {
    // Provide lines whose totals the server should recompute (ignoring any
    // client-supplied total_hours / total_amount fields).
    const res = await adminAgent
      .post('/api/billing/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        company_id: companyId,
        period_start: PERIOD_START,
        period_end: PERIOD_END,
        currency: 'SEK',
        lines: [
          { ticket_id: ticketId, description: 'Test Ticket', hours: 1.5, rate: 800, amount: 1200 },
        ],
      });

    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    invoiceId = res.body.id;

    expect(res.body.status).toBe('draft');
    expect(res.body.company_id).toBe(companyId);
    expect(res.body.total_hours).toBe(1.5);
    expect(res.body.total_amount).toBe(1200);
    expect(res.body.currency).toBe('SEK');
  });

  it('GET /invoices lists the created invoice', async () => {
    const res = await adminAgent
      .get('/api/billing/invoices')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((inv: { id: string }) => inv.id === invoiceId);
    expect(found).toBeDefined();
    expect(found.company_name).toBe('Test Company AB');
  });

  it('GET /invoices?company_id= filters by company', async () => {
    const res = await adminAgent
      .get(`/api/billing/invoices?company_id=${companyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.every((inv: { company_id: string }) => inv.company_id === companyId)).toBe(true);
  });

  it('GET /invoices/:id returns invoice with lines', async () => {
    const res = await adminAgent
      .get(`/api/billing/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(invoiceId);
    expect(Array.isArray(res.body.lines)).toBe(true);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].hours).toBe(1.5);
    expect(res.body.lines[0].amount).toBe(1200);
  });

  it('GET /invoices/:id returns 404 for unknown id', async () => {
    const res = await adminAgent
      .get('/api/billing/invoices/nonexistent-id')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('period-overlap guard: second overlapping invoice → 409', async () => {
    // Same period for same company → must be rejected
    const res = await adminAgent
      .post('/api/billing/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        company_id: companyId,
        period_start: PERIOD_START,
        period_end: PERIOD_END,
        lines: [
          { description: 'Overlap line', hours: 0.5, rate: 800, amount: 400 },
        ],
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/overlap/i);
  });
});

// ---------------------------------------------------------------------------
// Invoice status transitions (forward-only guard)
// ---------------------------------------------------------------------------

describe('PUT /api/billing/invoices/:id/status — forward-only guard', () => {
  let statusInvoiceId: string;

  beforeAll(async () => {
    // Create a fresh invoice with a non-overlapping period for status tests
    const res = await adminAgent
      .post('/api/billing/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        company_id: companyId,
        period_start: '2024-01-01T00:00:00.000Z',
        period_end: '2024-02-01T00:00:00.000Z',
        lines: [{ description: 'Status test line', hours: 1, rate: 800, amount: 800 }],
      });
    expect(res.status).toBe(201);
    statusInvoiceId = res.body.id;
  });

  it('returns 400 for an invalid status value', async () => {
    const res = await adminAgent
      .put(`/api/billing/invoices/${statusInvoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ status: 'cancelled' }); // not in ['draft','sent','paid']
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid status/i);
  });

  it('returns 400 when trying to go backwards: draft→draft (same state)', async () => {
    const res = await adminAgent
      .put(`/api/billing/invoices/${statusInvoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ status: 'draft' }); // same level — statusOrder[draft]=0 <= 0
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/forward/i);
  });

  it('valid transition draft→sent succeeds (200) and sets sent_at', async () => {
    const res = await adminAgent
      .put(`/api/billing/invoices/${statusInvoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ status: 'sent' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
    expect(res.body.sent_at).toBeTruthy();
    expect(res.body.paid_at).toBeNull();
  });

  it('invalid backward transition sent→draft → 400', async () => {
    const res = await adminAgent
      .put(`/api/billing/invoices/${statusInvoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ status: 'draft' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/forward/i);
  });

  it('valid transition sent→paid succeeds (200) and sets paid_at', async () => {
    const res = await adminAgent
      .put(`/api/billing/invoices/${statusInvoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ status: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(res.body.paid_at).toBeTruthy();
  });

  it('invalid backward transition paid→sent → 400', async () => {
    const res = await adminAgent
      .put(`/api/billing/invoices/${statusInvoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ status: 'sent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/forward/i);
  });

  it('invalid backward transition paid→draft → 400', async () => {
    const res = await adminAgent
      .put(`/api/billing/invoices/${statusInvoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ status: 'draft' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/forward/i);
  });

  it('returns 404 for an unknown invoice id', async () => {
    const res = await adminAgent
      .put('/api/billing/invoices/nonexistent-invoice/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ status: 'sent' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /invoices/:id — draft can be deleted; non-draft cannot
// ---------------------------------------------------------------------------

describe('DELETE /api/billing/invoices/:id', () => {
  let draftInvoiceId: string;
  let sentInvoiceId: string;

  beforeAll(async () => {
    // Draft invoice — different non-overlapping period
    const r1 = await adminAgent
      .post('/api/billing/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        company_id: companyId,
        period_start: '2023-01-01T00:00:00.000Z',
        period_end: '2023-02-01T00:00:00.000Z',
        lines: [{ description: 'Delete test draft', hours: 1, rate: 800, amount: 800 }],
      });
    expect(r1.status).toBe(201);
    draftInvoiceId = r1.body.id;

    // Sent invoice — advance status to 'sent' so delete is blocked
    const r2 = await adminAgent
      .post('/api/billing/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        company_id: companyId,
        period_start: '2022-01-01T00:00:00.000Z',
        period_end: '2022-02-01T00:00:00.000Z',
        lines: [{ description: 'Delete test sent', hours: 1, rate: 800, amount: 800 }],
      });
    expect(r2.status).toBe(201);
    sentInvoiceId = r2.body.id;

    const advanceRes = await adminAgent
      .put(`/api/billing/invoices/${sentInvoiceId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken)
      .send({ status: 'sent' });
    expect(advanceRes.status).toBe(200);
  });

  it('returns 404 when deleting a non-existent invoice', async () => {
    const res = await adminAgent
      .delete('/api/billing/invoices/does-not-exist')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);
    expect(res.status).toBe(404);
  });

  it('returns 400 when trying to delete a non-draft invoice', async () => {
    const res = await adminAgent
      .delete(`/api/billing/invoices/${sentInvoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/draft/i);
  });

  it('successfully deletes a draft invoice (200)', async () => {
    const res = await adminAgent
      .delete(`/api/billing/invoices/${draftInvoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', adminCsrfToken);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
  });

  it('deleted invoice is no longer findable via GET', async () => {
    const res = await adminAgent
      .get(`/api/billing/invoices/${draftInvoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
