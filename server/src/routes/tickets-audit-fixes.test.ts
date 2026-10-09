import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Audit-fix regression tests for server/src/routes/tickets.ts:
 *  - shared input validation (caps, enums, FK existence) on POST / PUT / bulk / import
 *  - resolved_at/closed_at cleared when a ticket is reopened
 *  - list excludes the heavy text columns, detail keeps them
 *  - bulk-delete/delete: files unlinked after commit, audit rows, ticket.deleted webhook
 *  - ticket.status_changed + minimal ticket.updated webhook payloads
 *  - dashboard range predicates, export filename header, reminders hardening
 */

const { DB_PATH, UPLOAD_TEST_DIR } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const stamp = `${process.pid}-${Date.now()}`;
  const dbPath = join(tmpdir(), `itticket-test-${stamp}-tickets-audit.sqlite`);
  const uploadDir = join(tmpdir(), `itticket-tickets-audit-uploads-${stamp}`);
  process.env.DB_PATH = dbPath;
  process.env.UPLOAD_DIR = uploadDir;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-tickets-audit-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-tickets-audit-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath, UPLOAD_TEST_DIR: uploadDir };
});

vi.mock('../lib/webhookDispatcher.js', () => ({
  dispatchWebhook: vi.fn(async () => undefined),
}));

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { join } from 'node:path';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';
import { dispatchWebhook } from '../lib/webhookDispatcher.js';

const dispatchWebhookMock = vi.mocked(dispatchWebhook);

type Session = { agent: ReturnType<typeof request.agent>; token: string; csrf: string };

let app: ReturnType<typeof createApp>;
let admin: Session;
let alice: Session;

let adminId: string;
let aliceId: string;

async function login(email: string, password: string): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const token = res.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  return { agent, token, csrf: csrfRes.body.csrfToken as string };
}

const call = (who: Session, method: 'get' | 'post' | 'put' | 'delete', path: string, body?: unknown) => {
  const req = who.agent[method](`/api/tickets${path}`).set('Authorization', `Bearer ${who.token}`);
  return method === 'get' ? req : req.set('x-csrf-token', who.csrf).send(body as object);
};

function seedTicket(opts: { status?: string; assignedTo?: string | null; createdBy?: string; title?: string } = {}): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tickets (id, title, description, status, priority, assigned_to, created_by, notes, solution)
     VALUES (?, ?, ?, ?, 'medium', ?, ?, 'hemliga anteckningar', 'lösningstext')`
  ).run(id, opts.title ?? 'Seeded', 'seeded body', opts.status ?? 'open', opts.assignedTo ?? null, opts.createdBy ?? adminId);
  return id;
}

beforeAll(async () => {
  mkdirSync(UPLOAD_TEST_DIR, { recursive: true });
  initializeDatabase();

  adminId = randomUUID();
  aliceId = randomUUID();
  const insertUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  );
  insertUser.run(adminId, 'admin@ticketsaudit.local', await bcrypt.hash('Admin-P@ss1234!', 10), 'admin', 'Audit Admin');
  insertUser.run(aliceId, 'alice@ticketsaudit.local', await bcrypt.hash('Alice-P@ss1234!', 10), 'user', 'Audit Alice');

  app = createApp();
  admin = await login('admin@ticketsaudit.local', 'Admin-P@ss1234!');
  alice = await login('alice@ticketsaudit.local', 'Alice-P@ss1234!');
});

afterEach(() => {
  dispatchWebhookMock.mockClear();
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
  rmSync(UPLOAD_TEST_DIR, { recursive: true, force: true });
});

describe('POST / and PUT /:id — shared validation', () => {
  it('POST enforces caps, enums and non-empty title', async () => {
    const base = { title: 'T', description: 'D' };
    expect((await call(admin, 'post', '', { ...base, title: 'x'.repeat(201) })).status).toBe(400);
    expect((await call(admin, 'post', '', { ...base, description: 'x'.repeat(5001) })).status).toBe(400);
    expect((await call(admin, 'post', '', { ...base, notes: 'x'.repeat(5001) })).status).toBe(400);
    expect((await call(admin, 'post', '', { ...base, solution: 'x'.repeat(5001) })).status).toBe(400);
    expect((await call(admin, 'post', '', { ...base, status: 'bogus' })).status).toBe(400);
    expect((await call(admin, 'post', '', { ...base, priority: 'bogus' })).status).toBe(400);
    expect((await call(admin, 'post', '', { ...base, title: '<b></b>' })).status).toBe(400);
    expect((await call(admin, 'post', '', { description: 'D' })).status).toBe(400);
    expect((await call(admin, 'post', '', { ...base, title: 'x'.repeat(200) })).status).toBe(201);
  });

  it('POST returns 400 (not 500) for references that do not exist', async () => {
    const base = { title: 'FK', description: 'D' };
    for (const field of ['category_id', 'requester_id', 'company_id', 'assigned_to']) {
      const res = await call(admin, 'post', '', { ...base, [field]: randomUUID() });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(field === 'assigned_to' ? /assigned_to/ : new RegExp(field));
    }
    expect((await call(admin, 'post', '', { ...base, category_id: 42 })).status).toBe(400);
  });

  it('POST accepts existing references and sanitises the title', async () => {
    const categoryId = randomUUID();
    db.prepare('INSERT INTO categories (id, name, label) VALUES (?, ?, ?)').run(categoryId, 'fk-cat', 'FK Cat');
    const res = await call(admin, 'post', '', {
      title: '<script>x</script>Hej', description: '<p>ok</p><script>x</script>', category_id: categoryId, assigned_to: aliceId,
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Hej');
    expect(res.body.description).toBe('<p>ok</p>');
    expect(res.body.category_id).toBe(categoryId);
    expect(res.body.assigned_to).toBe(aliceId);
  });

  it('PUT rejects unknown references and an emptied title, and still clears with null/empty', async () => {
    const id = seedTicket({ assignedTo: aliceId });
    expect((await call(admin, 'put', `/${id}`, { requester_id: randomUUID() })).status).toBe(400);
    expect((await call(admin, 'put', `/${id}`, { company_id: randomUUID() })).status).toBe(400);
    expect((await call(admin, 'put', `/${id}`, { title: '' })).status).toBe(400);

    const cleared = await call(admin, 'put', `/${id}`, { assigned_to: null, category_id: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.assigned_to).toBeNull();
  });

  it('PUT: a non-assignee non-creator gets 403 on an assigned ticket but may pick up an unassigned one', async () => {
    const assigned = seedTicket({ assignedTo: adminId });
    const queued = seedTicket({ assignedTo: null });
    expect((await call(alice, 'put', `/${assigned}`, { status: 'waiting' })).status).toBe(403);
    expect((await call(alice, 'put', `/${queued}`, { assigned_to: aliceId })).status).toBe(200);
  });
});

describe('resolved_at / closed_at are cleared when a ticket is reopened', () => {
  it('PUT: closed → open clears both timestamps; open → closed sets them again', async () => {
    const id = seedTicket();
    const closed = await call(admin, 'put', `/${id}`, { status: 'closed' });
    expect(closed.body.closed_at).toBeTruthy();

    for (const status of ['open', 'in-progress', 'waiting']) {
      await call(admin, 'put', `/${id}`, { status: 'closed' });
      db.prepare('UPDATE tickets SET resolved_at = ? WHERE id = ?').run(new Date().toISOString(), id);
      const reopened = await call(admin, 'put', `/${id}`, { status });
      expect(reopened.status).toBe(200);
      expect(reopened.body.resolved_at).toBeNull();
      expect(reopened.body.closed_at).toBeNull();
    }
  });

  it('PUT: resolved keeps resolved_at, and re-resolving does not move it', async () => {
    const id = seedTicket();
    const first = await call(admin, 'put', `/${id}`, { status: 'resolved' });
    expect(first.body.resolved_at).toBeTruthy();
    const again = await call(admin, 'put', `/${id}`, { status: 'resolved', priority: 'high' });
    expect(again.body.resolved_at).toBe(first.body.resolved_at);
  });

  it('bulk: moving closed tickets back to waiting clears both timestamps', async () => {
    const id = seedTicket({ status: 'closed' });
    db.prepare('UPDATE tickets SET resolved_at = ?, closed_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', id);
    const res = await call(admin, 'put', '/bulk', { ids: [id], updates: { status: 'waiting' } });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT status, resolved_at, closed_at FROM tickets WHERE id = ?').get(id) as Record<string, string | null>;
    expect(row).toEqual({ status: 'waiting', resolved_at: null, closed_at: null });
  });
});

describe('bulk update validation', () => {
  it('requires an array of strings, max 500', async () => {
    expect((await call(admin, 'put', '/bulk', { ids: 'abc', updates: { status: 'open' } })).status).toBe(400);
    expect((await call(admin, 'put', '/bulk', { ids: [1, 2], updates: { status: 'open' } })).status).toBe(400);
    const many = Array.from({ length: 501 }, () => randomUUID());
    expect((await call(admin, 'put', '/bulk', { ids: many, updates: { status: 'open' } })).status).toBe(400);
  });

  it('validates category_id and assigned_to existence', async () => {
    const id = seedTicket();
    expect((await call(admin, 'put', '/bulk', { ids: [id], updates: { category_id: randomUUID() } })).status).toBe(400);
    const res = await call(admin, 'put', '/bulk', { ids: [id], updates: { assigned_to: randomUUID() } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid assigned_to: user does not exist');
  });

  it('skips tickets the caller cannot write (assigned to someone else)', async () => {
    const mine = seedTicket({ assignedTo: aliceId });
    const theirs = seedTicket({ assignedTo: adminId });
    const res = await call(alice, 'put', '/bulk', { ids: [mine, theirs], updates: { priority: 'high' } });
    expect(res.body).toEqual({ updated: 1, skipped: [theirs] });
  });
});

describe('list excludes heavy text columns, detail keeps them', () => {
  it('GET / (plain and paginated) omits description/notes/solution; GET /:id includes them', async () => {
    const id = seedTicket({ title: 'Lista-kolumner' });

    const plain = await call(admin, 'get', '');
    const plainRow = (plain.body as Record<string, unknown>[]).find((t) => t.id === id)!;
    expect(plainRow.title).toBe('Lista-kolumner');
    expect(plainRow).not.toHaveProperty('description');
    expect(plainRow).not.toHaveProperty('notes');
    expect(plainRow).not.toHaveProperty('solution');

    const paged = await call(admin, 'get', '?page=1&limit=100&search=Lista-kolumner');
    expect(paged.status).toBe(200);
    for (const row of paged.body.data as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty('description');
    }

    const detail = await call(admin, 'get', `/${id}`);
    expect(detail.body.description).toBe('seeded body');
    expect(detail.body.notes).toBe('hemliga anteckningar');
    expect(detail.body.solution).toBe('lösningstext');
  });
});

describe('webhooks: status_changed + minimal updated payload', () => {
  it('PUT status change dispatches ticket.status_changed and a payload without notes/solution', async () => {
    const id = seedTicket({ assignedTo: aliceId });
    const res = await call(admin, 'put', `/${id}`, { status: 'in-progress', notes: 'ny hemlig not', solution: 'ny lösning' });
    expect(res.status).toBe(200);

    const updated = dispatchWebhookMock.mock.calls.find(([event]) => event === 'ticket.updated');
    expect(updated?.[1]).toEqual({
      id, status: 'in-progress', priority: 'medium', assigned_to: aliceId, title: 'Seeded',
      updated_fields: expect.arrayContaining(['status', 'notes', 'solution']),
    });
    expect(JSON.stringify(updated?.[1])).not.toContain('hemlig');
    expect(dispatchWebhookMock).toHaveBeenCalledWith('ticket.status_changed', { id, title: 'Seeded', old_status: 'open', status: 'in-progress' });
  });

  it('no status_changed when the status is unchanged', async () => {
    const id = seedTicket();
    await call(admin, 'put', `/${id}`, { priority: 'high' });
    expect(dispatchWebhookMock.mock.calls.some(([event]) => event === 'ticket.status_changed')).toBe(false);
  });

  it('bulk dispatches ticket.status_changed once per really-changed ticket', async () => {
    const a = seedTicket({ title: 'Bulk A' });
    const b = seedTicket({ title: 'Bulk B', status: 'waiting' });
    await call(admin, 'put', '/bulk', { ids: [a, b], updates: { status: 'waiting' } });
    const events = dispatchWebhookMock.mock.calls.filter(([event]) => event === 'ticket.status_changed');
    expect(events).toHaveLength(1);
    expect(events[0][1]).toEqual({ id: a, title: 'Bulk A', old_status: 'open', status: 'waiting' });
  });
});

describe('delete + bulk-delete: files after commit, audit, ticket.deleted', () => {
  function seedAttachment(ticketId: string, fileName: string) {
    writeFileSync(join(UPLOAD_TEST_DIR, fileName), 'data');
    db.prepare(
      `INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path, file_size, file_type) VALUES (?, ?, ?, ?, 4, 'text/plain')`
    ).run(randomUUID(), ticketId, fileName, fileName);
  }

  it('DELETE /:id removes the files, writes an audit row and dispatches ticket.deleted', async () => {
    const id = seedTicket({ title: 'Raderas' });
    const file = `single-${randomUUID()}.txt`;
    seedAttachment(id, file);

    const res = await call(admin, 'delete', `/${id}`);
    expect(res.status).toBe(200);
    expect(existsSync(join(UPLOAD_TEST_DIR, file))).toBe(false);

    const audit = db.prepare("SELECT user_id, details FROM audit_log WHERE action = 'ticket_delete' AND entity_id = ?").get(id) as { user_id: string; details: string };
    expect(audit).toEqual({ user_id: adminId, details: 'title: Raderas' });
    expect(dispatchWebhookMock).toHaveBeenCalledWith('ticket.deleted', { id, title: 'Raderas' });
  });

  it('bulk-delete removes files, logs one audit row and dispatches ticket.deleted per ticket', async () => {
    const a = seedTicket({ title: 'Bulk del A' });
    const b = seedTicket({ title: 'Bulk del B' });
    const fileA = `bulk-a-${randomUUID()}.txt`;
    const fileB = `bulk-b-${randomUUID()}.txt`;
    seedAttachment(a, fileA);
    seedAttachment(b, fileB);

    const res = await call(admin, 'post', '/bulk-delete', { ids: [a, b, randomUUID()] });
    expect(res.body).toEqual({ deleted: 2, alreadyGone: 1 });
    expect(existsSync(join(UPLOAD_TEST_DIR, fileA))).toBe(false);
    expect(existsSync(join(UPLOAD_TEST_DIR, fileB))).toBe(false);

    const audits = db.prepare("SELECT details FROM audit_log WHERE action = 'ticket_bulk_delete'").all() as { details: string }[];
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toBe(`count: 2, ids: ${a},${b}`);
    expect(dispatchWebhookMock).toHaveBeenCalledWith('ticket.deleted', { id: a, title: 'Bulk del A' });
    expect(dispatchWebhookMock).toHaveBeenCalledWith('ticket.deleted', { id: b, title: 'Bulk del B' });
  });

  it('bulk-delete rejects non-string ids and more than 500 ids; nothing is deleted or logged', async () => {
    const keep = seedTicket();
    expect((await call(admin, 'post', '/bulk-delete', { ids: [keep, 5] })).status).toBe(400);
    expect((await call(admin, 'post', '/bulk-delete', { ids: Array.from({ length: 501 }, () => randomUUID()) })).status).toBe(400);
    expect(db.prepare('SELECT id FROM tickets WHERE id = ?').get(keep)).toBeDefined();
  });

  it('a file_path escaping the upload dir is never unlinked', async () => {
    const outside = join(UPLOAD_TEST_DIR, '..', `tickets-outside-${process.pid}.txt`);
    writeFileSync(outside, 'keep');
    const id = seedTicket();
    db.prepare(
      `INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path, file_size, file_type) VALUES (?, ?, 'x', ?, 4, 'text/plain')`
    ).run(randomUUID(), id, `../${outside.split('/').pop()}`);
    try {
      expect((await call(admin, 'delete', `/${id}`)).status).toBe(200);
      expect(existsSync(outside)).toBe(true);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

describe('import confirm uses the shared validation and is audited', () => {
  it('rejects an over-long title with a row-specific 400 and inserts nothing', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number }).n;
    const res = await call(admin, 'post', '/import/confirm', {
      tickets: [{ title: 'Giltig', description: 'ok' }, { title: 'x'.repeat(201), description: 'ok' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Rad 2:/);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number }).n).toBe(before);
  });

  it('rejects non-object rows and an unknown status', async () => {
    expect((await call(admin, 'post', '/import/confirm', { tickets: ['nope'] })).status).toBe(400);
    expect((await call(admin, 'post', '/import/confirm', { tickets: [{ title: 'T', status: 'bogus' }] })).status).toBe(400);
  });

  it('sanitises imported text, defaults the description to the title and logs ticket_import', async () => {
    const res = await call(admin, 'post', '/import/confirm', {
      tickets: [{ title: '<b>Importerad</b>', notes: '<script>x</script>anteckning', status: 'waiting' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    const row = db.prepare("SELECT description, notes, status FROM tickets WHERE title = 'Importerad'").get() as Record<string, string>;
    expect(row).toEqual({ description: 'Importerad', notes: 'anteckning', status: 'waiting' });
    const audit = db.prepare("SELECT details FROM audit_log WHERE action = 'ticket_import'").get() as { details: string };
    expect(audit.details).toBe('created: 1');
  });
});

describe('dashboard-overview and exports', () => {
  it('counts today with range predicates for both ISO and legacy timestamp formats', async () => {
    const before = (await call(admin, 'get', '/dashboard-overview')).body.todayCounts;
    const iso = seedTicket();
    const legacy = seedTicket();
    const old = seedTicket();
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    db.prepare('UPDATE tickets SET created_at = ?, resolved_at = ? WHERE id = ?').run(now.toISOString(), `${day} 08:00:00`, iso);
    db.prepare('UPDATE tickets SET created_at = ?, closed_at = ? WHERE id = ?').run(`${day} 08:00:00`, now.toISOString(), legacy);
    db.prepare('UPDATE tickets SET created_at = ?, resolved_at = ?, closed_at = ? WHERE id = ?').run('2020-01-01 00:00:00', '2020-01-01T00:00:00.000Z', '2020-01-01 00:00:00', old);

    const after = (await call(admin, 'get', '/dashboard-overview')).body;
    expect(after.todayCounts.created_today - before.created_today).toBe(2); // iso + legacy, inte 2020-ärendet
    expect(after.todayCounts.resolved_today - before.resolved_today).toBe(1);
    expect(after.todayCounts.closed_today - before.closed_today).toBe(1);
    expect(Array.isArray(after.agingTickets)).toBe(true);
  });

  it('aging uses the latest non-deleted comment', async () => {
    const id = seedTicket({ title: 'Aging with comment' });
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', id);
    db.prepare(`INSERT INTO ticket_comments (id, ticket_id, user_id, content, is_internal, created_at) VALUES (?, ?, ?, 'c', 1, ?)`)
      .run(randomUUID(), id, adminId, new Date().toISOString());
    const res = await call(admin, 'get', '/dashboard-overview');
    const row = (res.body.agingTickets as { id: string; age_days: number }[]).find((t) => t.id === id);
    // Senaste kommentaren är idag -> åldern räknas från den, inte från updated_at 2020.
    expect(row === undefined || row.age_days <= 1).toBe(true);
  });

  it('export filename built from query values is RFC 5987 safe', async () => {
    const res = await call(admin, 'get', `/export?category=${encodeURIComponent('Nät"verk;\r\nx')}`);
    expect(res.status).toBe(200);
    const header = res.headers['content-disposition'];
    expect(header).toMatch(/^attachment; filename="[^"\r\n;]*"; filename\*=UTF-8''/);
    expect(header).toContain('N%C3%A4t%22verk');
  });

  it('export-archive handles more closed tickets than one IN chunk (tag lookup is chunked)', async () => {
    const insert = db.prepare(
      `INSERT INTO tickets (id, title, description, status, priority, created_by, closed_at) VALUES (?, ?, 'd', 'closed', 'low', ?, ?)`
    );
    db.transaction(() => {
      for (let i = 0; i < 620; i++) insert.run(randomUUID(), `Arkiv ${i}`, adminId, new Date().toISOString());
    })();
    const res = await call(admin, 'get', '/export-archive');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('arkiv-export-');
  });

  it('export-archive ?ids= returns the requested tickets', async () => {
    const id = seedTicket({ status: 'closed' });
    const res = await call(admin, 'get', `/export-archive?ids=${id}`);
    expect(res.status).toBe(200);
  });
});

describe('reminders hardening', () => {
  const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

  it('rejects an unparseable time (400) instead of storing NaN', async () => {
    const id = seedTicket({ assignedTo: adminId });
    const res = await call(admin, 'post', `/${id}/reminders`, { reminder_time: 'tomorrow-ish' });
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT id FROM ticket_reminders WHERE ticket_id = ?').all(id)).toEqual([]);
  });

  it('stores the normalised ISO time and caps the message at 500 characters', async () => {
    const id = seedTicket({ assignedTo: adminId });
    const local = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const res = await call(admin, 'post', `/${id}/reminders`, { reminder_time: local.toString(), message: 'm'.repeat(500) });
    expect(res.status).toBe(201);
    expect(res.body.reminder_time).toBe(new Date(local.toString()).toISOString());

    expect((await call(admin, 'post', `/${id}/reminders`, { reminder_time: future(), message: 'm'.repeat(501) })).status).toBe(400);
    expect((await call(admin, 'post', `/${id}/reminders`, { reminder_time: future(), message: { a: 1 } })).status).toBe(400);
  });

  it('a non-assignee cannot add a reminder to someone else\'s ticket, but can list them', async () => {
    const id = seedTicket({ assignedTo: adminId });
    expect((await call(alice, 'post', `/${id}/reminders`, { reminder_time: future() })).status).toBe(403);
    expect((await call(alice, 'get', `/${id}/reminders`)).status).toBe(200);
  });

  it('DELETE only deletes a reminder that belongs to the ticket in the URL', async () => {
    const ticketA = seedTicket({ assignedTo: adminId });
    const ticketB = seedTicket({ assignedTo: adminId });
    const created = await call(admin, 'post', `/${ticketA}/reminders`, { reminder_time: future() });
    const reminderId = created.body.id as string;

    expect((await call(admin, 'delete', `/${ticketB}/reminders/${reminderId}`)).status).toBe(404);
    expect(db.prepare('SELECT id FROM ticket_reminders WHERE id = ?').get(reminderId)).toBeDefined();
    expect((await call(admin, 'delete', `/${ticketA}/reminders/${reminderId}`)).status).toBe(200);
  });
});
