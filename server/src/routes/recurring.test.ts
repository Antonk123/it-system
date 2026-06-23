import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Integration tests for the /api/recurring routes (audit-v3 LOW).
 *
 * Covers:
 *  - Creating daily / weekly / monthly templates and verifying that the
 *    next_run returned by the API matches computeNextRun() (the same function
 *    the route uses), proving the next-run computation is wired up correctly.
 *  - Required-field + interval validation (name/title, interval_type enum,
 *    interval_day required for weekly/monthly).
 *  - Admin-only enforcement on POST.
 *  - The PATCH /:id/toggle pause/resume logic (next_run cleared logic on
 *    resume, recomputed via computeNextRun).
 *  - The instantiation/clone logic the scheduler exposes (computeNextRun
 *    determinism + month-end clamping).
 *
 * Harness mirrors checklists.test.ts: UNIQUE DB_PATH suffix (-recurring).
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-recurring.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-recurring-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-recurring-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';
import { computeNextRun } from '../lib/recurringScheduler.js';

type Session = { agent: ReturnType<typeof request.agent>; token: string; csrf: string };

let app: ReturnType<typeof createApp>;

let admin: Session;
let user: Session;

let adminId: string;
let userId: string;

async function login(email: string, password: string): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const token = res.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  return { agent, token, csrf: csrfRes.body.csrfToken as string };
}

beforeAll(async () => {
  initializeDatabase();

  adminId = randomUUID();
  userId = randomUUID();

  const adminHash = await bcrypt.hash('Admin-P@ss1234!', 10);
  const userHash = await bcrypt.hash('User-P@ss1234!', 10);

  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(adminId, 'admin@recurringtest.local', adminHash, 'admin', 'Recurring Admin');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, 'user@recurringtest.local', userHash, 'user', 'Plain User');

  app = createApp();

  admin = await login('admin@recurringtest.local', 'Admin-P@ss1234!');
  user = await login('user@recurringtest.local', 'User-P@ss1234!');
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

/** Parse two ISO timestamps and assert they fall on the same calendar day. */
function sameCalendarDay(a: string, b: string) {
  const da = new Date(a);
  const db_ = new Date(b);
  expect(da.getFullYear()).toBe(db_.getFullYear());
  expect(da.getMonth()).toBe(db_.getMonth());
  expect(da.getDate()).toBe(db_.getDate());
}

describe('POST /api/recurring — create templates for each schedule', () => {
  it('creates a DAILY template and next_run is tomorrow (matches computeNextRun)', async () => {
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Daily backup check', title: 'Backup check', interval_type: 'daily' });

    expect(res.status).toBe(201);
    expect(res.body.interval_type).toBe('daily');
    expect(res.body.interval_day).toBeNull();
    expect(res.body.is_active).toBe(1);
    expect(typeof res.body.next_run).toBe('string');
    // next_run must be the same calendar day computeNextRun produces (midnight tomorrow).
    sameCalendarDay(res.body.next_run, computeNextRun('daily', null));
    // And strictly in the future.
    expect(new Date(res.body.next_run).getTime()).toBeGreaterThan(Date.now());
  });

  it('creates a WEEKLY template and next_run lands on the requested weekday', async () => {
    const interval_day = 3; // Wednesday
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Weekly review', title: 'Weekly review', interval_type: 'weekly', interval_day });

    expect(res.status).toBe(201);
    expect(res.body.interval_type).toBe('weekly');
    expect(res.body.interval_day).toBe(interval_day);
    sameCalendarDay(res.body.next_run, computeNextRun('weekly', interval_day));
    // The computed next_run must fall on the requested weekday.
    expect(new Date(res.body.next_run).getDay()).toBe(interval_day);
  });

  it('creates a MONTHLY template and next_run is in the next month on the requested day', async () => {
    const interval_day = 15;
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Monthly report', title: 'Monthly report', interval_type: 'monthly', interval_day });

    expect(res.status).toBe(201);
    expect(res.body.interval_type).toBe('monthly');
    expect(res.body.interval_day).toBe(interval_day);
    sameCalendarDay(res.body.next_run, computeNextRun('monthly', interval_day));
    expect(new Date(res.body.next_run).getDate()).toBe(interval_day);
  });

  it('persists tags and priority on the created template', async () => {
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({
        name: 'Tagged template',
        title: 'Tagged',
        interval_type: 'daily',
        priority: 'high',
        tags: ['a', 'b'],
      });
    expect(res.status).toBe(201);
    expect(res.body.priority).toBe('high');
    expect(res.body.tags).toEqual(['a', 'b']);

    // Persisted tags are stored as JSON; verify the row directly.
    const row = db.prepare('SELECT tags, priority FROM recurring_templates WHERE id = ?').get(res.body.id) as
      | { tags: string; priority: string }
      | undefined;
    expect(JSON.parse(row!.tags)).toEqual(['a', 'b']);
    expect(row!.priority).toBe('high');
  });
});

describe('POST /api/recurring — validation', () => {
  it('rejects a non-admin with 403', async () => {
    const res = await user.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf)
      .send({ name: 'x', title: 'x', interval_type: 'daily' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('rejects a missing name/title with 400', async () => {
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ interval_type: 'daily' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name and title/i);
  });

  it('rejects an invalid interval_type with 400', async () => {
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'x', title: 'x', interval_type: 'hourly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/interval_type/i);
  });

  it('rejects weekly without interval_day with 400', async () => {
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'x', title: 'x', interval_type: 'weekly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/interval_day krävs.*weekly/i);
  });

  it('rejects monthly without interval_day with 400', async () => {
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'x', title: 'x', interval_type: 'monthly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/interval_day krävs.*monthly/i);
  });
});

describe('GET /api/recurring — list', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/recurring');
    expect(res.status).toBe(401);
  });

  it('returns the created templates with parsed tags + history array (200, any auth user)', async () => {
    const res = await request(app)
      .get('/api/recurring')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const t = res.body[0];
    expect(Array.isArray(t.tags)).toBe(true);
    expect(Array.isArray(t.history)).toBe(true);
  });
});

describe('PATCH /api/recurring/:id/toggle — pause/resume', () => {
  let templateId: string;

  beforeAll(async () => {
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Toggle me', title: 'Toggle', interval_type: 'daily' });
    expect(res.status).toBe(201);
    templateId = res.body.id;
  });

  it('rejects a non-admin with 403', async () => {
    const res = await user.agent
      .patch(`/api/recurring/${templateId}/toggle`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf);
    expect(res.status).toBe(403);
  });

  it('pauses an active template (is_active → 0)', async () => {
    const res = await admin.agent
      .patch(`/api/recurring/${templateId}/toggle`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(0);
  });

  it('resumes a paused template (is_active → 1) and recomputes next_run', async () => {
    const res = await admin.agent
      .patch(`/api/recurring/${templateId}/toggle`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(1);
    // On resume, next_run is recomputed for the daily interval (tomorrow).
    sameCalendarDay(res.body.next_run, computeNextRun('daily', null));
  });

  it('returns 404 for a non-existent template', async () => {
    const res = await admin.agent
      .patch(`/api/recurring/${randomUUID()}/toggle`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/recurring/:id — update + next_run recompute', () => {
  let templateId: string;

  beforeAll(async () => {
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Editable', title: 'Editable', interval_type: 'daily' });
    expect(res.status).toBe(201);
    templateId = res.body.id;
  });

  it('rejects a non-admin with 403', async () => {
    const res = await user.agent
      .put(`/api/recurring/${templateId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf)
      .send({ title: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('changes interval daily → weekly and recomputes next_run for the new weekday', async () => {
    const interval_day = 1; // Monday
    const res = await admin.agent
      .put(`/api/recurring/${templateId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ interval_type: 'weekly', interval_day });
    expect(res.status).toBe(200);
    expect(res.body.interval_type).toBe('weekly');
    expect(res.body.interval_day).toBe(interval_day);
    expect(new Date(res.body.next_run).getDay()).toBe(interval_day);
    sameCalendarDay(res.body.next_run, computeNextRun('weekly', interval_day));
  });

  it('rejects switching to weekly without interval_day (400, not 500)', async () => {
    const res = await admin.agent
      .put(`/api/recurring/${templateId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ interval_type: 'weekly', interval_day: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/interval_day krävs.*weekly/i);
  });

  it('returns 404 for a non-existent template', async () => {
    const res = await admin.agent
      .put(`/api/recurring/${randomUUID()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ title: 'nope' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/recurring/:id', () => {
  let templateId: string;

  beforeAll(async () => {
    const res = await admin.agent
      .post('/api/recurring')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Deletable', title: 'Deletable', interval_type: 'daily' });
    expect(res.status).toBe(201);
    templateId = res.body.id;
  });

  it('rejects a non-admin with 403', async () => {
    const res = await user.agent
      .delete(`/api/recurring/${templateId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf);
    expect(res.status).toBe(403);
  });

  it('deletes a template (204) and removes the row', async () => {
    const res = await admin.agent
      .delete(`/api/recurring/${templateId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(204);
    const row = db.prepare('SELECT id FROM recurring_templates WHERE id = ?').get(templateId);
    expect(row).toBeUndefined();
  });

  it('returns 404 for an already-deleted template', async () => {
    const res = await admin.agent
      .delete(`/api/recurring/${templateId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(404);
  });
});

describe('computeNextRun — instantiation/clone next-run logic the scheduler exposes', () => {
  it('daily → next calendar day at local midnight', () => {
    const from = new Date('2026-06-23T13:45:00');
    const next = new Date(computeNextRun('daily', null, from));
    expect(next.getDate()).toBe(24);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
  });

  it('weekly → next occurrence of the weekday, at least 1 day ahead', () => {
    // 2026-06-23 is a Tuesday (getDay()===2). Asking for Tuesday must roll a full week.
    const from = new Date('2026-06-23T13:45:00');
    const next = new Date(computeNextRun('weekly', 2, from));
    expect(next.getDay()).toBe(2);
    expect(next.getDate()).toBe(30); // a week ahead, not the same day
  });

  it('monthly clamps day-31 to the last day of a short month', () => {
    // From January, asking for the 31st → February clamps to 28/29.
    const from = new Date('2026-01-15T10:00:00');
    const next = new Date(computeNextRun('monthly', 31, from));
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBeLessThanOrEqual(29);
    expect(next.getDate()).toBeGreaterThanOrEqual(28);
  });

  it('throws on out-of-range weekly interval_day', () => {
    expect(() => computeNextRun('weekly', 9)).toThrow();
  });

  it('throws on out-of-range monthly interval_day', () => {
    expect(() => computeNextRun('monthly', 0)).toThrow();
  });
});
