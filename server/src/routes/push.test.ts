import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';

/**
 * Integration tests for the push-subscription routes (audit L21: previously
 * untested).
 *
 * NOTE: push.ts has NO requireAdmin anywhere (verified by reading the file —
 * all three routes are `authenticate`-only), so there is no 403/admin path to
 * test here — only 401 without auth. This file also never calls an external
 * push/VAPID service; /subscribe and /unsubscribe are plain DB writes, and
 * /vapid-public-key only reads process.env.VAPID_PUBLIC_KEY, so everything
 * below runs without external dependencies.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-push.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-push-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-push-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;

let userAgent: ReturnType<typeof request.agent>;
let userToken: string;
let userCsrf: string;
let userId: string;

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  const token = login.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  return { agent, token, csrf: csrfRes.body.csrfToken as string };
}

async function anonCsrf() {
  const agent = request.agent(app);
  const res = await agent.get('/api/csrf-token');
  expect(res.status).toBe(200);
  return { agent, csrf: res.body.csrfToken as string };
}

beforeAll(async () => {
  initializeDatabase();

  userId = randomUUID();
  const userHash = await bcrypt.hash('User-P@ss1234!', 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, 'user@pushtest.local', userHash, 'user', 'Push User');

  app = createApp();

  ({ agent: userAgent, token: userToken, csrf: userCsrf } = await loginAgent('user@pushtest.local', 'User-P@ss1234!'));
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/push/vapid-public-key — auth', () => {
  it('401 without authentication', async () => {
    const res = await request(app).get('/api/push/vapid-public-key');
    expect(res.status).toBe(401);
  });

  it('503 when VAPID_PUBLIC_KEY is not configured', async () => {
    const prev = process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    try {
      const res = await userAgent.get('/api/push/vapid-public-key').set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(503);
    } finally {
      if (prev !== undefined) process.env.VAPID_PUBLIC_KEY = prev;
    }
  });

  it('200 with the key when VAPID_PUBLIC_KEY is configured', async () => {
    const prev = process.env.VAPID_PUBLIC_KEY;
    process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key';
    try {
      const res = await userAgent.get('/api/push/vapid-public-key').set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      expect(res.body.vapidPublicKey).toBe('test-vapid-public-key');
    } finally {
      if (prev === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = prev;
    }
  });
});

describe('POST /api/push/subscribe — auth', () => {
  it('401 without authentication (CSRF passed via anon token, still no JWT)', async () => {
    const { agent, csrf } = await anonCsrf();
    const res = await agent
      .post('/api/push/subscribe')
      .set('x-csrf-token', csrf)
      .send({ endpoint: 'https://push.example.com/should-not-insert', keys: { p256dh: 'p', auth: 'a' } });
    expect(res.status).toBe(401);
    const row = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get('https://push.example.com/should-not-insert');
    expect(row).toBeUndefined();
  });

  it('400 when keys are missing', async () => {
    const res = await userAgent
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ endpoint: 'https://push.example.com/no-keys' });
    expect(res.status).toBe(400);
  });
});

describe('Subscribe → unsubscribe cycle', () => {
  const endpoint = 'https://push.example.com/sub-1';

  it('creates a subscription row tied to the authenticated user (201)', async () => {
    const res = await userAgent
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const row = db.prepare('SELECT endpoint, p256dh, auth, user_id FROM push_subscriptions WHERE endpoint = ?').get(endpoint) as
      { endpoint: string; p256dh: string; auth: string; user_id: string };
    expect(row.p256dh).toBe('p256dh-value');
    expect(row.user_id).toBe(userId);
  });

  it('upserts on a duplicate endpoint (same row, updated keys)', async () => {
    const res = await userAgent
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ endpoint, keys: { p256dh: 'p256dh-updated', auth: 'auth-value' } });
    expect(res.status).toBe(201);

    const rows = db.prepare('SELECT p256dh FROM push_subscriptions WHERE endpoint = ?').all(endpoint) as { p256dh: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].p256dh).toBe('p256dh-updated');
  });

  it('removes the subscription via DELETE /unsubscribe', async () => {
    const res = await userAgent
      .delete('/api/push/unsubscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({ endpoint });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const row = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
    expect(row).toBeUndefined();
  });

  it('400 when unsubscribe is missing the endpoint', async () => {
    const res = await userAgent
      .delete('/api/push/unsubscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .set('x-csrf-token', userCsrf)
      .send({});
    expect(res.status).toBe(400);
  });
});
