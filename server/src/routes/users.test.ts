import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID, randomBytes, createHash } from 'crypto';

/**
 * Integration tests for the /api/users routes (audit-v3 LOW).
 *
 * Covers:
 *  - Admin-only endpoints (POST create, PATCH update, DELETE) reject a
 *    non-admin user (403) and accept an admin.
 *  - Password-policy validation on create + the self-demotion / self-deletion
 *    guards that the route exposes.
 *
 * Harness mirrors checklists.test.ts: vi.hoisted() sets a UNIQUE DB_PATH
 * (suffix -users) BEFORE any import that pulls in db/connection.ts, plus
 * NODE_ENV=test and CSRF_SECRET / JWT_SECRET (≥32 chars; short exits unless ALLOW_WEAK_SECRETS=1).
 *
 * Login is rate-limited (5 attempts / 15 min / IP). We log in each user
 * exactly once (admin + non-admin) and reuse the persistent csrf-agent.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-users.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-users-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-users-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

type Session = { agent: ReturnType<typeof request.agent>; token: string; csrf: string };

let app: ReturnType<typeof createApp>;

let admin: Session;
let user: Session;

let adminId: string;
let userId: string;

// Bound to adminId but scoped ['read'] — no 'admin' permission.
let scopedAdminKey: string;

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
    .run(adminId, 'admin@userstest.local', adminHash, 'admin', 'Users Admin');
  db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, 'user@userstest.local', userHash, 'user', 'Plain User');

  const rawKey = `itk_live_${randomBytes(16).toString('hex')}`;
  const keyPrefix = rawKey.substring('itk_live_'.length, 'itk_live_'.length + 8);
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  db.prepare(
    `INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), 'scoped-test-key', keyPrefix, keyHash, adminId, JSON.stringify(['read']));
  scopedAdminKey = rawKey;

  app = createApp();

  admin = await login('admin@userstest.local', 'Admin-P@ss1234!');
  user = await login('user@userstest.local', 'User-P@ss1234!');
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('GET /api/users — auth required, payload by role', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('returns the full admin payload (email, lastSignIn) for an admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    const me = res.body.users.find((u: any) => u.id === adminId);
    expect(me).toBeDefined();
    expect(me.email).toBe('admin@userstest.local');
    expect(me).toHaveProperty('lastSignIn');
    expect(me.emailConfirmed).toBe(true);
  });

  it('returns the reduced payload (no email) for a non-admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    const someone = res.body.users[0];
    expect(someone).toHaveProperty('displayName');
    expect(someone).toHaveProperty('role');
    expect(someone.email).toBeUndefined();
    expect(someone.lastSignIn).toBeUndefined();
  });

  it('returns the reduced payload for an admin-owner API key WITHOUT admin scope (isEffectiveAdmin)', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${scopedAdminKey}`);
    expect(res.status).toBe(200);
    const someone = res.body.users[0];
    expect(someone.email).toBeUndefined();
    expect(someone.lastSignIn).toBeUndefined();
  });
});

describe('POST /api/users — admin only + password policy', () => {
  it('rejects a non-admin with 403', async () => {
    const res = await user.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf)
      .send({ email: 'blocked@userstest.local', role: 'user' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('rejects a weak password with 400 (password policy)', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'weakpw@userstest.local', password: 'short', role: 'user' });
    expect(res.status).toBe(400);
    // passwordPolicy.ts → "minst 12 tecken" for a too-short password.
    expect(res.body.error).toMatch(/tecken|lösenord/i);
  });

  it('rejects a long-but-no-special-char password with 400 (policy regex)', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'nospecial@userstest.local', password: 'Abcdefgh1234', role: 'user' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/specialtecken/i);
  });

  it('rejects an invalid email format with 400', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'not-an-email', role: 'user' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/e-post|format/i);
  });

  it('creates a user with a strong password (201) and persists the row', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({
        // Policy regex only allows special chars from the set @$!%*?& — no hyphen.
        email: 'created@userstest.local',
        password: 'Str0ngP@ssw0rd!',
        role: 'user',
        displayName: 'Created User',
      });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('created@userstest.local');
    expect(res.body.user.role).toBe('user');
    // Password was supplied → no temporaryPassword returned.
    expect(res.body.temporaryPassword).toBeUndefined();

    const row = db.prepare('SELECT email, role FROM users WHERE email = ?').get('created@userstest.local') as
      | { email: string; role: string }
      | undefined;
    expect(row?.role).toBe('user');
  });

  it('auto-generates a temporary password when none is supplied (201)', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'autogen@userstest.local', role: 'user' });
    expect(res.status).toBe(201);
    expect(typeof res.body.temporaryPassword).toBe('string');
    expect(res.body.temporaryPassword.length).toBeGreaterThan(0);
  });
});

describe('PATCH /api/users/:id — admin only', () => {
  it('rejects a non-admin with 403', async () => {
    const res = await user.agent
      .patch(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('rejects an invalid role with 400', async () => {
    const res = await admin.agent
      .patch(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ role: 'superuser' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/roll/i);
  });

  it('prevents an admin from removing their own admin access (400)', async () => {
    const res = await admin.agent
      .patch(`/api/users/${adminId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ role: 'user' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/admin-åtkomst/i);
  });

  it('lets an admin update another user\'s display name (200)', async () => {
    const res = await admin.agent
      .patch(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ displayName: 'Renamed User' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as { display_name: string };
    expect(row.display_name).toBe('Renamed User');
  });

  it('returns 404 for a non-existent user id', async () => {
    const res = await admin.agent
      .patch(`/api/users/${randomUUID()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ role: 'user' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/users/:id — admin only', () => {
  it('rejects a non-admin with 403', async () => {
    const res = await user.agent
      .delete(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('prevents an admin from deleting their own account (400)', async () => {
    const res = await admin.agent
      .delete(`/api/users/${adminId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
  });

  it('returns 404 when deleting a non-existent user', async () => {
    const res = await admin.agent
      .delete(`/api/users/${randomUUID()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(404);
  });

  it('lets an admin delete an existing (other) user (200)', async () => {
    // Seed a throwaway user to delete (avoids extra logins).
    const throwawayId = randomUUID();
    db.prepare(`INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`)
      .run(throwawayId, 'throwaway@userstest.local', await bcrypt.hash('x', 4), 'user', 'Throwaway');

    const res = await admin.agent
      .delete(`/api/users/${throwawayId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf);
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(throwawayId);
    expect(row).toBeUndefined();
  });
});

/**
 * SSO-länk: ssoLinked i GET-payloaden + clearSsoLink i PATCH.
 *
 * Bakgrund: matchningen mot Entra sker på paret (oidc_sub, oidc_iss). När en
 * e-postadress byter ägare pekar länken kvar på den GAMLA identiteten och den
 * nya medarbetaren nekas med sub_conflict — utan en väg att nolla länken är det
 * permanent. Testerna nedan bevakar både att flaggan speglar DB:n, att BÅDA
 * kolumnerna nollas och att sub/issuer aldrig läcker ut i API-svaret.
 */
describe('SSO-länk — ssoLinked (GET) och clearSsoLink (PATCH)', () => {
  const ISS = 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0';

  async function seedUser(opts: { sub?: string | null; iss?: string | null; displayName?: string }): Promise<string> {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, display_name, oidc_sub, oidc_iss)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      `sso-${id}@userstest.local`,
      await bcrypt.hash('x', 4),
      'user',
      opts.displayName ?? 'SSO Seed',
      opts.sub ?? null,
      opts.iss ?? null,
    );
    return id;
  }

  function identity(id: string) {
    return db.prepare('SELECT oidc_sub, oidc_iss FROM users WHERE id = ?').get(id) as
      | { oidc_sub: string | null; oidc_iss: string | null }
      | undefined;
  }

  // Levande session för en användare: en refresh-token som ännu inte är revoke:ad.
  function seedRefreshToken(userIdForToken: string): string {
    const token = `rt-${randomUUID()}`;
    db.prepare(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`
    ).run(
      randomUUID(),
      userIdForToken,
      token,
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
    return token;
  }

  function revokedFlag(token: string): number | undefined {
    return (db.prepare('SELECT revoked FROM refresh_tokens WHERE token = ?').get(token) as
      | { revoked: number }
      | undefined)?.revoked;
  }

  it('ssoLinked speglar DB-tillståndet i admin-payloaden', async () => {
    const linkedId = await seedUser({ sub: `sub-linked-${randomUUID()}`, iss: ISS });
    const unlinkedId = await seedUser({});

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    const linked = res.body.users.find((u: any) => u.id === linkedId);
    const unlinked = res.body.users.find((u: any) => u.id === unlinkedId);
    expect(linked.ssoLinked).toBe(true);
    expect(unlinked.ssoLinked).toBe(false);
  });

  it('exponerar aldrig sub- eller issuer-värdet i API-svaret', async () => {
    const sub = `sub-secret-${randomUUID()}`;
    await seedUser({ sub, iss: ISS });

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(sub);
    expect(body).not.toContain(ISS);
    for (const u of res.body.users) {
      expect(u).not.toHaveProperty('oidc_sub');
      expect(u).not.toHaveProperty('oidc_iss');
    }
  });

  it('clearSsoLink nollar BÅDA kolumnerna (oidc_sub och oidc_iss)', async () => {
    const id = await seedUser({ sub: `sub-clear-${randomUUID()}`, iss: ISS });
    expect(identity(id)?.oidc_sub).not.toBeNull();

    const res = await admin.agent
      .patch(`/api/users/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ clearSsoLink: true });
    expect(res.status).toBe(200);

    const after = identity(id);
    expect(after?.oidc_sub).toBeNull();
    // oidc_iss måste med — annars pekar kontot kvar på en halv identitet.
    expect(after?.oidc_iss).toBeNull();
  });

  it('clearSsoLink slår igenom på ssoLinked i nästa GET', async () => {
    const id = await seedUser({ sub: `sub-roundtrip-${randomUUID()}`, iss: ISS });

    const before = await request(app).get('/api/users').set('Authorization', `Bearer ${admin.token}`);
    expect(before.body.users.find((u: any) => u.id === id).ssoLinked).toBe(true);

    await admin.agent
      .patch(`/api/users/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ clearSsoLink: true })
      .expect(200);

    const after = await request(app).get('/api/users').set('Authorization', `Bearer ${admin.token}`);
    expect(after.body.users.find((u: any) => u.id === id).ssoLinked).toBe(false);
  });

  it('skriver en audit-rad som visar att länken rensades', async () => {
    const id = await seedUser({ sub: `sub-audit-${randomUUID()}`, iss: ISS });

    await admin.agent
      .patch(`/api/users/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ clearSsoLink: true })
      .expect(200);

    const row = db.prepare(
      `SELECT action, details, user_id FROM audit_log
       WHERE entity_type = 'user' AND entity_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(id) as { action: string; details: string | null; user_id: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.action).toBe('user_update');
    expect(row!.details).toContain('sso_link: cleared');
    expect(row!.user_id).toBe(adminId);
  });

  /**
   * Sessionen måste dö med länken. Poängen med clearSsoLink är att FEL person
   * kan vara inloggad (adressen har bytt ägare) — överlever refresh-tokenet
   * roterar den sessionen vidare i upp till 7 dagar trots att länken är borta.
   */
  it('clearSsoLink revoke:ar användarens refresh-tokens (alla) men lämnar andras orörda', async () => {
    const targetId = await seedUser({ sub: `sub-revoke-${randomUUID()}`, iss: ISS });
    const bystanderId = await seedUser({ sub: `sub-bystander-${randomUUID()}`, iss: ISS });

    const targetTokenA = seedRefreshToken(targetId);
    const targetTokenB = seedRefreshToken(targetId);
    const bystanderToken = seedRefreshToken(bystanderId);

    expect(revokedFlag(targetTokenA)).toBe(0);
    expect(revokedFlag(targetTokenB)).toBe(0);

    await admin.agent
      .patch(`/api/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ clearSsoLink: true })
      .expect(200);

    expect(revokedFlag(targetTokenA)).toBe(1);
    expect(revokedFlag(targetTokenB)).toBe(1);
    // Kollateralskada vore lika illa som utebliven revoke.
    expect(revokedFlag(bystanderToken)).toBe(0);
  });

  it('den revoke:ade sessionen kan inte längre växlas in på /api/auth/refresh', async () => {
    const targetId = await seedUser({ sub: `sub-refresh-${randomUUID()}`, iss: ISS });
    const targetToken = seedRefreshToken(targetId);

    await admin.agent
      .patch(`/api/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ clearSsoLink: true })
      .expect(200);

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: targetToken });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it('en PATCH UTAN clearSsoLink rör inte refresh-tokens', async () => {
    const id = await seedUser({ sub: `sub-nokill-${randomUUID()}`, iss: ISS });
    const token = seedRefreshToken(id);

    await admin.agent
      .patch(`/api/users/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ displayName: 'Bara Namnbyte' })
      .expect(200);

    // En ren namnändring får inte logga ut användaren.
    expect(revokedFlag(token)).toBe(0);
  });

  it('clearSsoLink: false ensamt revoke:ar ingenting (400, ingen sidoeffekt)', async () => {
    const id = await seedUser({ sub: `sub-falsekeep-${randomUUID()}`, iss: ISS });
    const token = seedRefreshToken(id);

    await admin.agent
      .patch(`/api/users/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ clearSsoLink: false })
      .expect(400);

    expect(revokedFlag(token)).toBe(0);
  });

  it('en icke-admin kan inte revoke:a någon annans session via clearSsoLink (403)', async () => {
    const id = await seedUser({ sub: `sub-403revoke-${randomUUID()}`, iss: ISS });
    const token = seedRefreshToken(id);

    await user.agent
      .patch(`/api/users/${id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf)
      .send({ clearSsoLink: true })
      .expect(403);

    expect(revokedFlag(token)).toBe(0);
  });

  it('kan kombineras med displayName i samma anrop', async () => {
    const id = await seedUser({ sub: `sub-combo-${randomUUID()}`, iss: ISS });

    const res = await admin.agent
      .patch(`/api/users/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ clearSsoLink: true, displayName: 'Ny Ägare' });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT display_name, oidc_sub, oidc_iss FROM users WHERE id = ?').get(id) as
      { display_name: string | null; oidc_sub: string | null; oidc_iss: string | null };
    expect(row.display_name).toBe('Ny Ägare');
    expect(row.oidc_sub).toBeNull();
    expect(row.oidc_iss).toBeNull();
  });

  it('nekar en icke-admin med 403 och lämnar länken orörd', async () => {
    const sub = `sub-forbidden-${randomUUID()}`;
    const id = await seedUser({ sub, iss: ISS });

    const res = await user.agent
      .patch(`/api/users/${id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf)
      .send({ clearSsoLink: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);

    const after = identity(id);
    expect(after?.oidc_sub).toBe(sub);
    expect(after?.oidc_iss).toBe(ISS);
  });

  it('avvisar ett icke-booleskt clearSsoLink med 400 och rör inte länken', async () => {
    const sub = `sub-nonbool-${randomUUID()}`;
    const id = await seedUser({ sub, iss: ISS });

    const res = await admin.agent
      .patch(`/api/users/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ clearSsoLink: 'true' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/clearSsoLink/);

    expect(identity(id)?.oidc_sub).toBe(sub);
  });

  it('clearSsoLink: false ensamt är "inget att uppdatera" (400) och nollar ingenting', async () => {
    const sub = `sub-false-${randomUUID()}`;
    const id = await seedUser({ sub, iss: ISS });

    const res = await admin.agent
      .patch(`/api/users/${id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ clearSsoLink: false });
    expect(res.status).toBe(400);

    expect(identity(id)?.oidc_sub).toBe(sub);
  });

  it('returnerar 404 när användaren inte finns', async () => {
    const res = await admin.agent
      .patch(`/api/users/${randomUUID()}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ clearSsoLink: true });
    expect(res.status).toBe(404);
  });
});

/**
 * POST /api/users — skiftlägesokänslig dubblettkontroll.
 *
 * Bakgrund: users.email är UNIQUE med BINARY-kollation, så DB:n släpper igenom
 * 'Anton@x.se' bredvid 'anton@x.se'. SSO-matchningen (findOrLinkOidcUser) är
 * däremot skiftlägesokänslig och avslår fail-closed med 'email_ambiguous' när
 * två rader matchar — tillståndet slår alltså permanent ut SSO för användaren.
 * Routen är enda stället som hindrar att det skapas (ingen migration, orört index).
 */
describe('POST /api/users — dubblettkontroll är skiftlägesokänslig', () => {
  function countByLoweredEmail(lowered: string): number {
    return (db.prepare('SELECT email FROM users').all() as { email: string }[])
      .filter(u => u.email.toLowerCase() === lowered).length;
  }

  async function seedEmail(email: string): Promise<void> {
    db.prepare(`INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)`)
      .run(randomUUID(), email, await bcrypt.hash('x', 4), 'user');
  }

  it('avvisar en adress som bara skiljer sig i skiftläge och skapar ingen andra rad', async () => {
    await seedEmail('dupcase@userstest.local');

    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'DupCase@userstest.local', role: 'user' });

    expect([400, 409]).toContain(res.status);
    expect(res.body.error).toMatch(/already registered|finns redan/i);
    expect(countByLoweredEmail('dupcase@userstest.local')).toBe(1);
  });

  it('avvisar även när den BEFINTLIGA raden har versaler (jämförelsen normaliserar båda sidor)', async () => {
    await seedEmail('MixedCase@userstest.local');

    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'mixedcase@userstest.local', role: 'user' });

    expect([400, 409]).toContain(res.status);
    expect(countByLoweredEmail('mixedcase@userstest.local')).toBe(1);
  });

  it('avvisar en dubblett med diakriter — SQLites ASCII-only lower() räcker inte', async () => {
    // Riktningen är hela poängen: det är den BEFINTLIGA radens skiftläge som
    // måste normaliseras Unicode-korrekt. `WHERE lower(email) = ?` lämnar
    // 'Åsa.Ö@…' oförändrad i SQLite (lower() är ASCII-only) medan needle blir
    // 'åsa.ö@…' i JS → ingen träff → dubbletten skapas, och just det tillståndet
    // är permanent SSO-blockerande ('email_ambiguous'). Med jämförelsen i JS
    // normaliseras båda sidor likadant. (Motsatt riktning — seedad gemen rad,
    // versal POST — fångas även av lower()-varianten och bevisar alltså inget.)
    await seedEmail('Åsa.Ö@userstest.local');

    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'åsa.ö@userstest.local', role: 'user' });

    expect([400, 409]).toContain(res.status);
    expect(countByLoweredEmail('åsa.ö@userstest.local')).toBe(1);
  });

  it('avvisar diakritik-dubbletten även i motsatt riktning (gemen rad, versal POST)', async () => {
    await seedEmail('bengt.öberg@userstest.local');

    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'Bengt.Öberg@userstest.local', role: 'user' });

    expect([400, 409]).toContain(res.status);
    expect(countByLoweredEmail('bengt.öberg@userstest.local')).toBe(1);
  });

  // NFC/NFD: 'ö' kan lagras som ETT tecken (NFC) eller som 'o' + ett
  // kombinerande tremaljud (NFD) — samma adress för en människa, olika
  // strängar för JS (även efter .toLowerCase()). En kontroll som bara gör
  // .toLowerCase() (utan .normalize('NFC') först) missar det här fallet helt —
  // det är därför routen måste använda den EXPORTERADE normalizeEmail från
  // lib/oidc.ts (samma funktion findOrLinkOidcUser matchar med), inte en egen
  // lokal .toLowerCase(). Släpper kontrollen igenom NFC/NFD-paret låses
  // kontots SSO permanent i 'email_ambiguous'.
  it('avvisar en dubblett som bara skiljer i Unicode-normalform (NFC vs NFD, INTE bara skiftläge)', async () => {
    const nfd = 'Zoë.Öberg@userstest.local'.normalize('NFD');
    const nfc = 'zoë.öberg@userstest.local'.normalize('NFC');
    expect(nfd).not.toBe(nfc); // förutsättningen för att testet ska betyda något
    expect(nfd.toLowerCase()).not.toBe(nfc); // ren .toLowerCase() räcker INTE

    await seedEmail(nfd);

    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: nfc, role: 'user' });

    expect([400, 409]).toContain(res.status);
    const rows = db.prepare('SELECT email FROM users').all() as { email: string }[];
    const matching = rows.filter(u => u.email.normalize('NFC').toLowerCase() === nfc.normalize('NFC').toLowerCase());
    expect(matching).toHaveLength(1);
  });

  it('skapar fortfarande en användare vars adress inte krockar (201) + skriver audit-raden', async () => {
    const res = await admin.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'Unique.New@userstest.local', role: 'user' });

    expect(res.status).toBe(201);
    // Adressen lagras som angiven — kontrollen normaliserar bara jämförelsen,
    // den skriver inte om värdet (ingen migration/kollationsändring).
    expect(res.body.user.email).toBe('Unique.New@userstest.local');
    expect(countByLoweredEmail('unique.new@userstest.local')).toBe(1);

    const audit = db.prepare(
      `SELECT action, details, user_id FROM audit_log
       WHERE entity_type = 'user' AND entity_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(res.body.user.id) as { action: string; details: string | null; user_id: string } | undefined;

    expect(audit).toBeDefined();
    expect(audit!.action).toBe('user_create');
    expect(audit!.details).toContain('Unique.New@userstest.local');
    expect(audit!.user_id).toBe(adminId);
  });

  it('nekar en icke-admin (requireAdmin ligger före dubblettkontrollen)', async () => {
    await seedEmail('adminonly@userstest.local');

    const res = await user.agent
      .post('/api/users')
      .set('Authorization', `Bearer ${user.token}`)
      .set('x-csrf-token', user.csrf)
      .send({ email: 'AdminOnly@userstest.local', role: 'user' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });
});
