import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter, createFailureTracker } from './rateLimit.js';

// Verifierar den optionella onLimitExceeded-hooken som lades till för att
// callback-rutor (top-level-navigationer) ska kunna redirecta istället för
// att svara med rått JSON-429 — se server/src/routes/auth.ts (oidc/callback).
describe('createRateLimiter — onLimitExceeded', () => {
  it('utan custom handler: 429 med standard-JSON-body', async () => {
    const app = express();
    app.get('/x', createRateLimiter(60_000, 1), (_req, res) => res.json({ ok: true }));

    expect((await request(app).get('/x')).status).toBe(200);
    const res = await request(app).get('/x');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('med custom handler: anropas istället för default-JSON-svaret (t.ex. redirect)', async () => {
    const app = express();
    app.get(
      '/x',
      createRateLimiter(60_000, 1, (_req, res) => res.redirect('/login?sso_error=failed')),
      (_req, res) => res.json({ ok: true })
    );

    expect((await request(app).get('/x')).status).toBe(200);
    const res = await request(app).get('/x');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso_error=failed');
  });
});

describe('createRateLimiter — skipSuccessfulRequests', () => {
  it('only failed responses (>= 400) use up the budget', async () => {
    const app = express();
    app.get(
      '/x',
      createRateLimiter(60_000, 2, undefined, { skipSuccessfulRequests: true }),
      (req, res) => res.status(req.query.fail ? 401 : 200).json({})
    );

    for (let i = 0; i < 5; i++) expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x?fail=1')).status).toBe(401);
    expect((await request(app).get('/x?fail=1')).status).toBe(401);
    // Budget (2 failures) spent: even a would-be success is blocked.
    expect((await request(app).get('/x')).status).toBe(429);
  });

  it('without the option successes do count', async () => {
    const app = express();
    app.get('/x', createRateLimiter(60_000, 2), (_req, res) => res.json({}));
    await request(app).get('/x');
    await request(app).get('/x');
    expect((await request(app).get('/x')).status).toBe(429);
  });
});

describe('createRateLimiter — keyGenerator', () => {
  it('buckets by the generated key instead of IP, falling back to IP when it returns undefined', async () => {
    const app = express();
    app.get(
      '/x',
      createRateLimiter(60_000, 1, undefined, { keyGenerator: (req) => (req.query.u as string | undefined) }),
      (_req, res) => res.json({})
    );
    expect((await request(app).get('/x?u=a')).status).toBe(200);
    expect((await request(app).get('/x?u=b')).status).toBe(200);
    expect((await request(app).get('/x?u=a')).status).toBe(429);
    // Utan nyckel används IP-bucketen.
    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(429);
  });
});

describe('createFailureTracker', () => {
  it('locks a key at max failures, reports seconds left, and reset() clears it', () => {
    const tracker = createFailureTracker(60_000, 3);
    expect(tracker.lockedFor('a')).toBe(0);
    tracker.recordFailure('a');
    tracker.recordFailure('a');
    expect(tracker.lockedFor('a')).toBe(0);
    tracker.recordFailure('a');
    const wait = tracker.lockedFor('a');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    expect(tracker.lockedFor('b')).toBe(0);
    tracker.reset('a');
    expect(tracker.lockedFor('a')).toBe(0);
  });

  it('remembers only the five most recent successful IPs per key and clears failures on success', () => {
    const tracker = createFailureTracker(60_000, 1);
    tracker.recordFailure('a');
    expect(tracker.lockedFor('a')).toBeGreaterThan(0);
    tracker.recordSuccess('a', 'ip-1');
    expect(tracker.lockedFor('a')).toBe(0);

    for (const ip of ['ip-2', 'ip-3', 'ip-4', 'ip-5', 'ip-6']) tracker.recordSuccess('a', ip);
    expect(tracker.isKnownIp('a', 'ip-1')).toBe(false);
    expect(tracker.isKnownIp('a', 'ip-6')).toBe(true);
    expect(tracker.isKnownIp('b', 'ip-6')).toBe(false);
  });

  it('forgets failures once the window has passed', () => {
    vi.useFakeTimers();
    try {
      const tracker = createFailureTracker(1_000, 1);
      tracker.recordFailure('a');
      expect(tracker.lockedFor('a')).toBeGreaterThan(0);
      vi.advanceTimersByTime(1_500);
      expect(tracker.lockedFor('a')).toBe(0);
      tracker.recordFailure('a');
      expect(tracker.lockedFor('a')).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
