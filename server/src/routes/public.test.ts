import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for server/src/routes/public.ts — the ONLY unauthenticated
 * API surface in IT-Ticket (public ticket-submission form). Audit finding
 * M25: this route had 7.4% coverage and no test file.
 *
 * Coverage:
 *  1. POST /tickets — happy path (ticket + contact), validation, and the
 *     in-memory Idempotency-Key store (same key → same ticket, no duplicate row;
 *     different keys → two tickets; TTL expiry → a fresh ticket after 5 min).
 *  2. Rate limiting — publicWriteRateLimiter (30/min) guards POST /tickets.
 *  3. CSRF exemption — /api/public/* is listed in app.ts's
 *     csrfExemptPrefixes; mutating calls with NO x-csrf-token header must
 *     still succeed (this is asserted implicitly by every test above, which
 *     never sets that header, and explicitly in its own describe block below).
 *
 * Bootstrap ordering follows the repo pattern (see contacts.test.ts /
 * auth.test.ts): vi.hoisted() sets a UNIQUE DB_PATH + 32+ char secrets BEFORE
 * any import pulls in db/connection.ts (a module-level singleton).
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-public-test-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-public-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-public-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;

// A fresh, unique source IP per call. With `trust proxy = 1` (app.ts), req.ip
// is taken from X-Forwarded-For, so this isolates each functional-test request
// into its own rate-limit bucket — the suite stays deterministic regardless of
// test count/order (same pattern as auth.test.ts).
let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 250) + 1}`; // TEST-NET-3
}

function validTicketBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Testina Testsson',
    email: `contact-${randomUUID()}@publictest.local`,
    title: `Skrivaren fungerar inte ${randomUUID()}`,
    description: 'Skrivaren på plan 2 ger felkod E04 vid utskrift.',
    ...overrides,
  };
}

beforeAll(() => {
  initializeDatabase();
  app = createApp();
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

// Guard against any fake-timer test leaking into the next one.
afterEach(() => {
  vi.useRealTimers();
});

// ───────────────────────────────────────────────────────────────────────────
// 1. POST /api/public/tickets — happy path + validation
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/public/tickets', () => {
  it('creates a ticket and a new contact when the email is unseen → 201', async () => {
    const body = validTicketBody();
    const res = await request(app)
      .post('/api/public/tickets')
      .set('X-Forwarded-For', freshIp())
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.ticketId).toBeDefined();
    expect(res.body.message).toBe('Ticket submitted successfully');

    const ticket = db.prepare('SELECT id, title, description, status, priority FROM tickets WHERE id = ?')
      .get(res.body.ticketId) as { id: string; title: string; description: string; status: string; priority: string } | undefined;
    expect(ticket).toBeDefined();
    expect(ticket!.title).toBe(body.title);
    expect(ticket!.description).toBe(body.description);
    expect(ticket!.status).toBe('open');
    expect(ticket!.priority).toBe('medium'); // default when no priority sent

    const contact = db.prepare('SELECT id, name FROM contacts WHERE email = ?').get(body.email) as { id: string; name: string } | undefined;
    expect(contact).toBeDefined();
    expect(contact!.name).toBe(body.name);
  });

  it('reuses an existing contact when the email already exists (no duplicate contact row)', async () => {
    const email = `repeat-${randomUUID()}@publictest.local`;

    const first = await request(app)
      .post('/api/public/tickets')
      .set('X-Forwarded-For', freshIp())
      .send(validTicketBody({ email, name: 'Först Sson' }));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/public/tickets')
      .set('X-Forwarded-For', freshIp())
      .send(validTicketBody({ email, name: 'Andra Gången' }));
    expect(second.status).toBe(201);
    expect(second.body.ticketId).not.toBe(first.body.ticketId);

    const contacts = db.prepare('SELECT id FROM contacts WHERE email = ?').all(email) as { id: string }[];
    expect(contacts).toHaveLength(1);

    const tickets = db.prepare('SELECT requester_id FROM tickets WHERE id IN (?, ?)').all(first.body.ticketId, second.body.ticketId) as { requester_id: string }[];
    expect(tickets).toHaveLength(2);
    expect(tickets[0].requester_id).toBe(contacts[0].id);
    expect(tickets[1].requester_id).toBe(contacts[0].id);
  });

  it('accepts customFields in place of a description → 201, composes the description from them', async () => {
    const body = validTicketBody({
      description: undefined,
      customFields: [
        { fieldName: 'room', fieldLabel: 'Rum', fieldValue: 'B204' },
        { fieldName: 'urgent', fieldLabel: 'Brådskande', fieldValue: 'Ja' },
      ],
    });
    const res = await request(app)
      .post('/api/public/tickets')
      .set('X-Forwarded-For', freshIp())
      .send(body);

    expect(res.status).toBe(201);
    const ticket = db.prepare('SELECT description FROM tickets WHERE id = ?').get(res.body.ticketId) as { description: string };
    expect(ticket.description).toContain('Rum');
    expect(ticket.description).toContain('B204');

    const fieldRows = db.prepare('SELECT field_label, field_value FROM ticket_field_values WHERE ticket_id = ?').all(res.body.ticketId) as { field_label: string; field_value: string }[];
    expect(fieldRows).toHaveLength(2);
  });

  // ─── customFields sanitization & caps ────────────────────────────────────
  // Security fix: the customFields path used to store field_label/field_value
  // (and the composed description built from them) completely unsanitized,
  // unlike name/title/description which always went through
  // sanitizePlainText/sanitizeRichText. It also had no cap on field count or
  // field lengths, unlike the 5000-char description cap right above.
  describe('customFields sanitization & caps', () => {
    it('sanitizes fieldLabel/fieldValue before storing — no raw HTML/script survives in DB', async () => {
      const body = validTicketBody({
        description: undefined,
        customFields: [
          { fieldName: 'note', fieldLabel: '<b>Rum</b>', fieldValue: '<script>alert(1)</script>B204' },
        ],
      });
      const res = await request(app)
        .post('/api/public/tickets')
        .set('X-Forwarded-For', freshIp())
        .send(body);

      expect(res.status).toBe(201);

      const fieldRows = db.prepare('SELECT field_label, field_value FROM ticket_field_values WHERE ticket_id = ?').all(res.body.ticketId) as { field_label: string; field_value: string }[];
      expect(fieldRows).toHaveLength(1);
      expect(fieldRows[0].field_label).toBe('Rum');
      expect(fieldRows[0].field_value).toBe('B204'); // sanitizePlainText strips <script> AND its content

      const ticket = db.prepare('SELECT description FROM tickets WHERE id = ?').get(res.body.ticketId) as { description: string };
      expect(ticket.description).not.toContain('<script>');
      expect(ticket.description).not.toContain('<b>');
      expect(ticket.description).toContain('Rum');
      expect(ticket.description).toContain('B204');
    });

    it('400 when more than 30 customFields are submitted', async () => {
      const body = validTicketBody({
        description: undefined,
        customFields: Array.from({ length: 31 }, (_, i) => ({
          fieldName: `field${i}`,
          fieldLabel: `Fält ${i}`,
          fieldValue: 'x',
        })),
      });
      const res = await request(app)
        .post('/api/public/tickets')
        .set('X-Forwarded-For', freshIp())
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/30 custom fields/i);
    });

    it('400 when a fieldValue exceeds 2000 characters', async () => {
      const body = validTicketBody({
        description: undefined,
        customFields: [
          { fieldName: 'note', fieldLabel: 'Anteckning', fieldValue: 'x'.repeat(2001) },
        ],
      });
      const res = await request(app)
        .post('/api/public/tickets')
        .set('X-Forwarded-For', freshIp())
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/2000 characters/i);
    });

    it('400 (not 500) when fieldLabel/fieldValue/fieldName are non-strings — type confusion must not reach the sanitizer', async () => {
      // Objekt/array/boolean kringgick tidigare längd-capsen (typeof-gate) och
      // kraschade sanitize-html till en opak 500. Nu ska alla tre avvisas rent.
      const cases = [
        { fieldName: 'x', fieldLabel: {}, fieldValue: 'y' },
        { fieldName: 'x', fieldLabel: 'Etikett', fieldValue: ['a', 'b'] },
        { fieldName: true, fieldLabel: 'Etikett', fieldValue: 'y' },
      ];
      for (const badField of cases) {
        const res = await request(app)
          .post('/api/public/tickets')
          .set('X-Forwarded-For', freshIp())
          .send(validTicketBody({ description: undefined, customFields: [badField] }));
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/must be a string/i);
      }
    });

    it('400 when the composed description from customFields exceeds 5000 characters', async () => {
      // Individual fields stay under the per-field cap (2000) but enough of
      // them push the composed finalDescription over the 5000-char limit.
      const body = validTicketBody({
        description: undefined,
        customFields: Array.from({ length: 4 }, (_, i) => ({
          fieldName: `field${i}`,
          fieldLabel: `Fält ${i}`,
          fieldValue: 'x'.repeat(1500),
        })),
      });
      const res = await request(app)
        .post('/api/public/tickets')
        .set('X-Forwarded-For', freshIp())
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/5000 characters/i);
    });
  });

  it('400 when name, email or title is missing', async () => {
    const res = await request(app)
      .post('/api/public/tickets')
      .set('X-Forwarded-For', freshIp())
      .send({ description: 'Ofullständigt formulär' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Name, email, and title/i);
  });

  it('400 when neither description nor customFields is provided', async () => {
    const res = await request(app)
      .post('/api/public/tickets')
      .set('X-Forwarded-For', freshIp())
      .send(validTicketBody({ description: undefined, customFields: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description or custom fields/i);
  });

  it('400 when the email format is invalid', async () => {
    const res = await request(app)
      .post('/api/public/tickets')
      .set('X-Forwarded-For', freshIp())
      .send(validTicketBody({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid email format/i);
  });

  // ─── Idempotency-Key ────────────────────────────────────────────────────
  describe('Idempotency-Key', () => {
    it('the same key submitted twice returns the same ticketId and inserts only one ticket row', async () => {
      const key = `idem-${randomUUID()}`;
      const body = validTicketBody();

      const first = await request(app)
        .post('/api/public/tickets')
        .set('X-Forwarded-For', freshIp())
        .set('Idempotency-Key', key)
        .send(body);
      expect(first.status).toBe(201);

      const second = await request(app)
        .post('/api/public/tickets')
        .set('X-Forwarded-For', freshIp())
        .set('Idempotency-Key', key)
        // Even a DIFFERENT body must be ignored — the store short-circuits
        // before any validation/DB work runs.
        .send(validTicketBody({ title: 'Helt annan titel', email: `other-${randomUUID()}@publictest.local` }));
      expect(second.status).toBe(201);
      expect(second.body.ticketId).toBe(first.body.ticketId);

      const rows = db.prepare('SELECT id FROM tickets WHERE title = ?').all(body.title) as { id: string }[];
      expect(rows).toHaveLength(1);
    });

    it('different keys create two distinct tickets', async () => {
      const bodyA = validTicketBody();
      const bodyB = validTicketBody();

      const resA = await request(app)
        .post('/api/public/tickets')
        .set('X-Forwarded-For', freshIp())
        .set('Idempotency-Key', `idem-${randomUUID()}`)
        .send(bodyA);
      const resB = await request(app)
        .post('/api/public/tickets')
        .set('X-Forwarded-For', freshIp())
        .set('Idempotency-Key', `idem-${randomUUID()}`)
        .send(bodyB);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      expect(resA.body.ticketId).not.toBe(resB.body.ticketId);
    });

    it('a key reused after the 5-minute TTL expires creates a NEW ticket instead of returning the stale one', async () => {
      const key = `idem-ttl-${randomUUID()}`;
      const body = validTicketBody();

      const realNow = Date.now();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(realNow);

      try {
        const first = await request(app)
          .post('/api/public/tickets')
          .set('X-Forwarded-For', freshIp())
          .set('Idempotency-Key', key)
          .send(body);
        expect(first.status).toBe(201);

        // Jump past the 5-minute TTL (IDEMPOTENCY_TTL_MS in public.ts).
        vi.setSystemTime(realNow + 5 * 60 * 1000 + 1_000);

        const second = await request(app)
          .post('/api/public/tickets')
          .set('X-Forwarded-For', freshIp())
          .set('Idempotency-Key', key)
          .send(body);
        expect(second.status).toBe(201);
        expect(second.body.ticketId).not.toBe(first.body.ticketId);

        const rows = db.prepare('SELECT id FROM tickets WHERE title = ?').all(body.title) as { id: string }[];
        expect(rows).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── Rate limiting: publicWriteRateLimiter (30/min per IP) ───────────────
  describe('rate limiting', () => {
    it('allows 30 requests per IP, then 429s on the 31st', async () => {
      const RATE_LIMIT_IP = '192.0.2.201'; // TEST-NET-1, dedicated to this test only
      const statuses: number[] = [];

      for (let i = 0; i < 31; i++) {
        // Deliberately invalid body (cheap 400) — the limiter runs BEFORE
        // handler validation, so it still consumes the rate-limit budget
        // without writing 30 ticket rows to the DB.
        const res = await request(app)
          .post('/api/public/tickets')
          .set('X-Forwarded-For', RATE_LIMIT_IP)
          .send({});
        statuses.push(res.status);
      }

      expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
      expect(statuses[30]).toBe(429);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. CSRF exemption — /api/public/* invariant (app.ts csrfExemptPrefixes)
// ───────────────────────────────────────────────────────────────────────────
describe('CSRF exemption for /api/public/*', () => {
  it('POST /tickets succeeds with no x-csrf-token header and no CSRF cookie', async () => {
    const res = await request(app)
      .post('/api/public/tickets')
      .set('X-Forwarded-For', freshIp())
      // Explicitly NOT setting x-csrf-token — a non-exempt mutating route
      // would reject this with 403 EBADCSRFTOKEN.
      .send(validTicketBody());

    expect(res.status).toBe(201);
  });
});
