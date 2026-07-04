import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-oidc-routes.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-oidcr-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-oidcr-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

// Mocka openid-client: deterministiska värden, ingen nätverkstrafik.
vi.mock('openid-client', () => ({
  discovery: vi.fn(async () => ({ mockConfig: true })),
  randomPKCECodeVerifier: vi.fn(() => 'test-verifier'),
  calculatePKCECodeChallenge: vi.fn(async () => 'test-challenge'),
  randomState: vi.fn(() => 'test-state'),
  randomNonce: vi.fn(() => 'test-nonce'),
  buildAuthorizationUrl: vi.fn(
    () => new URL('https://idp.example/authorize?client_id=client-123&state=test-state')
  ),
  authorizationCodeGrant: vi.fn(), // används i Task 4-testerna
}));

import request from 'supertest';
import { initializeDatabase, closeDatabase, db } from '../db/connection.js';
import { createApp } from '../app.js';
import { resetOidcCache } from '../lib/oidc.js';
import * as oidcClient from 'openid-client';

let app: ReturnType<typeof createApp>;

const OIDC_ENV = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_BUTTON_LABEL'];
function setFullOidcEnv() {
  process.env.OIDC_ISSUER_URL = 'https://login.microsoftonline.com/tenant/v2.0';
  process.env.OIDC_CLIENT_ID = 'client-123';
  process.env.OIDC_CLIENT_SECRET = 'secret-abc';
  process.env.OIDC_REDIRECT_URI = 'https://ticket.example.se/api/auth/oidc/callback';
}

beforeAll(() => { initializeDatabase(); app = createApp(); });
afterAll(() => { closeDatabase(); if (existsSync(DB_PATH)) rmSync(DB_PATH); });
beforeEach(() => {
  OIDC_ENV.forEach((k) => delete process.env[k]);
  resetOidcCache();
  vi.clearAllMocks();
});

describe('GET /api/auth/oidc/enabled', () => {
  it('utan config → { enabled: false, label: null }', async () => {
    const res = await request(app).get('/api/auth/oidc/enabled');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, label: null });
  });
  it('med config → { enabled: true, label }', async () => {
    setFullOidcEnv();
    process.env.OIDC_BUTTON_LABEL = 'Logga in med Microsoft';
    const res = await request(app).get('/api/auth/oidc/enabled');
    expect(res.body).toEqual({ enabled: true, label: 'Logga in med Microsoft' });
  });
});

describe('GET /api/auth/oidc/login', () => {
  it('utan config → 503', async () => {
    const res = await request(app).get('/api/auth/oidc/login');
    expect(res.status).toBe(503);
  });
  it('med config → 302 till IdP + oidcTx-cookie (HttpOnly, Lax, scopad path)', async () => {
    setFullOidcEnv();
    const res = await request(app).get('/api/auth/oidc/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://idp.example/authorize');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('oidcTx='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/auth/oidc');
  });
  it('discovery-fel → 503 och felet cachas INTE (nästa lyckas)', async () => {
    setFullOidcEnv();
    (oidcClient.discovery as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('idp down'));
    expect((await request(app).get('/api/auth/oidc/login')).status).toBe(503);
    expect((await request(app).get('/api/auth/oidc/login')).status).toBe(302);
  });
});

function seedUser(email: string, oidcSub: string | null = null): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, role, oidc_sub) VALUES (?, ?, 'x', 'user', ?)")
    .run(id, email, oidcSub);
  return id;
}

const TX_COOKIE = `oidcTx=${encodeURIComponent(JSON.stringify({ state: 'test-state', nonce: 'test-nonce', codeVerifier: 'test-verifier' }))}`;

function mockGrantSuccess(claims: Record<string, unknown>) {
  (oidcClient.authorizationCodeGrant as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    claims: () => claims,
  });
}

describe('GET /api/auth/oidc/callback', () => {
  beforeEach(() => { db.prepare('DELETE FROM users').run(); db.prepare('DELETE FROM refresh_tokens').run(); });

  it('lyckad inloggning: länkar sub, sätter refresh-cookie, 302 → /login?sso=1', async () => {
    setFullOidcEnv();
    const userId = seedUser('anna@x.se');
    mockGrantSuccess({ sub: 'sub-1', email: 'anna@x.se' });
    const res = await request(app)
      .get('/api/auth/oidc/callback?code=abc&state=test-state')
      .set('Cookie', TX_COOKIE);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso=1');
    const setCookies = res.headers['set-cookie'] as unknown as string[];
    expect(setCookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: 'sub-1' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?').get(userId)).toMatchObject({ n: 1 });
  });

  it('refresh-cookien från SSO fungerar mot befintliga POST /refresh', async () => {
    setFullOidcEnv();
    seedUser('anna@x.se');
    mockGrantSuccess({ sub: 'sub-1', email: 'anna@x.se' });
    const cb = await request(app).get('/api/auth/oidc/callback?code=abc&state=test-state').set('Cookie', TX_COOKIE);
    const refreshCookie = (cb.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('refreshToken='))!.split(';')[0];
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeDefined();
  });

  it('okänd användare → 302 /login?sso_error=unknown_user, inget konto skapas', async () => {
    setFullOidcEnv();
    mockGrantSuccess({ sub: 'sub-x', email: 'ghost@x.se' });
    const res = await request(app).get('/api/auth/oidc/callback?code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=unknown_user');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 0 });
  });

  it('saknad tx-cookie → 302 /login?sso_error=failed (ingen token-exchange görs)', async () => {
    setFullOidcEnv();
    const res = await request(app).get('/api/auth/oidc/callback?code=abc&state=test-state');
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(oidcClient.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it('exchange-fel (t.ex. state-mismatch) → 302 /login?sso_error=failed', async () => {
    setFullOidcEnv();
    seedUser('anna@x.se');
    (oidcClient.authorizationCodeGrant as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('state mismatch'));
    const res = await request(app).get('/api/auth/oidc/callback?code=abc&state=FEL').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
  });

  it('utan config → 503', async () => {
    const res = await request(app).get('/api/auth/oidc/callback?code=abc&state=s');
    expect(res.status).toBe(503);
  });
});
