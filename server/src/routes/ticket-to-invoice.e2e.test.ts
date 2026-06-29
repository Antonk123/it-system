import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * End-to-end happy path: ÄRENDE → TID → FAKTURA.
 *
 * Unlike billing.test.ts / billing-authenticity.test.ts (which seed time_entries
 * directly via db.prepare), this walks the WHOLE chain through the real HTTP
 * routes, proving the seams between the features connect:
 *
 *   1. POST /api/tickets                      — create a web-origin ticket
 *   2. POST /api/time-entries/:ticketId       — log billable + non-billable time
 *   3. POST /api/billing/invoices/preview     — aggregate billable time → money
 *   4. POST /api/billing/invoices             — gapless number + VAT + stamp entries
 *   5. re-preview + PUT time-entry            — double-billing is impossible
 *   6. PUT /api/billing/invoices/:id/status   — draft → sent → paid
 *
 * This is the audit-critical #2/#3 invoice flow, so the assertions are about
 * money: minutes→hours math, 25 % VAT, a gapless invoice_number, and that a
 * billed time entry can never be invoiced twice.
 *
 * EMAIL SAFETY — this test sends ZERO real email, by two independent guards:
 *   (a) SMTP_* / EMAIL_* env are explicitly unset → createTransporter() returns
 *       null before any socket is opened (every email fn is then a no-op).
 *   (b) nodemailer is mocked so a transport physically cannot open a connection.
 * The final test asserts neither createTransport nor sendMail was ever called.
 */

const { DB_PATH, sendMailSpy, createTransportSpy } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-e2e-tti-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-e2e-tti-0123456789abcdef01234567';
  process.env.JWT_SECRET = 'test-jwt-secret-e2e-tti-0123456789abcdef0123456789';
  // Belt #1: guarantee the email layer is a no-op — strip any inherited config.
  for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'EMAIL_TO', 'IMAP_USER']) {
    delete process.env[k];
  }
  // Belt #2: a transport can never open a socket even if SMTP_* were set.
  const sendMailSpy = vi.fn(() => Promise.resolve({ messageId: 'test-no-send' }));
  const createTransportSpy = vi.fn(() => ({ sendMail: sendMailSpy }));
  return { DB_PATH: dbPath, sendMailSpy, createTransportSpy };
});

vi.mock('nodemailer', () => ({ default: { createTransport: createTransportSpy } }));

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

const ADMIN_EMAIL = 'admin@e2e-tti.local';
const ADMIN_PASSWORD = 'Adm1n-E2E-TtI-9!';
const RATE = 800; // SEK/h

// Period wide enough to always contain the runtime-created entries (created_at = now).
const PERIOD_START = '2020-01-01T00:00:00.000Z';
const PERIOD_END = '2099-01-01T00:00:00.000Z';

let app: ReturnType<typeof createApp>;
let agent: ReturnType<typeof request.agent>;
let token: string;
let csrf: string;
let companyId: string;

// Carried across the ordered chain below.
let ticketId: string;
let billableEntryId: string;
let invoiceId: string;

beforeAll(async () => {
  initializeDatabase();

  const adminId = randomUUID();
  companyId = randomUUID();
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(adminId, ADMIN_EMAIL, hash, 'admin', 'E2E Admin');
  db.prepare('INSERT INTO companies (id, name) VALUES (?, ?)').run(companyId, 'E2E Kund AB');
  db.prepare('INSERT INTO billing_rates (id, company_id, rate_per_hour, currency) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), companyId, RATE, 'SEK');

  app = createApp();
  agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
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

const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`).set('x-csrf-token', csrf);

describe('E2E: ärende → tid → faktura (happy path)', () => {
  it('1. creates a ticket via POST /api/tickets (201)', async () => {
    const res = await auth(agent.post('/api/tickets')).send({
      title: 'E2E: skärm fungerar inte',
      description: 'Kundens skärm är svart efter omstart.',
      company_id: companyId,
      priority: 'medium',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.company_id).toBe(companyId);
    ticketId = res.body.id;
  });

  it('2. logs two billable (60 + 30 min) and one non-billable (120 min) entry via the API', async () => {
    const first = await auth(agent.post(`/api/time-entries/${ticketId}`))
      .send({ duration_minutes: 60, note: 'Felsökning', billable: true });
    expect(first.status).toBe(201);
    expect(first.body.billable).toBe(1);
    billableEntryId = first.body.id;

    const second = await auth(agent.post(`/api/time-entries/${ticketId}`))
      .send({ duration_minutes: 30, note: 'Byte av kabel', billable: true });
    expect(second.status).toBe(201);

    const nonBillable = await auth(agent.post(`/api/time-entries/${ticketId}`))
      .send({ duration_minutes: 120, note: 'Intern dokumentation', billable: false });
    expect(nonBillable.status).toBe(201);
    expect(nonBillable.body.billable).toBe(0);
  });

  it('3. preview aggregates ONLY billable time and applies 25 % VAT', async () => {
    const res = await auth(agent.post('/api/billing/invoices/preview'))
      .send({ company_id: companyId, period_start: PERIOD_START, period_end: PERIOD_END });
    expect(res.status).toBe(200);
    // 90 billable min → 1.5 h @ 800 = 1200 (the 120 non-billable min are excluded).
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].ticket_id).toBe(ticketId);
    expect(res.body.total_hours).toBe(1.5);
    expect(res.body.total_amount).toBe(1200);
    expect(res.body.vat_rate).toBe(0.25);
    expect(res.body.vat_amount).toBe(300);
    expect(res.body.total_incl_vat).toBe(1500);
  });

  it('4. creates an invoice with a gapless number, persisted VAT, and stamps the billed time', async () => {
    const res = await auth(agent.post('/api/billing/invoices')).send({
      company_id: companyId,
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      lines: [{ ticket_id: ticketId, description: 'E2E: skärm fungerar inte', hours: 1.5, rate: RATE, amount: 1200 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.invoice_number).toBe(1); // fresh DB → first invoice in the global series
    expect(res.body.total_amount).toBe(1200);
    expect(res.body.vat_rate).toBe(0.25);
    expect(res.body.vat_amount).toBe(300);
    invoiceId = res.body.id;

    // The billable entries are now stamped with this invoice_id.
    const stamped = db.prepare('SELECT invoice_id FROM time_entries WHERE id = ?').get(billableEntryId) as { invoice_id: string | null };
    expect(stamped.invoice_id).toBe(invoiceId);
  });

  it('5. double-billing is impossible: re-preview is empty AND editing a billed entry → 409', async () => {
    const re = await auth(agent.post('/api/billing/invoices/preview'))
      .send({ company_id: companyId, period_start: PERIOD_START, period_end: PERIOD_END });
    expect(re.status).toBe(200);
    expect(re.body.lines).toHaveLength(0);
    expect(re.body.total_amount).toBe(0);

    const edit = await auth(agent.put(`/api/time-entries/${ticketId}/${billableEntryId}`))
      .send({ duration_minutes: 999 });
    expect(edit.status).toBe(409); // invoiced entry is frozen — editing would desync the invoice
  });

  it('6. status advances forward draft → sent → paid (and stamps timestamps)', async () => {
    const sent = await auth(agent.put(`/api/billing/invoices/${invoiceId}/status`)).send({ status: 'sent' });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('sent');
    expect(sent.body.sent_at).toBeTruthy();

    const paid = await auth(agent.put(`/api/billing/invoices/${invoiceId}/status`)).send({ status: 'paid' });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('paid');
    expect(paid.body.paid_at).toBeTruthy();

    const backward = await auth(agent.put(`/api/billing/invoices/${invoiceId}/status`)).send({ status: 'draft' });
    expect(backward.status).toBe(400); // forward-only guard
  });

  it('7. SAFETY: not a single email left the machine during the whole flow', () => {
    expect(process.env.SMTP_HOST).toBeUndefined();
    expect(createTransportSpy).not.toHaveBeenCalled();
    expect(sendMailSpy).not.toHaveBeenCalled();
  });
});
