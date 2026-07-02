import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';

/**
 * HTTP integration tests for the previously-untested endpoints of
 * server/src/routes/tickets.ts (audit H6: 15 of 23 endpoints had zero test
 * coverage). This file is intentionally separate from tickets.test.ts /
 * tickets-history.test.ts / tickets-email-async.test.ts — it does not modify
 * or duplicate their coverage of the core CRUD/bulk endpoints.
 *
 * Covers:
 *  1. POST /import/preview + POST /import/confirm — admin-only (requireAdmin),
 *     multer CSV upload (preview), JSON body (confirm), DB verification.
 *  2. GET /export + GET /export-archive — XLSX download, headers, content.
 *  3. POST /:id/ai-draft + GET /:id/ai-summary — auth, the canAccessTicket()
 *     403 boundary (checked BEFORE aiEnabled(), so it's reachable without a
 *     real ANTHROPIC_API_KEY), 404 for a missing ticket, and the
 *     aiEnabled()=false gating branch for an authorized caller (no
 *     ANTHROPIC_API_KEY in test env → 503, NOT mocked).
 *  4. Reminder CRUD (POST/GET/DELETE /:id/reminders[/sent|/:reminderId]) incl.
 *     the canAccessTicket() 403 boundary on POST/GET/DELETE .../sent for an
 *     unrelated user on an assigned ticket (unassigned tickets stay open for
 *     self-service pickup), and the ownership 403 boundary on
 *     DELETE /:id/reminders/:reminderId.
 *  5. Dashboard/aggregate smoke endpoints: dashboard-overview, activity-feed,
 *     status-counts, requester-open-counts, upcoming-reminders — 401 without
 *     auth, 200 + plausible shape with auth.
 *
 * Harness mirrors tickets.test.ts: a UNIQUE DB_PATH (-tickets-endpoints suffix)
 * set in vi.hoisted() BEFORE any import that pulls in db/connection.ts. Login
 * is rate-limited (5/15min per IP) so each user logs in exactly ONCE and the
 * persistent agent + CSRF token is reused for every mutating request.
 *
 * IMPORTANT rate-limit note: aiRateLimiter (5 req/min per IP) is a SINGLE
 * shared bucket for BOTH /:id/ai-draft and /:id/ai-summary (one middleware
 * instance reused across both routes in tickets.ts). With `trust proxy = 1`
 * (app.ts) req.ip is taken from X-Forwarded-For, so the AI describe block
 * below gives every request a fresh IP (freshIp(), same pattern as
 * auth.test.ts/public.test.ts) instead of trying to stay under the shared
 * 5-req/min budget.
 *
 * CSRF note: the global doubleCsrfProtection middleware (app.ts) runs BEFORE
 * any route-specific auth middleware, and only guards non-GET methods. So an
 * unauthenticated mutating request (no cookie, no token) can be rejected by
 * CSRF (403) before it ever reaches `authenticate` (401) — both are correct
 * "rejected" outcomes. This mirrors the existing repo convention (see
 * backup.test.ts's `expect([401, 403]).toContain(res.status)`), used below
 * for every unauthenticated POST/PUT/DELETE test. Unauthenticated GET tests
 * assert exactly 401 (GET is CSRF-exempt).
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-tickets-endpoints.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-tickets-endpoints-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-tickets-endpoints-0123456789abcdef0123456789abcdef';
  // Deliberately NOT setting ANTHROPIC_API_KEY — the AI-gating tests below
  // exercise the real aiEnabled()===false branch (no client mocking).
  delete process.env.ANTHROPIC_API_KEY;
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

type Session = { agent: ReturnType<typeof request.agent>; token: string; csrf: string };

let app: ReturnType<typeof createApp>;

let admin: Session;
let alice: Session; // non-admin "user" — used as ticket owner in some tests
let bob: Session;   // non-admin "user" — used as unrelated stranger

let adminId: string;
let aliceId: string;
let bobId: string;

// A fresh, unique source IP per call. With `trust proxy = 1` (app.ts), req.ip
// is taken from X-Forwarded-For, so this isolates a request from any shared
// rate-limit bucket (used below for the aiRateLimiter-guarded AI endpoints).
// Same pattern as auth.test.ts / public.test.ts.
let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `192.0.2.${(ipCounter % 250) + 1}`; // TEST-NET-1
}

async function login(email: string, password: string): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const token = res.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  return { agent, token, csrf: csrfRes.body.csrfToken as string };
}

function seedTicket(opts: {
  createdBy: string;
  assignedTo?: string | null;
  title?: string;
  status?: string;
  priority?: string;
  requesterId?: string | null;
  categoryId?: string | null;
}): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tickets (id, title, description, status, priority, assigned_to, created_by, requester_id, category_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.title ?? 'Seeded ticket',
    'seeded body',
    opts.status ?? 'open',
    opts.priority ?? 'medium',
    opts.assignedTo === undefined ? null : opts.assignedTo,
    opts.createdBy,
    opts.requesterId ?? null,
    opts.categoryId ?? null
  );
  return id;
}

function seedCategory(label: string): string {
  const id = randomUUID();
  db.prepare('INSERT INTO categories (id, name, label) VALUES (?, ?, ?)').run(id, label, label);
  return id;
}

function seedContact(name: string, email: string): string {
  const id = randomUUID();
  db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)').run(id, name, email);
  return id;
}

beforeAll(async () => {
  initializeDatabase();

  adminId = randomUUID();
  aliceId = randomUUID();
  bobId = randomUUID();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const aliceHash = await bcrypt.hash('Alice-P@ss1234!', 10);
  const bobHash = await bcrypt.hash('Bob-P@ss1234!', 10);

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  );
  insertUser.run(adminId, 'admin@ticketseptest.local', adminHash, 'admin', 'Endpoints Admin');
  insertUser.run(aliceId, 'alice@ticketseptest.local', aliceHash, 'user', 'Endpoints Alice');
  insertUser.run(bobId, 'bob@ticketseptest.local', bobHash, 'user', 'Endpoints Bob');

  app = createApp();

  admin = await login('admin@ticketseptest.local', 'Admin-P@ss1234!');
  alice = await login('alice@ticketseptest.local', 'Alice-P@ss1234!');
  bob = await login('bob@ticketseptest.local', 'Bob-P@ss1234!');
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/tickets/import/preview — admin-only, multer CSV upload', () => {
  it('rejects an unauthenticated request → 401 or 403 (CSRF may fire first)', async () => {
    const res = await request(app).post('/api/tickets/import/preview');
    expect([401, 403]).toContain(res.status);
  });

  it('rejects a non-admin (alice) → 403, even with a valid CSV attached', async () => {
    const res = await alice.agent
      .post('/api/tickets/import/preview')
      .set('Authorization', `Bearer ${alice.token}`)
      .set('x-csrf-token', alice.csrf)
      .attach('file', Buffer.from('title,description\nAlice import,Body'), {
        filename: 'preview.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(403);
  });

  it('rejects a non-CSV file → 400, not 500 (multer fileFilter error)', async () => {
    const res = await admin.agent
      .post('/api/tickets/import/preview')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .attach('file', Buffer.from('%PDF-1.4 not a csv'), { filename: 'sheet.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('rejects a header-only (empty) CSV → 400 "CSV file is empty or invalid"', async () => {
    const res = await admin.agent
      .post('/api/tickets/import/preview')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .attach('file', Buffer.from('title,description,status,priority\n'), {
        filename: 'empty.csv',
        contentType: 'text/csv',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empty or invalid/i);
  });

  it('previews a valid CSV → 200 with total/valid/invalid/duplicates counts', async () => {
    const csv =
      'title,description,status,priority\n' +
      'Preview valid 1,Body text one,open,medium\n' +
      'Preview valid 2,Body text two,in-progress,high\n';
    const res = await admin.agent
      .post('/api/tickets/import/preview')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .attach('file', Buffer.from(csv), { filename: 'valid.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.valid).toBe(2);
    expect(res.body.invalid).toBe(0);
    expect(res.body.duplicates).toBe(0);
    expect(Array.isArray(res.body.results)).toBe(true);
    // Preview does NOT write to the DB.
    expect(db.prepare('SELECT id FROM tickets WHERE title = ?').get('Preview valid 1')).toBeUndefined();
  });

  it('previews a CSV with an invalid row (missing title + bad status) → 200 with invalid=1', async () => {
    const csv = 'title,description,status\n,No title here,bogus-status\n';
    const res = await admin.agent
      .post('/api/tickets/import/preview')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .attach('file', Buffer.from(csv), { filename: 'invalid.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.valid).toBe(0);
    expect(res.body.invalid).toBe(1);
    const row = res.body.results[0];
    expect(row.valid).toBe(false);
    expect(row.errors.some((e: string) => /titel saknas/i.test(e))).toBe(true);
    expect(row.errors.some((e: string) => /ogiltig status/i.test(e))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/tickets/import/confirm — admin-only, DB verification', () => {
  it('rejects an unauthenticated request → 401 or 403 (CSRF may fire first)', async () => {
    const res = await request(app).post('/api/tickets/import/confirm').send({ tickets: [{ title: 'x', description: 'y' }] });
    expect([401, 403]).toContain(res.status);
  });

  it('rejects a non-admin (alice) → 403, ticket is not created', async () => {
    const title = `Alice blocked import ${randomUUID()}`;
    const res = await alice.agent
      .post('/api/tickets/import/confirm')
      .set('Authorization', `Bearer ${alice.token}`)
      .set('x-csrf-token', alice.csrf)
      .send({ tickets: [{ title, description: 'blocked body' }] });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT id FROM tickets WHERE title = ?').get(title)).toBeUndefined();
  });

  it('rejects an empty/missing tickets array → 400', async () => {
    const res1 = await admin.agent
      .post('/api/tickets/import/confirm')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ tickets: [] });
    expect(res1.status).toBe(400);

    const res2 = await admin.agent
      .post('/api/tickets/import/confirm')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({});
    expect(res2.status).toBe(400);
  });

  it('imports valid tickets → 200, created=1, category + auto-created contact resolved', async () => {
    const catId = seedCategory(`ImportKategori-${randomUUID().slice(0, 8)}`);
    const catLabel = db.prepare('SELECT label FROM categories WHERE id = ?').get(catId) as { label: string };
    const title = `Imported ticket ${randomUUID()}`;
    const requesterEmail = `import-${randomUUID()}@ticketseptest.local`;

    const res = await admin.agent
      .post('/api/tickets/import/confirm')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({
        tickets: [
          {
            title,
            description: 'Imported body',
            status: 'open',
            priority: 'medium',
            category: catLabel.label.toUpperCase(), // case-insensitive match
            requester_name: 'Import Contact',
            requester_email: requesterEmail,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(1);
    expect(res.body.failed).toBe(0);

    const row = db.prepare('SELECT category_id, requester_id FROM tickets WHERE title = ?').get(title) as
      | { category_id: string | null; requester_id: string | null }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.category_id).toBe(catId);
    expect(row!.requester_id).toBeTruthy();

    const contact = db.prepare('SELECT email FROM contacts WHERE id = ?').get(row!.requester_id) as { email: string };
    expect(contact.email).toBe(requesterEmail);
  });

  it('rolls back the whole batch on invalid ticket data → 400, no partial insert', async () => {
    const res = await admin.agent
      .post('/api/tickets/import/confirm')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ tickets: [{}] }); // no title/description → undefined bind param throws inside the transaction

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.created).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/tickets/export — XLSX download', () => {
  it('rejects an unauthenticated request → 401', async () => {
    const res = await request(app).get('/api/tickets/export');
    expect(res.status).toBe(401);
  });

  it('returns 200 with XLSX headers and content containing a seeded ticket', async () => {
    const title = `Export XLSX magic ticket ${randomUUID()}`;
    const ticketId = seedTicket({ createdBy: adminId, title, status: 'open' });

    const res = await admin.agent
      .get('/api/tickets/export')
      .set('Authorization', `Bearer ${admin.token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml\.sheet/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/\.xlsx"/);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const ws = wb.worksheets[0];
    let foundId = false;
    ws.eachRow((row) => {
      if (String(row.getCell(1).value) === ticketId) foundId = true;
    });
    expect(foundId).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/tickets/export-archive — lightweight archive XLSX download', () => {
  it('rejects an unauthenticated request → 401', async () => {
    const res = await request(app).get('/api/tickets/export-archive');
    expect(res.status).toBe(401);
  });

  it('rejects an ids param that resolves to no ids → 400', async () => {
    const res = await admin.agent
      .get('/api/tickets/export-archive?ids=,,')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(400);
  });

  it('returns 200 with XLSX headers and content containing a seeded ticket (via ?ids=)', async () => {
    const title = `Archive export magic ticket ${randomUUID()}`;
    const ticketId = seedTicket({ createdBy: adminId, title, status: 'closed' });

    const res = await admin.agent
      .get(`/api/tickets/export-archive?ids=${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml\.sheet/);
    expect(res.headers['content-disposition']).toMatch(/arkiv-export-.*\.xlsx"/);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe('Arkiv');
    let foundTitle = false;
    ws.eachRow((row) => {
      if (String(row.getCell(2).value) === title) foundTitle = true;
    });
    expect(foundTitle).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Dashboard / aggregate smoke endpoints — 401 without auth, 200 + shape with auth', () => {
  it('GET /dashboard-overview → 401 without auth; 200 with plausible shape', async () => {
    const unauth = await request(app).get('/api/tickets/dashboard-overview');
    expect(unauth.status).toBe(401);

    seedTicket({ createdBy: adminId, status: 'open', priority: 'critical', title: `Critical dash ticket ${randomUUID()}` });

    const res = await admin.agent
      .get('/api/tickets/dashboard-overview')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.agingTickets)).toBe(true);
    expect(typeof res.body.todayCounts).toBe('object');
    expect(typeof res.body.criticalCount).toBe('number');
    expect(res.body.criticalCount).toBeGreaterThanOrEqual(1);
  });

  it('GET /activity-feed → 401 without auth; 200 includes a directly-inserted history event', async () => {
    const unauth = await request(app).get('/api/tickets/activity-feed');
    expect(unauth.status).toBe(401);

    const ticketId = seedTicket({ createdBy: adminId, title: `Activity feed ticket ${randomUUID()}` });
    const historyId = randomUUID();
    db.prepare(
      `INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(historyId, ticketId, adminId, 'status', 'open', 'in-progress');

    const res = await admin.agent
      .get('/api/tickets/activity-feed?limit=50')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = (res.body as { id: string; ticket_title: string | null; user_name: string | null }[]).find(
      (e) => e.id === historyId
    );
    expect(found).toBeDefined();
    expect(found!.user_name).toMatch(/Endpoints Admin|admin@ticketseptest\.local/);
  });

  it('GET /status-counts → 401 without auth; 200 with all 5 status keys, reflects seeded tickets', async () => {
    const unauth = await request(app).get('/api/tickets/status-counts');
    expect(unauth.status).toBe(401);

    seedTicket({ createdBy: adminId, status: 'waiting', title: `Waiting status ticket ${randomUUID()}` });
    seedTicket({ createdBy: adminId, status: 'resolved', title: `Resolved status ticket ${randomUUID()}` });

    const res = await admin.agent
      .get('/api/tickets/status-counts')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    for (const key of ['open', 'in-progress', 'waiting', 'resolved', 'closed']) {
      expect(typeof res.body[key]).toBe('number');
    }
    expect(res.body.waiting).toBeGreaterThanOrEqual(1);
    expect(res.body.resolved).toBeGreaterThanOrEqual(1);
  });

  it('GET /requester-open-counts → 401 without auth; 200 reflects an open ticket for a requester', async () => {
    const unauth = await request(app).get('/api/tickets/requester-open-counts');
    expect(unauth.status).toBe(401);

    const contactId = seedContact('Requester Counts Contact', `req-counts-${randomUUID()}@ticketseptest.local`);
    seedTicket({ createdBy: adminId, requesterId: contactId, status: 'open', title: `Requester count ticket ${randomUUID()}` });

    const res = await admin.agent
      .get('/api/tickets/requester-open-counts')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
    expect(res.body[contactId]).toBeGreaterThanOrEqual(1);
  });

  it('GET /upcoming-reminders → 401 without auth; 200 includes a future unsent reminder', async () => {
    const unauth = await request(app).get('/api/tickets/upcoming-reminders');
    expect(unauth.status).toBe(401);

    const ticketId = seedTicket({ createdBy: adminId, title: `Upcoming reminder ticket ${randomUUID()}` });
    const reminderId = randomUUID();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO ticket_reminders (id, ticket_id, user_id, reminder_time, message, sent) VALUES (?, ?, ?, ?, ?, 0)`
    ).run(reminderId, ticketId, adminId, future, 'Don\'t forget');

    const res = await admin.agent
      .get('/api/tickets/upcoming-reminders')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = (res.body as { id: string; ticket_id: string }[]).find((r) => r.id === reminderId);
    expect(found).toBeDefined();
    expect(found!.ticket_id).toBe(ticketId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI endpoints — no ANTHROPIC_API_KEY is set in this test process, so
// aiEnabled() is false for the entire suite. canAccessTicket() is now checked
// BEFORE aiEnabled() in both handlers (server/src/routes/tickets.ts), so the
// 403 branch is reachable without a real/fake ANTHROPIC_API_KEY or mocking
// the Anthropic client — previously an unauthorized caller got a misleading
// 503 (AI disabled) instead of 403 (not allowed), because aiEnabled() ran
// first. Covers: 401 auth gate, 403 access gate (unrelated user on an
// assigned ticket), 404 for a missing ticket, and 503 AI-disabled gate for an
// authorized caller.
//
// Every request below gets its own IP via freshIp() (trust proxy = 1 in
// app.ts honors X-Forwarded-For) so none of these assertions share — or
// exhaust — the single 5-req/min aiRateLimiter bucket that both
// /:id/ai-draft and /:id/ai-summary route through.
describe('AI endpoints — auth, canAccessTicket() 403 boundary, aiEnabled()=false gate', () => {
  let ticketId: string;
  let assignedTicketId: string;

  beforeAll(() => {
    ticketId = seedTicket({ createdBy: adminId, title: `AI endpoint ticket ${randomUUID()}` });
    // Assigned to admin so bob (unrelated, non-admin) hits the 403
    // access-control branch rather than the self-service-pickup exemption
    // that applies to unassigned tickets.
    assignedTicketId = seedTicket({ createdBy: adminId, assignedTo: adminId, title: `AI endpoint assigned ticket ${randomUUID()}` });
  });

  it('POST /:id/ai-draft — unauthenticated → 401 or 403 (CSRF may fire first)', async () => {
    const res = await request(app).post(`/api/tickets/${ticketId}/ai-draft`).set('X-Forwarded-For', freshIp());
    expect([401, 403]).toContain(res.status);
  });

  it('POST /:id/ai-draft — orelaterad användare (bob) på tilldelat ärende → 403 (access-check nu FÖRE aiEnabled)', async () => {
    const res = await bob.agent
      .post(`/api/tickets/${assignedTicketId}/ai-draft`)
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', `Bearer ${bob.token}`)
      .set('x-csrf-token', bob.csrf);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/behörighet/i);
  });

  it('POST /:id/ai-draft — okänt ärende-id → 404', async () => {
    const res = await admin.agent
      .post(`/api/tickets/${randomUUID()}/ai-draft`)
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(404);
  });

  it('POST /:id/ai-draft — authenticated + access OK, AI disabled → 503', async () => {
    const res = await admin.agent
      .post(`/api/tickets/${ticketId}/ai-draft`)
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/inte konfigurerat/i);
  });

  it('GET /:id/ai-summary — unauthenticated → 401', async () => {
    const res = await request(app).get(`/api/tickets/${ticketId}/ai-summary`).set('X-Forwarded-For', freshIp());
    expect(res.status).toBe(401);
  });

  it('GET /:id/ai-summary — orelaterad användare (bob) på tilldelat ärende → 403 (access-check nu FÖRE aiEnabled)', async () => {
    const res = await bob.agent
      .get(`/api/tickets/${assignedTicketId}/ai-summary`)
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/behörighet/i);
  });

  it('GET /:id/ai-summary — okänt ärende-id → 404', async () => {
    const res = await admin.agent
      .get(`/api/tickets/${randomUUID()}/ai-summary`)
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(404);
  });

  it('GET /:id/ai-summary — authenticated + access OK, AI disabled → 503', async () => {
    const res = await admin.agent
      .get(`/api/tickets/${ticketId}/ai-summary`)
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/inte konfigurerat/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Reminders CRUD (POST/GET/DELETE /:id/reminders) + ownership 403 boundary', () => {
  // NOTE: `ticketId` (below) is unassigned, so the canAccessTicket() guard's
  // self-service-pickup exemption applies here — any authenticated user may
  // create/list reminders on it. The 403 access-control boundary for an
  // ASSIGNED ticket + an unrelated user is covered separately, in the
  // 'POST/GET/DELETE .../sent /:id/reminders — authorization (canAccessTicket)'
  // describe block below.
  let ticketId: string;

  beforeAll(() => {
    ticketId = seedTicket({ createdBy: adminId, title: `Reminder CRUD ticket ${randomUUID()}` });
  });

  it('POST /:id/reminders — unauthenticated → 401 or 403 (CSRF may fire first)', async () => {
    const res = await request(app).post(`/api/tickets/${ticketId}/reminders`);
    expect([401, 403]).toContain(res.status);
  });

  it('POST /:id/reminders — missing reminder_time → 400', async () => {
    const res = await bob.agent
      .post(`/api/tickets/${ticketId}/reminders`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('x-csrf-token', bob.csrf)
      .send({ message: 'no time given' });
    expect(res.status).toBe(400);
  });

  it('POST /:id/reminders — reminder_time in the past → 400', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await bob.agent
      .post(`/api/tickets/${ticketId}/reminders`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('x-csrf-token', bob.csrf)
      .send({ reminder_time: past });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/i);
  });

  it('POST /:id/reminders — unknown ticket id → 404', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await bob.agent
      .post(`/api/tickets/${randomUUID()}/reminders`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('x-csrf-token', bob.csrf)
      .send({ reminder_time: future });
    expect(res.status).toBe(404);
  });

  let bobReminderId: string;

  it('POST /:id/reminders — bob (not the ticket owner, but the ticket is UNASSIGNED — self-service pickup applies) creates a reminder → 201', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await bob.agent
      .post(`/api/tickets/${ticketId}/reminders`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('x-csrf-token', bob.csrf)
      .send({ reminder_time: future, message: "Bob's reminder" });
    expect(res.status).toBe(201);
    expect(res.body.ticket_id).toBe(ticketId);
    expect(res.body.message).toBe("Bob's reminder");
    expect(res.body.sent).toBe(0);
    bobReminderId = res.body.id;
  });

  it('GET /:id/reminders — unauthenticated → 401; authenticated → 200 lists the reminder with user_name', async () => {
    const unauth = await request(app).get(`/api/tickets/${ticketId}/reminders`);
    expect(unauth.status).toBe(401);

    const res = await admin.agent
      .get(`/api/tickets/${ticketId}/reminders`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = (res.body as { id: string; user_name: string | null }[]).find((r) => r.id === bobReminderId);
    expect(found).toBeDefined();
    expect(found!.user_name).toBe('Endpoints Bob');
  });

  it('DELETE /:id/reminders/:reminderId — an unrelated non-admin (alice) → 403; reminder untouched', async () => {
    const res = await alice.agent
      .delete(`/api/tickets/${ticketId}/reminders/${bobReminderId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .set('x-csrf-token', alice.csrf);
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT id FROM ticket_reminders WHERE id = ?').get(bobReminderId)).toBeDefined();
  });

  it('DELETE /:id/reminders/:reminderId — unknown reminder id → 404', async () => {
    const res = await admin.agent
      .delete(`/api/tickets/${ticketId}/reminders/${randomUUID()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(404);
  });

  it('DELETE /:id/reminders/:reminderId — the owner (bob) deletes their own reminder → 200', async () => {
    const res = await bob.agent
      .delete(`/api/tickets/${ticketId}/reminders/${bobReminderId}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('x-csrf-token', bob.csrf);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT id FROM ticket_reminders WHERE id = ?').get(bobReminderId)).toBeUndefined();
  });

  it('DELETE /:id/reminders/:reminderId — admin can delete a reminder they do not own', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const create = await bob.agent
      .post(`/api/tickets/${ticketId}/reminders`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('x-csrf-token', bob.csrf)
      .send({ reminder_time: future });
    expect(create.status).toBe(201);
    const reminderId = create.body.id as string;

    const del = await admin.agent
      .delete(`/api/tickets/${ticketId}/reminders/${reminderId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT id FROM ticket_reminders WHERE id = ?').get(reminderId)).toBeUndefined();
  });

  describe('DELETE /:id/reminders/sent — clears only the caller\'s own sent reminders', () => {
    let sentReminderId: string;
    let unsentReminderId: string;

    beforeAll(() => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      sentReminderId = randomUUID();
      db.prepare(
        `INSERT INTO ticket_reminders (id, ticket_id, user_id, reminder_time, sent, sent_at) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`
      ).run(sentReminderId, ticketId, adminId, future);

      unsentReminderId = randomUUID();
      db.prepare(
        `INSERT INTO ticket_reminders (id, ticket_id, user_id, reminder_time, sent) VALUES (?, ?, ?, ?, 0)`
      ).run(unsentReminderId, ticketId, adminId, future);
    });

    it('unauthenticated → 401 or 403 (CSRF may fire first)', async () => {
      const res = await request(app).delete(`/api/tickets/${ticketId}/reminders/sent`);
      expect([401, 403]).toContain(res.status);
    });

    it('a user with no sent reminders on this ticket → 200, deleted=0', async () => {
      const res = await alice.agent
        .delete(`/api/tickets/${ticketId}/reminders/sent`)
        .set('Authorization', `Bearer ${alice.token}`)
        .set('x-csrf-token', alice.csrf);
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(0);
    });

    it('the owning admin → 200, deleted=1; only the sent reminder is removed', async () => {
      const res = await admin.agent
        .delete(`/api/tickets/${ticketId}/reminders/sent`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-csrf-token', admin.csrf);
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(1);

      expect(db.prepare('SELECT id FROM ticket_reminders WHERE id = ?').get(sentReminderId)).toBeUndefined();
      expect(db.prepare('SELECT id FROM ticket_reminders WHERE id = ?').get(unsentReminderId)).toBeDefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST/GET/DELETE .../sent /:id/reminders — authorization (canAccessTicket).
// Mirrors comments.test.ts's authorization block: an unrelated non-admin user
// gets 403 on a ticket assigned to someone else, the assignee (or admin) gets
// through, and a non-existent ticket 404s. Unassigned-ticket self-service
// pickup is already covered above (the 'Reminders CRUD' describe block uses
// an unassigned ticket throughout).
describe('POST/GET/DELETE .../sent /:id/reminders — authorization (canAccessTicket)', () => {
  let assignedTicketId: string;

  beforeAll(() => {
    // Assigned to admin so bob (unrelated, non-admin) hits the 403
    // access-control branch instead of the self-service-pickup exemption.
    assignedTicketId = seedTicket({ createdBy: adminId, assignedTo: adminId, title: `Reminder auth ticket ${randomUUID()}` });
  });

  it('POST returns 403 for an unrelated non-admin user on a ticket assigned to someone else', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await bob.agent
      .post(`/api/tickets/${assignedTicketId}/reminders`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('x-csrf-token', bob.csrf)
      .send({ reminder_time: future });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/behörighet/i);
  });

  it('GET returns 403 for an unrelated non-admin user on a ticket assigned to someone else', async () => {
    const res = await bob.agent
      .get(`/api/tickets/${assignedTicketId}/reminders`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/behörighet/i);
  });

  it('DELETE .../sent returns 403 for an unrelated non-admin user on a ticket assigned to someone else', async () => {
    const res = await bob.agent
      .delete(`/api/tickets/${assignedTicketId}/reminders/sent`)
      .set('Authorization', `Bearer ${bob.token}`)
      .set('x-csrf-token', bob.csrf);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/behörighet/i);
  });

  it('POST/GET return 201/200 for the assignee (admin) on the same assigned ticket', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const postRes = await admin.agent
      .post(`/api/tickets/${assignedTicketId}/reminders`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ reminder_time: future });
    expect(postRes.status).toBe(201);

    const getRes = await admin.agent
      .get(`/api/tickets/${assignedTicketId}/reminders`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(getRes.status).toBe(200);
  });

  it('returns 404 for a non-existent ticket on POST, GET, and DELETE .../sent', async () => {
    const nonExistentId = randomUUID();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const postRes = await admin.agent
      .post(`/api/tickets/${nonExistentId}/reminders`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ reminder_time: future });
    expect(postRes.status).toBe(404);

    const getRes = await admin.agent
      .get(`/api/tickets/${nonExistentId}/reminders`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(getRes.status).toBe(404);

    const deleteSentRes = await admin.agent
      .delete(`/api/tickets/${nonExistentId}/reminders/sent`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(deleteSentRes.status).toBe(404);
  });
});
