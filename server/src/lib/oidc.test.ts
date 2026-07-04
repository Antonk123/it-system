import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-oidc.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-oidc-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-oidc-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { getOidcSettings, isOidcEnabled, findOrLinkOidcUser } from './oidc.js';

const OIDC_ENV = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_BUTTON_LABEL'];

function setFullOidcEnv() {
  process.env.OIDC_ISSUER_URL = 'https://login.microsoftonline.com/tenant/v2.0';
  process.env.OIDC_CLIENT_ID = 'client-123';
  process.env.OIDC_CLIENT_SECRET = 'secret-abc';
  process.env.OIDC_REDIRECT_URI = 'https://ticket.example.se/api/auth/oidc/callback';
}

function seedUser(email: string, oidcSub: string | null = null): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, role, oidc_sub) VALUES (?, ?, 'x', 'user', ?)")
    .run(id, email, oidcSub);
  return id;
}

beforeAll(() => initializeDatabase());
afterAll(() => { closeDatabase(); if (existsSync(DB_PATH)) rmSync(DB_PATH); });
beforeEach(() => {
  OIDC_ENV.forEach((k) => delete process.env[k]);
  db.prepare('DELETE FROM users').run();
});

describe('getOidcSettings / isOidcEnabled', () => {
  it('null/false när config saknas helt', () => {
    expect(getOidcSettings()).toBeNull();
    expect(isOidcEnabled()).toBe(false);
  });
  it('null när en av de fyra obligatoriska saknas', () => {
    setFullOidcEnv();
    delete process.env.OIDC_CLIENT_SECRET;
    expect(getOidcSettings()).toBeNull();
  });
  it('komplett config → settings med default-label', () => {
    setFullOidcEnv();
    expect(getOidcSettings()).toMatchObject({ clientId: 'client-123', buttonLabel: 'Logga in med SSO' });
  });
  it('OIDC_BUTTON_LABEL överstyr default', () => {
    setFullOidcEnv();
    process.env.OIDC_BUTTON_LABEL = 'Logga in med Microsoft';
    expect(getOidcSettings()!.buttonLabel).toBe('Logga in med Microsoft');
  });
});

describe('findOrLinkOidcUser', () => {
  it('matchar på oidc_sub först', () => {
    const id = seedUser('anna@x.se', 'sub-1');
    expect(findOrLinkOidcUser({ sub: 'sub-1' })!.id).toBe(id);
  });
  it('matchar på e-post (case-insensitivt) och länkar sub första gången', () => {
    const id = seedUser('Anna@X.se');
    const user = findOrLinkOidcUser({ sub: 'sub-9', email: 'anna@x.se' });
    expect(user!.id).toBe(id);
    const row = db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(id) as { oidc_sub: string };
    expect(row.oidc_sub).toBe('sub-9');
  });
  it('fallback till preferred_username när email-claim saknas', () => {
    const id = seedUser('bo@x.se');
    expect(findOrLinkOidcUser({ sub: 's', preferred_username: 'bo@x.se' })!.id).toBe(id);
  });
  it('okänd användare → null, inget konto skapas (ingen JIT)', () => {
    expect(findOrLinkOidcUser({ sub: 's', email: 'ghost@x.se' })).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 0 });
  });
  it('e-postträff på konto länkat till ANNAN sub → null (sub vinner)', () => {
    seedUser('c@x.se', 'sub-annan');
    expect(findOrLinkOidcUser({ sub: 'sub-ny', email: 'c@x.se' })).toBeNull();
  });
  it('claims utan användbar e-post → null (objekt/tom sträng avvisas)', () => {
    seedUser('d@x.se');
    expect(findOrLinkOidcUser({ sub: 's', email: { evil: true } })).toBeNull();
    expect(findOrLinkOidcUser({ sub: 's', email: 'inte-en-adress' })).toBeNull();
  });
  it('email_verified: false + matchande e-post → null, ingen sub länkas', () => {
    const id = seedUser('eva@x.se');
    expect(
      findOrLinkOidcUser({ sub: 'sub-eva', email: 'eva@x.se', email_verified: false })
    ).toBeNull();
    const row = db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(id) as { oidc_sub: string | null };
    expect(row.oidc_sub).toBeNull();
  });
  it('email_verified: false men användaren redan länkad via sub → sub-matchen vinner', () => {
    const id = seedUser('finn@x.se', 'sub-finn');
    expect(
      findOrLinkOidcUser({ sub: 'sub-finn', email: 'finn@x.se', email_verified: false })!.id
    ).toBe(id);
  });
  it('email_verified: true + matchande e-post → länkar som vanligt', () => {
    const id = seedUser('greta@x.se');
    const user = findOrLinkOidcUser({ sub: 'sub-greta', email: 'greta@x.se', email_verified: true });
    expect(user!.id).toBe(id);
    const row = db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(id) as { oidc_sub: string };
    expect(row.oidc_sub).toBe('sub-greta');
  });
  it('email_verified-claim saknas (som idag) → länkar som vanligt (regressionsskydd Entra)', () => {
    const id = seedUser('helge@x.se');
    const user = findOrLinkOidcUser({ sub: 'sub-helge', email: 'helge@x.se' });
    expect(user!.id).toBe(id);
    const row = db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(id) as { oidc_sub: string };
    expect(row.oidc_sub).toBe('sub-helge');
  });
});
