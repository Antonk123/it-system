import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from './rateLimit.js';

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
