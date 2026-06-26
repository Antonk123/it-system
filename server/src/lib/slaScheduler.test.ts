import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Tests for checkSlaBreaches (#4): proactive SLA-breach detection. Asserts the
 * DB-observable effect (sla_*_met set to 0), the comment.created/sla.*.breached
 * webhook, notification routing (assigned agent vs admins), pause/closed/future
 * exclusions, and dedup (a breach is notified once).
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-sla-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-sla-0123456789abcdef0123456789abcd';
  process.env.JWT_SECRET = 'test-jwt-secret-sla-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

vi.mock('./push.js', () => ({ sendPushToAllSubscriptions: vi.fn(async () => undefined) }));
vi.mock('./email.js', () => ({ sendSlaBreachEmail: vi.fn(async () => undefined) }));

import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { sendPushToAllSubscriptions } from './push.js';
import { sendSlaBreachEmail } from './email.js';
import { checkSlaBreaches } from './slaScheduler.js';

const pushMock = vi.mocked(sendPushToAllSubscriptions);
const emailMock = vi.mocked(sendSlaBreachEmail);

const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const NOW = new Date('2026-06-26T12:00:00.000Z');

const HOOK_URL = 'https://93.184.216.34/hook';
let captured: { event: string | undefined; body: string }[] = [];
let adminId: string;
let agentId: string;

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    captured.push({ event: headers['X-Webhook-Event'], body: String(init.body) });
    return new Response(null, { status: 200 });
  }));
}

function makeTicket(opts: {
  responseDeadline?: string | null; resolutionDeadline?: string | null;
  responseMet?: number | null; resolutionMet?: number | null;
  status?: string; pausedAt?: string | null; assignedTo?: string | null;
}): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO tickets (id, title, description, status, priority, assigned_to,
      sla_response_deadline, sla_resolution_deadline, sla_response_met, sla_resolution_met, sla_paused_at)
    VALUES (?, 'SLA ticket', 'x', ?, 'high', ?, ?, ?, ?, ?, ?)
  `).run(
    id, opts.status ?? 'open', opts.assignedTo ?? null,
    opts.responseDeadline ?? null, opts.resolutionDeadline ?? null,
    opts.responseMet ?? null, opts.resolutionMet ?? null, opts.pausedAt ?? null,
  );
  return id;
}

beforeAll(() => {
  initializeDatabase();
  adminId = randomUUID();
  agentId = randomUUID();
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(adminId, 'admin@sla.local', 'x', 'admin', 'SLA Admin');
  db.prepare('INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(agentId, 'agent@sla.local', 'x', 'user', 'SLA Agent');
  db.prepare('INSERT INTO webhooks (id, url, events, secret, active) VALUES (?, ?, ?, ?, 1)')
    .run(randomUUID(), HOOK_URL, JSON.stringify(['sla.response.breached', 'sla.resolution.breached']), 'sla-secret-key');
});

beforeEach(() => { stubFetch(); });
afterEach(() => { vi.restoreAllMocks(); pushMock.mockClear(); emailMock.mockClear(); captured = []; });

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('checkSlaBreaches', () => {
  it('flags a passed response deadline: sets sla_response_met=0, fires webhook, notifies the assigned agent', async () => {
    const id = makeTicket({ responseDeadline: PAST, assignedTo: agentId });
    await checkSlaBreaches(NOW);

    const row = db.prepare('SELECT sla_response_met FROM tickets WHERE id = ?').get(id) as { sla_response_met: number };
    expect(row.sla_response_met).toBe(0);
    expect(captured.some((c) => c.event === 'sla.response.breached')).toBe(true);
    expect(pushMock).toHaveBeenCalledWith(expect.anything(), agentId);
    expect(emailMock).toHaveBeenCalledWith(expect.objectContaining({ toEmail: 'agent@sla.local', breachType: 'response' }));
  });

  it('flags a passed resolution deadline: sets sla_resolution_met=0 and fires sla.resolution.breached', async () => {
    const id = makeTicket({ resolutionDeadline: PAST, assignedTo: agentId });
    await checkSlaBreaches(NOW);

    const row = db.prepare('SELECT sla_resolution_met FROM tickets WHERE id = ?').get(id) as { sla_resolution_met: number };
    expect(row.sla_resolution_met).toBe(0);
    expect(captured.some((c) => c.event === 'sla.resolution.breached')).toBe(true);
  });

  it('routes the notification to admins when the ticket is unassigned', async () => {
    makeTicket({ resolutionDeadline: PAST, assignedTo: null });
    await checkSlaBreaches(NOW);
    expect(emailMock).toHaveBeenCalledWith(expect.objectContaining({ toEmail: 'admin@sla.local' }));
  });

  it('does not re-notify an already-flagged breach (dedup via met=0)', async () => {
    makeTicket({ responseDeadline: PAST, assignedTo: agentId });
    await checkSlaBreaches(NOW);
    emailMock.mockClear();
    captured = [];
    await checkSlaBreaches(NOW);
    expect(emailMock).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });

  it('ignores paused, resolved/closed, and not-yet-due tickets', async () => {
    makeTicket({ responseDeadline: PAST, pausedAt: NOW.toISOString(), assignedTo: agentId }); // paused
    makeTicket({ responseDeadline: PAST, status: 'resolved', assignedTo: agentId });           // resolved
    makeTicket({ responseDeadline: PAST, status: 'closed', assignedTo: agentId });             // closed
    const future = makeTicket({ responseDeadline: FUTURE, assignedTo: agentId });              // not due

    await checkSlaBreaches(NOW);

    expect(emailMock).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
    const row = db.prepare('SELECT sla_response_met FROM tickets WHERE id = ?').get(future) as { sla_response_met: number | null };
    expect(row.sla_response_met).toBeNull();
  });
});
