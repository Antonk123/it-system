import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Tests for ticketNotifications — the loop-closing notifications. We assert the
 * observable side effect that does NOT require SMTP/VAPID: a comment.created
 * webhook delivery. (Email/push are gated on config and no-op here; the reply
 * email itself is covered in email.test.ts.)
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-notif.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-notif-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-notif-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

vi.mock('./push.js', () => ({ sendPushToAllSubscriptions: vi.fn(async () => undefined) }));

import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { sendPushToAllSubscriptions } from './push.js';
import { notifyCustomerOfPublicReply, notifyAgentOfCustomerReply } from './ticketNotifications.js';

const pushMock = vi.mocked(sendPushToAllSubscriptions);

const HOOK_URL = 'https://93.184.216.34/hook';
let captured: { event: string | undefined; body: string }[] = [];

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      captured.push({ event: headers['X-Webhook-Event'], body: String(init.body) });
      return new Response(null, { status: 200 });
    }),
  );
}

function makeTicketWithRequester(): string {
  const contactId = randomUUID();
  const ticketId = randomUUID();
  db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)')
    .run(contactId, 'Kund', 'kund@customer.example');
  db.prepare(
    `INSERT INTO tickets (id, title, description, status, priority, requester_id)
     VALUES (?, 'Nätverket nere', 'Ingen anslutning', 'open', 'high', ?)`
  ).run(ticketId, contactId);
  return ticketId;
}

beforeAll(() => {
  initializeDatabase();
  db.prepare('INSERT INTO webhooks (id, url, events, secret, active) VALUES (?, ?, ?, ?, 1)')
    .run(randomUUID(), HOOK_URL, JSON.stringify(['comment.created']), 'notif-secret-key');
});

afterEach(() => {
  vi.restoreAllMocks();
  pushMock.mockClear();
  captured = [];
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('notifyCustomerOfPublicReply', () => {
  it('dispatches a comment.created webhook (is_internal=false) for the agent reply', async () => {
    stubFetch();
    const ticketId = makeTicketWithRequester();

    await notifyCustomerOfPublicReply(ticketId, 'Vi tittar på det nu.');

    expect(captured).toHaveLength(1);
    expect(captured[0].event).toBe('comment.created');
    const payload = JSON.parse(captured[0].body).payload;
    expect(payload.ticket_id).toBe(ticketId);
    expect(payload.is_internal).toBe(false);
  });

  it('does not throw for a non-existent ticket and dispatches nothing', async () => {
    stubFetch();
    await expect(notifyCustomerOfPublicReply(randomUUID(), 'orphan')).resolves.toBeUndefined();
    expect(captured).toHaveLength(0);
  });
});

describe('notifyAgentOfCustomerReply', () => {
  it('dispatches a comment.created webhook tagged source=email', async () => {
    stubFetch();
    const userId = randomUUID();
    db.prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(userId, 'agent@itticket.local', 'x', 'user');
    const ticketId = makeTicketWithRequester();
    db.prepare('UPDATE tickets SET assigned_to = ? WHERE id = ?').run(userId, ticketId);

    await notifyAgentOfCustomerReply(ticketId, 'Det funkar fortfarande inte.');

    expect(captured).toHaveLength(1);
    expect(captured[0].event).toBe('comment.created');
    const payload = JSON.parse(captured[0].body).payload;
    expect(payload.ticket_id).toBe(ticketId);
    expect(payload.source).toBe('email');
    // Push targets only the assigned agent.
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][1]).toBe(userId);
  });

  it('does NOT broadcast push when the ticket is unassigned (still fires the webhook)', async () => {
    stubFetch();
    const ticketId = makeTicketWithRequester(); // assigned_to is null

    await notifyAgentOfCustomerReply(ticketId, 'fortfarande trasigt');

    // Webhook still closes the loop...
    expect(captured.some((c) => c.event === 'comment.created')).toBe(true);
    // ...but we do not push the ticket title to every staff device.
    expect(pushMock).not.toHaveBeenCalled();
  });
});
