import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * HTTP integration tests for the tickets routes (server/src/routes/tickets.ts).
 *
 * Covers the audit-v3 MEDIUM gap (tickets.ts had no route tests) plus core CRUD:
 *  1. Create → read → update → delete happy path (admin).
 *  2. PUT /:id input-length validation (title >200, description/notes/solution
 *     >5000 → 400; valid lengths → 200). NB: the length check runs BEFORE the
 *     existence/authorization check, so we target an existing ticket.
 *  3. PUT /bulk: returns { updated, skipped }; a non-admin bulk-updating a mix of
 *     accessible + inaccessible tickets gets the inaccessible ids in `skipped`,
 *     only accessible ones updated. Unassigned tickets stay updatable (pickup).
 *  4. POST /bulk-delete (admin): accurate `deleted` count; an already-gone id is
 *     reported via `alreadyGone` with no 500.
 *  5. Visibility/access: GET list + GET /:id do NOT filter by ticket access — any
 *     authenticated user can read any ticket (asserts the ACTUAL handler
 *     behavior). The access gate lives on PUT /:id instead (assigned tickets).
 *  6. Custom-field round-trip + no new SLA deadlines; historical SLA is preserved.
 *
 * Harness mirrors checklists.test.ts / app.test.ts: a UNIQUE DB_PATH (-tickets
 * suffix) is set in vi.hoisted() BEFORE any import that pulls in db/connection.ts.
 * Login is rate-limited (5/15min per IP) so each user logs in exactly ONCE and
 * the persistent csrf-agent is reused for every mutating request.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-tickets.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-tickets-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-tickets-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

type Session = { agent: ReturnType<typeof request.agent>; token: string; csrf: string };

let app: ReturnType<typeof createApp>;

let admin: Session;
let alice: Session; // non-admin "user"
let bob: Session;   // non-admin "user"

let adminId: string;
let aliceId: string;
let bobId: string;

// One login per user (login is rate-limited to 5/15min per IP). The persistent
// agent keeps the csrf cookie; the x-csrf-token header is needed for mutations.
async function login(email: string, password: string): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const token = res.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  return { agent, token, csrf: csrfRes.body.csrfToken as string };
}

// Insert a ticket directly (bypasses the API). Returns the new id.
function seedTicket(opts: { createdBy: string; assignedTo?: string | null; title?: string }): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tickets (id, title, description, status, priority, assigned_to, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.title ?? 'Seeded ticket',
    'seeded body',
    'open',
    'medium',
    opts.assignedTo === undefined ? null : opts.assignedTo,
    opts.createdBy
  );
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
  insertUser.run(adminId, 'admin@ticketstest.local', adminHash, 'admin', 'Tickets Admin');
  insertUser.run(aliceId, 'alice@ticketstest.local', aliceHash, 'user', 'Alice');
  insertUser.run(bobId, 'bob@ticketstest.local', bobHash, 'user', 'Bob');

  app = createApp();

  admin = await login('admin@ticketstest.local', 'Admin-P@ss1234!');
  alice = await login('alice@ticketstest.local', 'Alice-P@ss1234!');
  bob = await login('bob@ticketstest.local', 'Bob-P@ss1234!');
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Ticket CRUD happy path (admin)', () => {
  let ticketId: string;

  it('creates a ticket (POST /) → 201 with documented fields', async () => {
    const res = await admin.agent
      .post('/api/tickets')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ title: 'CRUD ticket', description: 'created by admin', priority: 'high' });

    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.title).toBe('CRUD ticket');
    expect(res.body.status).toBe('open');     // default
    expect(res.body.priority).toBe('high');
    ticketId = res.body.id;
  });

  it('reads it back (GET /:id) → 200', async () => {
    const res = await admin.agent
      .get(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ticketId);
    expect(res.body.title).toBe('CRUD ticket');
  });

  it('updates it (PUT /:id) → 200 and persists', async () => {
    const put = await admin.agent
      .put(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ title: 'CRUD ticket (edited)', status: 'in-progress' });
    expect(put.status).toBe(200);
    expect(put.body.title).toBe('CRUD ticket (edited)');
    expect(put.body.status).toBe('in-progress');

    const get = await admin.agent
      .get(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(get.body.title).toBe('CRUD ticket (edited)');
    expect(get.body.status).toBe('in-progress');
  });

  it('deletes it (DELETE /:id) → 200, then GET → 404', async () => {
    const del = await admin.agent
      .delete(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(del.status).toBe(200);
    expect(del.body.message).toMatch(/deleted/i);

    const get = await admin.agent
      .get(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(get.status).toBe(404);
  });

  it('DELETE /:id on an unknown id → 404', async () => {
    const del = await admin.agent
      .delete(`/api/tickets/${randomUUID()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(del.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /:id — input-length validation', () => {
  // Length validation runs before the existence/auth check, but to keep the test
  // honest about end-to-end behavior we target a real admin-owned ticket.
  let ticketId: string;

  beforeAll(() => {
    ticketId = seedTicket({ createdBy: adminId, title: 'Length validation target' });
  });

  it('rejects title > 200 chars → 400', async () => {
    const res = await admin.agent
      .put(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ title: 'x'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/200 characters/i);
  });

  it('rejects description > 5000 chars → 400', async () => {
    const res = await admin.agent
      .put(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ description: 'd'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5000 characters/i);
  });

  it('rejects notes > 5000 chars → 400', async () => {
    const res = await admin.agent
      .put(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ notes: 'n'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5000 characters/i);
  });

  it('rejects solution > 5000 chars → 400', async () => {
    const res = await admin.agent
      .put(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ solution: 's'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5000 characters/i);
  });

  it('accepts values at the boundary (title 200, others 5000) → 200', async () => {
    const res = await admin.agent
      .put(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({
        title: 'x'.repeat(200),
        description: 'd'.repeat(5000),
        notes: 'n'.repeat(5000),
        solution: 's'.repeat(5000),
      });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('x'.repeat(200));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /bulk — { updated, skipped } with access filtering', () => {
  it('returns the new { updated, skipped } shape and updates accessible tickets', async () => {
    // alice owns this ticket (created_by) → accessible to alice.
    const ownTicket = seedTicket({ createdBy: aliceId, assignedTo: aliceId });

    const res = await alice.agent
      .put('/api/tickets/bulk')
      .set('Authorization', `Bearer ${alice.token}`)
      .set('x-csrf-token', alice.csrf)
      .send({ ids: [ownTicket], updates: { status: 'in-progress' } });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('updated');
    expect(res.body).toHaveProperty('skipped');
    expect(res.body.updated).toBe(1);
    expect(res.body.skipped).toEqual([]);

    const row = db.prepare('SELECT status FROM tickets WHERE id = ?').get(ownTicket) as { status: string };
    expect(row.status).toBe('in-progress');
  });

  it('skips tickets the non-admin caller cannot access; updates the accessible ones', async () => {
    // Accessible to alice (she is the assignee).
    const accessible = seedTicket({ createdBy: bobId, assignedTo: aliceId });
    // Inaccessible to alice: owned by + assigned to bob, no relation to alice.
    const inaccessible = seedTicket({ createdBy: bobId, assignedTo: bobId });

    const res = await alice.agent
      .put('/api/tickets/bulk')
      .set('Authorization', `Bearer ${alice.token}`)
      .set('x-csrf-token', alice.csrf)
      .send({ ids: [accessible, inaccessible], updates: { priority: 'high' } });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.skipped).toEqual([inaccessible]);

    const accRow = db.prepare('SELECT priority FROM tickets WHERE id = ?').get(accessible) as { priority: string };
    const inaccRow = db.prepare('SELECT priority FROM tickets WHERE id = ?').get(inaccessible) as { priority: string };
    expect(accRow.priority).toBe('high');     // updated
    expect(inaccRow.priority).toBe('medium'); // untouched
  });

  it('lets a non-admin update an UNASSIGNED ticket they have no relation to (self-service pickup)', async () => {
    // Created by bob, assigned to nobody → open for pickup by any agent.
    const unassigned = seedTicket({ createdBy: bobId, assignedTo: null });

    const res = await alice.agent
      .put('/api/tickets/bulk')
      .set('Authorization', `Bearer ${alice.token}`)
      .set('x-csrf-token', alice.csrf)
      .send({ ids: [unassigned], updates: { status: 'in-progress' } });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.skipped).toEqual([]);

    const row = db.prepare('SELECT status FROM tickets WHERE id = ?').get(unassigned) as { status: string };
    expect(row.status).toBe('in-progress');
  });

  it('rejects an empty ids array → 400', async () => {
    const res = await alice.agent
      .put('/api/tickets/bulk')
      .set('Authorization', `Bearer ${alice.token}`)
      .set('x-csrf-token', alice.csrf)
      .send({ ids: [], updates: { status: 'open' } });
    expect(res.status).toBe(400);
  });

  it('rejects when no update fields are provided → 400', async () => {
    const t = seedTicket({ createdBy: aliceId, assignedTo: aliceId });
    const res = await alice.agent
      .put('/api/tickets/bulk')
      .set('Authorization', `Bearer ${alice.token}`)
      .set('x-csrf-token', alice.csrf)
      .send({ ids: [t], updates: {} });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /bulk-delete — admin, accurate count, no 500 on already-gone', () => {
  it('deletes existing tickets and returns an accurate count', async () => {
    const a = seedTicket({ createdBy: adminId });
    const b = seedTicket({ createdBy: adminId });

    const res = await admin.agent
      .post('/api/tickets/bulk-delete')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ ids: [a, b] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);

    expect(db.prepare('SELECT id FROM tickets WHERE id = ?').get(a)).toBeUndefined();
    expect(db.prepare('SELECT id FROM tickets WHERE id = ?').get(b)).toBeUndefined();
  });

  it('counts only really-deleted rows when an id is already gone (no 500)', async () => {
    const existing = seedTicket({ createdBy: adminId });
    const ghost = randomUUID(); // never existed → already "gone"

    const res = await admin.agent
      .post('/api/tickets/bulk-delete')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ ids: [existing, ghost] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);        // only the real one
    expect(res.body.alreadyGone).toBe(1);    // the ghost id reflected, not a 500
  });

  it('rejects a non-admin (requireAdmin) → 403', async () => {
    const t = seedTicket({ createdBy: adminId });
    const res = await alice.agent
      .post('/api/tickets/bulk-delete')
      .set('Authorization', `Bearer ${alice.token}`)
      .set('x-csrf-token', alice.csrf)
      .send({ ids: [t] });
    expect(res.status).toBe(403);
    // Ticket must still exist — the request was rejected before deletion.
    expect(db.prepare('SELECT id FROM tickets WHERE id = ?').get(t)).toBeDefined();
  });

  it('rejects an empty ids array → 400', async () => {
    const res = await admin.agent
      .post('/api/tickets/bulk-delete')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Read visibility — GET list/detail do NOT filter by ticket access', () => {
  // ACTUAL behavior: neither GET / nor GET /:id call canAccessTicket. Any
  // authenticated user can read any ticket. The access gate is on PUT /:id (for
  // assigned tickets) — verified separately below.
  let bobsTicketId: string;

  beforeAll(() => {
    bobsTicketId = seedTicket({ createdBy: bobId, assignedTo: bobId, title: "Bob's private ticket" });
  });

  it('a stranger (alice) CAN read another user\'s ticket detail → 200 (no read-side ACL)', async () => {
    const res = await alice.agent
      .get(`/api/tickets/${bobsTicketId}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(bobsTicketId);
  });

  it('a stranger (alice) sees the ticket in the GET list too', async () => {
    const res = await alice.agent
      .get('/api/tickets')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(200);
    // Non-paginated list returns a bare array (backward-compat path).
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as { id: string }[]).some((t) => t.id === bobsTicketId)).toBe(true);
  });

  it('GET /:id requires authentication → 401 without a token', async () => {
    const res = await request(app).get(`/api/tickets/${bobsTicketId}`);
    expect(res.status).toBe(401);
  });

  it('a non-admin CANNOT update an assigned ticket they have no relation to → 403 (write-side ACL)', async () => {
    const res = await alice.agent
      .put(`/api/tickets/${bobsTicketId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .set('x-csrf-token', alice.csrf)
      .send({ status: 'in-progress' });
    expect(res.status).toBe(403);
    // Unchanged in the DB.
    const row = db.prepare('SELECT status FROM tickets WHERE id = ?').get(bobsTicketId) as { status: string };
    expect(row.status).toBe('open');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Custom fields round-trip + retired SLA', () => {
  it('persists customFields and returns them via GET /:id', async () => {
    const res = await admin.agent
      .post('/api/tickets')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({
        title: 'Ticket with custom fields',
        // No description: create requires description OR customFields.
        customFields: [
          { fieldName: 'os', fieldLabel: 'Operativsystem', fieldValue: 'Windows 11' },
          { fieldName: 'asset', fieldLabel: 'Tillgångs-ID', fieldValue: 'PC-4711' },
        ],
        priority: 'medium',
      });
    expect(res.status).toBe(201);
    const id = res.body.id as string;

    const get = await admin.agent
      .get(`/api/tickets/${id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(get.status).toBe(200);
    const fields = get.body.field_values as { field_name: string; field_label: string; field_value: string }[];
    expect(Array.isArray(fields)).toBe(true);
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field_name: 'os', field_label: 'Operativsystem', field_value: 'Windows 11' }),
        expect.objectContaining({ field_name: 'asset', field_label: 'Tillgångs-ID', field_value: 'PC-4711' }),
      ])
    );
    // Description is composed from the custom fields (incoming description ignored).
    expect(get.body.description).toContain('Operativsystem');
    expect(get.body.description).toContain('Windows 11');
  });

  it('does not apply historical SLA policies to newly created tickets', async () => {
    const res = await admin.agent
      .post('/api/tickets')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ title: 'SLA ticket', description: 'has SLA', priority: 'critical' });
    expect(res.status).toBe(201);
    const id = res.body.id as string;

    // Historical policies remain in the database, but are no longer applied.
    const row = db.prepare(
      'SELECT sla_response_deadline, sla_resolution_deadline FROM tickets WHERE id = ?'
    ).get(id) as { sla_response_deadline: string | null; sla_resolution_deadline: string | null };
    expect(row.sla_response_deadline).toBeNull();
    expect(row.sla_resolution_deadline).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Existing SLA data stays unchanged while tickets continue to work normally.
describe('Retired SLA history', () => {
  it.each([
    { status: 'in-progress' },
    { status: 'waiting' },
    { status: 'resolved' },
    { priority: 'critical' },
  ])('preserves historical SLA fields on ticket update %j', async (updates) => {
    const create = await admin.agent.post('/api/tickets')
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf)
      .send({ title: 'Historical SLA', description: 'Preserve stored history', priority: 'medium' });
    expect(create.status).toBe(201);
    const id = create.body.id as string;
    db.prepare(`UPDATE tickets SET sla_response_deadline = '2026-01-01T00:00:00.000Z',
      sla_resolution_deadline = '2026-01-02T00:00:00.000Z', sla_response_met = 1,
      sla_paused_duration = 15 WHERE id = ?`).run(id);
    const readHistory = () => db.prepare(`SELECT sla_response_deadline, sla_resolution_deadline,
      sla_response_met, sla_resolution_met, sla_paused_at, sla_paused_duration FROM tickets WHERE id = ?`).get(id);
    const before = readHistory();
    const result = await admin.agent.put(`/api/tickets/${id}`)
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf).send(updates);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject(updates);
    expect(readHistory()).toEqual(before);
  });

  it('preserves historical deadlines during bulk priority updates', async () => {
    const create = await admin.agent.post('/api/tickets')
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf)
      .send({ title: 'Bulk history', description: 'Preserve SLA', priority: 'low' });
    expect(create.status).toBe(201);
    const id = create.body.id as string;
    const deadline = '2026-01-01T00:00:00.000Z';
    db.prepare('UPDATE tickets SET sla_response_deadline = ? WHERE id = ?').run(deadline, id);
    const result = await admin.agent.put('/api/tickets/bulk')
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf)
      .send({ ids: [id], updates: { priority: 'critical' } });
    expect(result.status).toBe(200);
    expect(result.body.updated).toBe(1);
    expect(db.prepare('SELECT priority, sla_response_deadline FROM tickets WHERE id = ?').get(id))
      .toEqual({ priority: 'critical', sla_response_deadline: deadline });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M10-tickets regression: upload.single('file') was mounted directly as route
// middleware, so a multer fileFilter rejection (wrong file type) threw past the
// route handler's try/catch and fell through to Express's default error
// handler → 500. Now wrapped manually (mirrors attachments.ts) → 400.
describe('POST /api/tickets/import/preview — multer error handling (M10-tickets)', () => {
  it('rejects a non-CSV file → 400, not 500 (multer fileFilter error)', async () => {
    const res = await admin.agent
      .post('/api/tickets/import/preview')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .attach('file', Buffer.from('not a csv, just plain text'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});


describe('Retired ticket tags and shared knowledge-base tags', () => {
  it('keeps categories, ignores legacy ticket tags and preserves stored associations', async () => {
    const tagId = randomUUID();
    const categoryId = randomUUID();
    db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(tagId, `legacy-${tagId}`, '#123456');
    db.prepare('INSERT INTO categories (id, name, label) VALUES (?, ?, ?)').run(categoryId, 'retired-category', 'Category after tag retirement');
    // Ensure a former auto-tag keyword has a matching shared tag.
    db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)').run(randomUUID(), 'dator', '#123456');
    const created = await admin.agent.post('/api/tickets')
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf)
      .send({ title: 'Dator och telefon', description: 'Still uses categories', category_id: categoryId, tag_ids: [tagId] });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(db.prepare('SELECT COUNT(*) AS count FROM ticket_tags WHERE ticket_id = ?').get(id)).toEqual({ count: 0 });
    const linkId = randomUUID();
    db.prepare('INSERT INTO ticket_tags (id, ticket_id, tag_id) VALUES (?, ?, ?)').run(linkId, id, tagId);
    const updated = await admin.agent.put(`/api/tickets/${id}`)
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf)
      .send({ title: 'Updated historical ticket', category_id: categoryId, tag_ids: [] });
    expect(updated.status).toBe(200);
    expect(updated.body.category_id).toBe(categoryId);
    expect(db.prepare('SELECT id, tag_id FROM ticket_tags WHERE ticket_id = ?').get(id)).toEqual({ id: linkId, tag_id: tagId });
    const list = await admin.agent.get(`/api/tickets?limit=100&category=${categoryId}&tags=nonexistent&tagMode=and`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((ticket: { id: string }) => ticket.id)).toContain(id);
    const retired = await admin.agent.get('/api/reports/tag-analytics').set('Authorization', `Bearer ${admin.token}`);
    expect(retired.status).toBe(404);
    const deletion = await admin.agent.delete(`/api/tags/${tagId}`)
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf);
    expect(deletion.status).toBe(409);
    expect(db.prepare('SELECT tag_id FROM ticket_tags WHERE id = ?').get(linkId)).toEqual({ tag_id: tagId });

  });

  it('preserves historical recurring tags on updates and blocks deletion of referenced tags', async () => {
    const tagId = randomUUID();
    db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(tagId, `recurring-${tagId}`, '#123456');
    const created = await admin.agent.post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf)
      .send({ name: 'Historical schedule', title: 'Recurring task', interval_type: 'daily' });
    expect(created.status).toBe(201);
    const tags = JSON.stringify([tagId]);
    db.prepare('UPDATE recurring_templates SET tags = ? WHERE id = ?').run(tags, created.body.id);
    const update = await admin.agent.put(`/api/recurring/${created.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf)
      .send({ name: 'Renamed schedule', tags: [] });
    expect(update.status).toBe(200);
    expect(db.prepare('SELECT tags FROM recurring_templates WHERE id = ?').get(created.body.id)).toEqual({ tags });
    const deletion = await admin.agent.delete(`/api/tags/${tagId}`)
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf);
    expect(deletion.status).toBe(409);
    expect(db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId)).toEqual({ id: tagId });
  });

  it('still creates shared tags and associates them with knowledge-base articles', async () => {
    const tag = await admin.agent.post('/api/tags')
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf)
      .send({ name: `kb-preserved-${randomUUID()}`, color: '#123456' });
    expect(tag.status).toBe(201);
    const categoryId = randomUUID();
    db.prepare('INSERT INTO kb_categories (id, name) VALUES (?, ?)').run(categoryId, 'Preserved KB category');
    const article = await admin.agent.post('/api/kb/articles')
      .set('Authorization', `Bearer ${admin.token}`).set('x-csrf-token', admin.csrf)
      .send({ title: 'KB tags still work', category_id: categoryId, content: '<p>Help</p>', tag_ids: [tag.body.id] });
    expect(article.status).toBe(201);
    expect(db.prepare('SELECT tag_id FROM kb_article_tags WHERE article_id = ?').get(article.body.id))
      .toEqual({ tag_id: tag.body.id });
    const fetched = await admin.agent.get(`/api/kb/articles/${article.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.tags).toEqual(expect.arrayContaining([expect.objectContaining({ id: tag.body.id, name: tag.body.name })]));
  });
});
