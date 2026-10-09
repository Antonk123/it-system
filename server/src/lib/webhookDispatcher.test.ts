import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Tester för dispatchWebhook/processWebhookRetries: backoff, non-2xx, redirect,
 * avstängd webhook, trasig events-rad och krasch-återhämtning. Date fejkas så
 * backoff-tidsstämplar blir deterministiska; fetch stubbas (inget riktigt nät).
 * Webhook-URL:en är en publik IP-literal så isSafeWebhookUrl inte gör DNS.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-webhook-dispatcher.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-whdisp-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-whdisp-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { dispatchWebhook, processWebhookRetries } from './webhookDispatcher.js';

const HOOK_URL = 'https://93.184.216.34/receiver';
const T0 = new Date('2026-01-01T12:00:00.000Z');

interface DeliveryRow {
  id: string;
  response_code: number | null;
  attempts: number;
  delivered_at: string | null;
  next_retry_at: string | null;
  last_error: string | null;
}

function addWebhook(opts: { events?: string; active?: number; url?: string } = {}): string {
  const id = randomUUID();
  db.prepare('INSERT INTO webhooks (id, url, events, secret, active) VALUES (?, ?, ?, ?, ?)')
    .run(id, opts.url ?? HOOK_URL, opts.events ?? JSON.stringify(['ticket.created']), 'secret', opts.active ?? 1);
  return id;
}

function deliveriesOf(webhookId: string): DeliveryRow[] {
  return db.prepare(
    'SELECT id, response_code, attempts, delivered_at, next_retry_at, last_error FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at, rowid'
  ).all(webhookId) as DeliveryRow[];
}

const fetchMock = vi.fn();

beforeAll(() => {
  initializeDatabase();
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

beforeEach(() => {
  db.prepare('DELETE FROM webhooks').run();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dispatchWebhook', () => {
  it('marks a 2xx delivery as delivered and clears next_retry_at', async () => {
    const id = addWebhook();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await dispatchWebhook('ticket.created', { id: 't1' });

    const [d] = deliveriesOf(id);
    expect(d.delivered_at).toBeTruthy();
    expect(d.attempts).toBe(1);
    expect(d.next_retry_at).toBeNull();
    expect(d.response_code).toBe(204);
  });

  it.each([200, 500, 302])('cancels the unread response body after a %i so the socket is released', async (status) => {
    addWebhook();
    const body = new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode('ignored')) });
    const cancel = vi.spyOn(body, 'cancel');
    fetchMock.mockResolvedValue(new Response(body, { status }));

    await dispatchWebhook('ticket.created', { id: 't1' });

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('schedules a retry in 1 minute after the first non-2xx response', async () => {
    const id = addWebhook();
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await dispatchWebhook('ticket.created', { id: 't1' });

    const [d] = deliveriesOf(id);
    expect(d.delivered_at).toBeNull();
    expect(d.attempts).toBe(1);
    expect(d.response_code).toBe(500);
    expect(d.last_error).toBe('HTTP 500');
    expect(d.next_retry_at).toBe(new Date(T0.getTime() + 60_000).toISOString());
  });

  it('records network errors and schedules a retry', async () => {
    const id = addWebhook();
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await dispatchWebhook('ticket.created', { id: 't1' });

    const [d] = deliveriesOf(id);
    expect(d.response_code).toBe(0);
    expect(d.last_error).toBe('ECONNRESET');
    expect(d.next_retry_at).not.toBeNull();
  });

  it('does not follow redirects and treats a 3xx as a final failure', async () => {
    const id = addWebhook();
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://10.0.0.1/' } }));

    await dispatchWebhook('ticket.created', { id: 't1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
    const [d] = deliveriesOf(id);
    expect(d.delivered_at).toBeNull();
    expect(d.next_retry_at).toBeNull();
    expect(d.response_code).toBe(302);
    expect(d.last_error).toMatch(/Redirect/);
  });

  it('gives up without a fetch when the URL fails re-validation', async () => {
    const id = addWebhook({ url: 'https://[::ffff:127.0.0.1]/x' });

    await dispatchWebhook('ticket.created', { id: 't1' });

    expect(fetchMock).not.toHaveBeenCalled();
    const [d] = deliveriesOf(id);
    expect(d.next_retry_at).toBeNull();
    expect(d.last_error).toMatch(/re-validation failed/);
  });

  it('skips inactive webhooks', async () => {
    const id = addWebhook({ active: 0 });
    await dispatchWebhook('ticket.created', { id: 't1' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deliveriesOf(id)).toHaveLength(0);
  });

  it('a malformed events row does not stop other webhooks', async () => {
    const bad = addWebhook({ events: 'not json' });
    const notArray = addWebhook({ events: '{"a":1}' });
    const good = addWebhook();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(dispatchWebhook('ticket.created', { id: 't1' })).resolves.toBeUndefined();

    expect(deliveriesOf(bad)).toHaveLength(0);
    expect(deliveriesOf(notArray)).toHaveLength(0);
    expect(deliveriesOf(good)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('one delivery that throws (rejects) does not reject the whole dispatch', async () => {
    const first = addWebhook();
    const second = addWebhook();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    // Första leverans-INSERT:en kastar (t.ex. låst/full DB) -> deliverOne rejectar.
    const realPrepare = db.prepare.bind(db);
    let thrown = false;
    const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (!thrown && sql.startsWith('INSERT INTO webhook_deliveries')) {
        thrown = true;
        throw new Error('database is locked');
      }
      return realPrepare(sql);
    }) as typeof db.prepare);

    try {
      await expect(dispatchWebhook('ticket.created', { id: 't1' })).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }

    expect(deliveriesOf(first).length + deliveriesOf(second).length).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('matches wildcard subscriptions', async () => {
    const id = addWebhook({ events: JSON.stringify(['*']) });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await dispatchWebhook('contact.created', { id: 'c1' });
    expect(deliveriesOf(id)).toHaveLength(1);
  });

  it('persists the delivery with a future next_retry_at so a crash before the first attempt is recoverable', async () => {
    const id = addWebhook();
    let rowDuringFetch: DeliveryRow | undefined;
    fetchMock.mockImplementation(async () => {
      rowDuringFetch = deliveriesOf(id)[0];
      return new Response(null, { status: 200 });
    });

    await dispatchWebhook('ticket.created', { id: 't1' });

    expect(rowDuringFetch?.attempts).toBe(0);
    expect(rowDuringFetch?.next_retry_at).toBe(new Date(T0.getTime() + 2 * 60_000).toISOString());
  });
});

describe('processWebhookRetries', () => {
  it('retries a due delivery with backoff 1 -> 5 -> 30 -> 120 min, then gives up after 5 attempts', async () => {
    const id = addWebhook();
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await dispatchWebhook('ticket.created', { id: 't1' });

    const expectedDelaysMin = [5, 30, 120, 360];
    let now = T0.getTime();
    for (const delay of expectedDelaysMin) {
      // Före förfallotid händer ingenting.
      const before = deliveriesOf(id)[0];
      await processWebhookRetries();
      expect(deliveriesOf(id)[0].attempts).toBe(before.attempts);

      now = new Date(before.next_retry_at!).getTime();
      vi.setSystemTime(now);
      await processWebhookRetries();
      const after = deliveriesOf(id)[0];
      expect(after.attempts).toBe(before.attempts + 1);
      if (after.attempts < 5) {
        expect(after.next_retry_at).toBe(new Date(now + delay * 60_000).toISOString());
      }
    }

    const final = deliveriesOf(id)[0];
    expect(final.attempts).toBe(5);
    expect(final.next_retry_at).toBeNull();
    expect(final.delivered_at).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    vi.setSystemTime(now + 24 * 3_600_000);
    await processWebhookRetries();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('delivers on a successful retry', async () => {
    const id = addWebhook();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await dispatchWebhook('ticket.created', { id: 't1' });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.setSystemTime(new Date(T0.getTime() + 61_000));
    await processWebhookRetries();

    const [d] = deliveriesOf(id);
    expect(d.delivered_at).toBeTruthy();
    expect(d.attempts).toBe(2);
    expect(d.next_retry_at).toBeNull();
    const wh = db.prepare('SELECT last_triggered_at FROM webhooks WHERE id = ?').get(id) as { last_triggered_at: string | null };
    expect(wh.last_triggered_at).toBeTruthy();
  });

  it('uses a fresh timestamp but the same delivery id on each retry', async () => {
    addWebhook();
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await dispatchWebhook('ticket.created', { id: 't1' });
    vi.setSystemTime(new Date(T0.getTime() + 61_000));
    await processWebhookRetries();

    const [first, second] = fetchMock.mock.calls.map((c) => c[1].headers as Record<string, string>);
    expect(second['X-Webhook-Id']).toBe(first['X-Webhook-Id']);
    expect(Number(second['X-Webhook-Timestamp'])).toBe(Number(first['X-Webhook-Timestamp']) + 61);
    expect(second['X-Webhook-Signature']).not.toBe(first['X-Webhook-Signature']);
  });

  it('drops pending deliveries of a webhook that was disabled meanwhile', async () => {
    const id = addWebhook();
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await dispatchWebhook('ticket.created', { id: 't1' });
    db.prepare('UPDATE webhooks SET active = 0 WHERE id = ?').run(id);
    fetchMock.mockClear();

    vi.setSystemTime(new Date(T0.getTime() + 61_000));
    await processWebhookRetries();

    expect(fetchMock).not.toHaveBeenCalled();
    const [d] = deliveriesOf(id);
    expect(d.next_retry_at).toBeNull();
    expect(d.last_error).toBe('Webhook deactivated');
  });

  it('picks up a delivery that was inserted but never attempted (crash recovery)', async () => {
    const id = addWebhook();
    const deliveryId = randomUUID();
    db.prepare('INSERT INTO webhook_deliveries (id, webhook_id, event, payload, attempts, next_retry_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(deliveryId, id, 'ticket.created', '{}', new Date(T0.getTime() + 2 * 60_000).toISOString());
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await processWebhookRetries();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(T0.getTime() + 3 * 60_000));
    await processWebhookRetries();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deliveriesOf(id)[0].delivered_at).toBeTruthy();
  });

  it('does nothing when no delivery is due', async () => {
    await expect(processWebhookRetries()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
