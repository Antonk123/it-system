import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID, createHmac } from 'crypto';

/**
 * Integration tests for the webhooks routes (/api/webhooks) and the HMAC signing
 * performed by the dispatcher (server/src/lib/webhookDispatcher.ts).
 *
 * Coverage:
 *  1. CRUD authorization: every webhook route is `authenticate + requireAdmin`,
 *     so a non-admin user is rejected (403) while an admin can list/create.
 *     URL validation (SSRF guard) and event validation are also exercised.
 *  2. HMAC-SHA256 signing (audit-v3 MEDIUM — previously untested): when a
 *     delivery is dispatched, the X-Webhook-Signature header equals
 *     HMAC-SHA256(secret, `${timestamp}.${deliveryId}.${body}`). A consumer can
 *     recompute and match; a tampered payload fails verification.
 *
 *     Why we call dispatchWebhook() directly instead of triggering it via an
 *     HTTP route: the route handlers fire dispatchWebhook() fire-and-forget
 *     (`.catch(...)` with no await), so the HTTP response returns before the
 *     real fetch() happens — there is no synchronous signal that delivery
 *     occurred. Calling dispatchWebhook() directly lets us await delivery and
 *     capture the exact signature/body that would go over the wire. global.fetch
 *     is stubbed so no real network call is made. The webhook row is inserted
 *     straight into the DB with a PUBLIC https IP-literal URL so the dispatcher's
 *     re-validation (isSafeWebhookUrl) passes WITHOUT a DNS lookup (literal IPv4
 *     path) and without network access.
 *
 * Harness mirrors checklists.test.ts / app.test.ts:
 *  - vi.hoisted() sets a UNIQUE DB_PATH (suffix -webhooks), NODE_ENV=test, and
 *    CSRF_SECRET/JWT_SECRET (>=32 chars) BEFORE any import that loads
 *    db/connection.ts.
 *  - Login is rate-limited (5/15min per IP): each user logs in once and is reused.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-webhooks.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-webhooks-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-webhooks-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';
import { dispatchWebhook } from '../lib/webhookDispatcher.js';

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
    .run(adminId, 'admin@webhookstest.local', adminHash, 'admin', 'Webhooks Admin');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, 'user@webhookstest.local', userHash, 'user', 'Webhooks User');

  app = createApp();

  admin = await login('admin@webhookstest.local', 'Admin-P@ss1234!');
  user = await login('user@webhookstest.local', 'User-P@ss1234!');
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('Webhook CRUD authorization (admin-only)', () => {
  // A public, routable HTTPS IP literal. isSafeWebhookUrl treats this as a v4
  // literal and skips DNS (no network), and it is outside every private range,
  // so it passes the SSRF guard.
  const PUBLIC_URL = 'https://93.184.216.34/hook';

  it('blocks a non-admin from listing webhooks (403)', async () => {
    const res = await request(app)
      .get('/api/webhooks')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(403);
  });

  it('blocks a non-admin from creating a webhook (403)', async () => {
    const res = await user.agent
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf)
      .send({ url: PUBLIC_URL, events: ['ticket.created'] });
    expect(res.status).toBe(403);
  });

  it('requires authentication (401 without a token)', async () => {
    const res = await request(app).get('/api/webhooks');
    expect(res.status).toBe(401);
  });

  it('lets an admin create a webhook and returns a secret (201)', async () => {
    const res = await admin.agent
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ url: PUBLIC_URL, events: ['ticket.created', 'ticket.updated'] });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.secret).toBe('string');
    expect(res.body.secret.length).toBeGreaterThan(0);
    expect(res.body.active).toBe(1);
  });

  it('lets an admin list webhooks WITHOUT leaking the secret', async () => {
    const res = await request(app)
      .get('/api/webhooks')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // The list projection excludes `secret`.
    for (const w of res.body) {
      expect(w.secret).toBeUndefined();
    }
  });

  it('rejects an unsafe (SSRF) webhook URL (400)', async () => {
    const res = await admin.agent
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ url: 'https://localhost/evil', events: ['ticket.created'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid webhook url/i);
  });

  it('rejects an invalid event type (400)', async () => {
    const res = await admin.agent
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ url: PUBLIC_URL, events: ['not.a.real.event'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid event type/i);
  });

  // ticket.closed is dispatched by tickets.ts but was historically missing from
  // VALID_EVENTS, so consumers could not subscribe to a real, fired event.
  it('lets an admin subscribe to ticket.closed (201)', async () => {
    const res = await admin.agent
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ url: PUBLIC_URL, events: ['ticket.closed'] });
    expect(res.status).toBe(201);
  });

  // Retired SLA events are no longer accepted for new subscriptions.
  it('rejects subscriptions to retired SLA events (400)', async () => {
    const res = await admin.agent
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ url: PUBLIC_URL, events: ['sla.response.breached', 'sla.resolution.breached'] });
    expect(res.status).toBe(400);
  });

  it('PUT validates events (400 on unknown/non-array/empty)', async () => {
    const id = randomUUID();
    db.prepare('INSERT INTO webhooks (id, url, events, secret) VALUES (?, ?, ?, ?)')
      .run(id, PUBLIC_URL, JSON.stringify(['ticket.created']), 'secret-put');
    for (const bad of [['bogus.event'], 'ticket.created', [], [1, 2], { a: 1 }]) {
      const res = await admin.agent
        .put(`/api/webhooks/${id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('x-csrf-token', admin.csrf)
        .send({ events: bad });
      expect(res.status).toBe(400);
    }
    // Stored events unchanged after the rejected updates.
    const row = db.prepare('SELECT events FROM webhooks WHERE id = ?').get(id) as { events: string };
    expect(JSON.parse(row.events)).toEqual(['ticket.created']);
  });

  it('PUT stores validated, de-duplicated events', async () => {
    const id = randomUUID();
    db.prepare('INSERT INTO webhooks (id, url, events, secret) VALUES (?, ?, ?, ?)')
      .run(id, PUBLIC_URL, JSON.stringify(['ticket.created']), 'secret-put2');
    const res = await admin.agent
      .put(`/api/webhooks/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ events: ['contact.created', 'contact.created', 'contact.updated'], active: false });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.events)).toEqual(['contact.created', 'contact.updated']);
    expect(res.body.active).toBe(0);
  });

  it('PUT returns 404 for an unknown webhook and 400 for an unsafe URL', async () => {
    const missing = await admin.agent
      .put(`/api/webhooks/${randomUUID()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ active: true });
    expect(missing.status).toBe(404);

    const id = randomUUID();
    db.prepare('INSERT INTO webhooks (id, url, events, secret) VALUES (?, ?, ?, ?)')
      .run(id, PUBLIC_URL, JSON.stringify(['ticket.created']), 'secret-put3');
    const unsafe = await admin.agent
      .put(`/api/webhooks/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ url: 'https://[::ffff:127.0.0.1]/x' });
    expect(unsafe.status).toBe(400);
  });

  it('lists deliveries for a webhook (admin only)', async () => {
    const id = randomUUID();
    db.prepare('INSERT INTO webhooks (id, url, events, secret) VALUES (?, ?, ?, ?)')
      .run(id, PUBLIC_URL, JSON.stringify(['ticket.created']), 'secret-del-list');
    db.prepare('INSERT INTO webhook_deliveries (id, webhook_id, event, payload, attempts) VALUES (?, ?, ?, ?, 0)')
      .run(randomUUID(), id, 'ticket.created', '{}');
    const res = await request(app).get(`/api/webhooks/${id}/deliveries`).set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const denied = await request(app).get(`/api/webhooks/${id}/deliveries`).set('Authorization', `Bearer ${user.token}`);
    expect(denied.status).toBe(403);
  });

  it('DELETE returns 404 for an unknown webhook', async () => {
    const res = await admin.agent
      .delete(`/api/webhooks/${randomUUID()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(404);
  });

  it('blocks a non-admin from deleting a webhook (403)', async () => {
    const id = randomUUID();
    db.prepare('INSERT INTO webhooks (id, url, events, secret) VALUES (?, ?, ?, ?)')
      .run(id, PUBLIC_URL, JSON.stringify(['ticket.created']), 'secret-xyz');
    const res = await user.agent
      .delete(`/api/webhooks/${id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf);
    expect(res.status).toBe(403);
    // Still present — the non-admin could not delete it.
    expect(db.prepare('SELECT id FROM webhooks WHERE id = ?').get(id)).toBeDefined();
  });

  it('lets an admin delete a webhook (200)', async () => {
    const id = randomUUID();
    db.prepare('INSERT INTO webhooks (id, url, events, secret) VALUES (?, ?, ?, ?)')
      .run(id, PUBLIC_URL, JSON.stringify(['ticket.created']), 'secret-del');
    const res = await admin.agent
      .delete(`/api/webhooks/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT id FROM webhooks WHERE id = ?').get(id)).toBeUndefined();
  });
});

describe('Webhook HMAC-SHA256 signing on delivery', () => {
  const SECRET = 'd3adb33fd3adb33fd3adb33fd3adb33fd3adb33fd3adb33fd3adb33fd3adb33f0';
  // Public, routable HTTPS IP literal → passes the dispatcher's re-validation
  // (isSafeWebhookUrl) with no DNS lookup, no real network.
  const HOOK_URL = 'https://93.184.216.34/receiver';

  let webhookId: string;
  // Captured from the stubbed fetch on the most recent delivery.
  let captured: { url: string; signature: string | undefined; event: string | undefined; timestamp: string | undefined; deliveryId: string | undefined; body: string; redirect: RequestRedirect | undefined } | null;

  beforeAll(() => {
    webhookId = randomUUID();
    db.prepare('INSERT INTO webhooks (id, url, events, secret, active) VALUES (?, ?, ?, ?, 1)')
      .run(webhookId, HOOK_URL, JSON.stringify(['ticket.created']), SECRET);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    captured = null;
  });

  function stubFetch(status = 200) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        captured = {
          url: String(url),
          signature: headers['X-Webhook-Signature'],
          event: headers['X-Webhook-Event'],
          timestamp: headers['X-Webhook-Timestamp'],
          deliveryId: headers['X-Webhook-Id'],
          body: String(init.body),
          redirect: init.redirect,
        };
        return new Response(null, { status });
      }),
    );
  }

  it('sends X-Webhook-Signature == HMAC-SHA256(secret, timestamp.id.body) that a consumer can recompute', async () => {
    stubFetch(200);

    await dispatchWebhook('ticket.created', { id: 'tkt-1', title: 'Hello', status: 'open' });

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe(HOOK_URL);
    expect(captured!.event).toBe('ticket.created');
    expect(typeof captured!.signature).toBe('string');

    // A consumer recomputes the signature from the raw body + shared secret.
    expect(captured!.timestamp).toMatch(/^\d{10}$/);
    expect(captured!.deliveryId).toMatch(/^[0-9a-f-]{36}$/);
    const expected = createHmac('sha256', SECRET)
      .update(`${captured!.timestamp}.${captured!.deliveryId}.${captured!.body}`)
      .digest('hex');
    expect(captured!.signature).toBe(expected);

    // Redirects must never be followed (SSRF bypass).
    expect(captured!.redirect).toBe('manual');

    // Sanity: the body is the JSON envelope the dispatcher builds.
    const parsed = JSON.parse(captured!.body);
    expect(parsed.event).toBe('ticket.created');
    expect(parsed.payload).toMatchObject({ id: 'tkt-1', title: 'Hello', status: 'open' });
    expect(typeof parsed.timestamp).toBe('string');

    // The delivery row records success.
    const delivery = db.prepare(
      'SELECT response_code, delivered_at, attempts FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(webhookId) as { response_code: number; delivered_at: string | null; attempts: number };
    expect(delivery.response_code).toBe(200);
    expect(delivery.delivered_at).toBeTruthy();
    expect(delivery.attempts).toBe(1);
  });

  it('a TAMPERED payload fails signature verification', async () => {
    stubFetch(200);

    await dispatchWebhook('ticket.created', { id: 'tkt-2', title: 'Original', status: 'open' });

    expect(captured).not.toBeNull();
    const realSignature = captured!.signature!;

    // Attacker flips a byte in the transmitted body but cannot resign without
    // the secret. Recomputing over the tampered body yields a different MAC.
    const tamperedBody = captured!.body.replace('Original', 'Tampered');
    expect(tamperedBody).not.toBe(captured!.body);
    const signed = (secret: string, ts: string, id: string, body: string) =>
      createHmac('sha256', secret).update(`${ts}.${id}.${body}`).digest('hex');
    expect(signed(SECRET, captured!.timestamp!, captured!.deliveryId!, tamperedBody)).not.toBe(realSignature);

    // And a wrong secret, timestamp or delivery id cannot reproduce it either.
    expect(signed('wrong-secret', captured!.timestamp!, captured!.deliveryId!, captured!.body)).not.toBe(realSignature);
    expect(signed(SECRET, String(Number(captured!.timestamp) + 1), captured!.deliveryId!, captured!.body)).not.toBe(realSignature);
    expect(signed(SECRET, captured!.timestamp!, 'other-id', captured!.body)).not.toBe(realSignature);
  });

  it('does not deliver to webhooks that did not subscribe to the event', async () => {
    stubFetch(200);
    // This webhook only subscribes to ticket.created; dispatch a different event.
    await dispatchWebhook('comment.created', { id: 'c-1' });
    // fetch must not have been called for our hook (no matching subscriber).
    expect(captured).toBeNull();
  });
});
