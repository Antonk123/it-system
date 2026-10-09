import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID, createHash, randomBytes } from 'crypto';

/**
 * Integration tests for the auth routes (server/src/routes/auth.ts), run against
 * the real Express app via supertest.
 *
 * Coverage (audit-v3 MEDIUM — auth.ts lacked tests):
 *  1. login    — valid creds → 200 (+ refresh cookie + access token/user); bad creds → 401.
 *  2. refresh  — valid refresh cookie → new access token; missing → 400; invalid/revoked → 401.
 *  3. logout   — revokes the refresh token (later refresh with it → 401).
 *  4. change-password — revokes ALL of the user's refresh tokens (a previously
 *     issued refresh token stops working after the change).
 *  5. forgot/reset — generic forgot response; reset rejects invalid + expired tokens.
 *  6. rate limiting — login is 5/15min per IP → the 6th attempt → 429.
 *
 * Bootstrap ordering: db/connection.ts is a module-level singleton built from
 * process.env.DB_PATH at import time. vi.hoisted() sets env (UNIQUE -auth DB
 * suffix, NODE_ENV=test, ≥32-char secrets) BEFORE any import pulls in connection.ts.
 *
 * Rate-limit budget: login (5 failed / 15 min per IP), forgot-password (5 / 15 min),
 * reset-password and refresh (60 failed / 15 min) are separate module-level
 * limiters, and there is no test-mode bypass in the source. The app runs with `trust proxy = 1`, so
 * `req.ip` is taken from the first X-Forwarded-For entry. We exploit that to give
 * each rate-limited request a UNIQUE source IP, isolating every call into its own
 * rate-limit bucket — the suite is then deterministic regardless of ordering or
 * how many logins it performs. The dedicated rate-limit suite reuses ONE fixed IP
 * so it can deliberately exhaust that single bucket and observe the 429.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-auth.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-auth-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-auth-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;

// validatePassword policy: >=12 chars, upper+lower+digit+special from @$!%*?&,
// and ONLY chars in [A-Za-z0-9@$!%*?&] (hyphens etc. are rejected). Both of
// these satisfy it (login itself does not enforce policy, but change/reset do).
const PASSWORD = 'Sup3rStr0ngTestPw1!';
const NEW_PASSWORD = 'EvenStr0nger2Pw1!';

// ── Direct-DB helpers (avoid burning the per-IP login rate limit) ──────────

const REFRESH_EXPIRY_DAYS = 7;
function futureIso(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

/** Insert a refresh token row directly and return its raw token value. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Refresh tokens are stored as sha256(token): look a row up by its raw value.
function refreshRow(rawToken: string) {
  return db.prepare('SELECT id, user_id, revoked, replaced_by, last_used_at FROM refresh_tokens WHERE token = ?')
    .get(sha256(rawToken)) as
    | { id: string; user_id: string; revoked: number; replaced_by: string | null; last_used_at: string | null }
    | undefined;
}

function seedRefreshToken(
  userId: string,
  opts: { revoked?: boolean; expiresAt?: string; id?: string; replacedBy?: string; lastUsedAt?: string } = {}
): string {
  const token = randomUUID() + randomUUID(); // unique 64-ish hex-ish value
  db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token, expires_at, revoked, replaced_by, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    opts.id ?? randomUUID(), userId, sha256(token), opts.expiresAt ?? futureIso(REFRESH_EXPIRY_DAYS),
    opts.revoked ? 1 : 0, opts.replacedBy ?? null, opts.lastUsedAt ?? null
  );
  return token;
}

/** Insert a password-reset token row directly; returns the RAW token (the URL value). */
function seedResetToken(userId: string, opts: { expiresAt?: string; usedAt?: string | null } = {}): string {
  const rawToken = randomUUID() + randomUUID();
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  db.prepare(
    'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at) VALUES (?, ?, ?, ?, ?)'
  ).run(randomUUID(), userId, tokenHash, opts.expiresAt ?? futureIso(1), opts.usedAt ?? null);
  return rawToken;
}

function createUser(email: string, password: string, role: 'admin' | 'user' = 'user'): Promise<string> {
  const id = randomUUID();
  return bcrypt.hash(password, 10).then((hash) => {
    db.prepare(
      'INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)'
    ).run(id, email, hash, role, email.split('@')[0]);
    return id;
  });
}

// Build a refresh cookie header from a raw token value.
function refreshCookie(token: string): string {
  return `refreshToken=${token}`;
}

// A fresh, unique source IP per call. With `trust proxy = 1`, setting it via
// X-Forwarded-For makes the login rate limiter bucket each request separately so
// rate limiting never interferes with the functional tests.
let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250 + 1}`; // TEST-NET-2 range, stays valid
}

// Rate-limited POST helpers that always attach a unique source IP, so the
// per-IP login/refresh limiters never interfere with the functional assertions.
// refresh has its own 10/15min limiter; login/forgot/reset share the 5/15min one.
function refreshPost() {
  return request(app).post('/api/auth/refresh').set('X-Forwarded-For', freshIp());
}

// forgot-password / reset-password are NOT CSRF-exempt (only /login and /refresh
// are) and are designed for UNAUTHENTICATED callers. The double-submit flow for
// an anonymous user: GET /api/csrf-token with NO auth header → session
// identifier is '' → cookie + matching token issued; then POST with that cookie
// (kept by the agent) + the x-csrf-token header. One shared agent (initialised in
// the suite's beforeAll) keeps the csrf-token cookie across requests. The helpers
// stay SYNCHRONOUS so the returned supertest chain remains awaitable as `.send()`.
let anonAgent: ReturnType<typeof request.agent>;
let anonCsrf: string;
async function initAnonCsrf(): Promise<void> {
  anonAgent = request.agent(app);
  const res = await anonAgent.get('/api/csrf-token'); // no Authorization header
  expect(res.status).toBe(200);
  anonCsrf = res.body.csrfToken as string;
  expect(typeof anonCsrf).toBe('string');
}
function forgotPost() {
  return anonAgent.post('/api/auth/forgot-password').set('X-Forwarded-For', freshIp()).set('x-csrf-token', anonCsrf);
}
function resetPost() {
  return anonAgent.post('/api/auth/reset-password').set('X-Forwarded-For', freshIp()).set('x-csrf-token', anonCsrf);
}

// One persistent agent → keeps the csrf cookie; returns access token + csrf token.
// Each login uses a unique source IP so the per-IP login limiter is never tripped.
async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Forwarded-For', freshIp()).send({ email, password });
  expect(res.status).toBe(200);
  const token = res.body.accessToken as string;
  const csrfRes = await agent.get('/api/csrf-token').set('Authorization', `Bearer ${token}`);
  expect(csrfRes.status).toBe(200);
  return { agent, token, csrf: csrfRes.body.csrfToken as string };
}

beforeAll(async () => {
  initializeDatabase();
  app = createApp();
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 1. POST /api/auth/login
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  let userId: string;
  const email = 'login@authtest.local';

  beforeAll(async () => {
    userId = await createUser(email, PASSWORD);
  });

  it('valid credentials → 200, sets refreshToken cookie, returns access token + user', async () => {
    const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', freshIp()).send({ email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(0);
    expect(res.body.token).toBe(res.body.accessToken); // backward-compat mirror
    expect(res.body.user).toMatchObject({ id: userId, email, role: 'user' });

    // Refresh token delivered as HttpOnly cookie, never in the body.
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = setCookie?.find((c) => c.startsWith('refreshToken='));
    expect(cookie).toBeTruthy();
    expect(cookie!.toLowerCase()).toContain('httponly');
    expect(res.body.refreshToken).toBeUndefined();

    // The login actually persisted a refresh token for this user — stored hashed.
    const count = (db.prepare('SELECT COUNT(*) as c FROM refresh_tokens WHERE user_id = ?').get(userId) as { c: number }).c;
    expect(count).toBeGreaterThanOrEqual(1);
    const rawCookieValue = cookie!.split(';')[0].slice('refreshToken='.length);
    expect(db.prepare('SELECT id FROM refresh_tokens WHERE token = ?').get(rawCookieValue)).toBeUndefined();
    expect(refreshRow(rawCookieValue)?.user_id).toBe(userId);
    expect(res.body.user.mustChangePassword).toBe(false);
  });

  it('wrong password → 401, no access token', async () => {
    const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', freshIp()).send({ email, password: 'definitely-wrong' });
    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.error).toBeTruthy();
  });

  it('unknown email → 401', async () => {
    const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', freshIp()).send({ email: 'nobody@authtest.local', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. POST /api/auth/refresh
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
  let userId: string;

  beforeAll(async () => {
    userId = await createUser('refresh@authtest.local', PASSWORD);
  });

  it('valid refresh cookie → 200 + new access token, and rotates the cookie', async () => {
    const token = seedRefreshToken(userId);

    const res = await refreshPost().set('Cookie',refreshCookie(token));
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.token).toBe(res.body.accessToken);

    // Rotation: a fresh refresh cookie is set; the old row is kept, revoked and linked to its successor.
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const rotated = setCookie?.find((c) => c.startsWith('refreshToken='));
    expect(rotated).toBeTruthy();
    expect(rotated).not.toContain(token);
    const oldRow = refreshRow(token);
    expect(oldRow?.revoked).toBe(1);
    expect(oldRow?.replaced_by).toBeTruthy();
    const newValue = rotated!.split(';')[0].slice('refreshToken='.length);
    expect(refreshRow(newValue)?.id).toBe(oldRow!.replaced_by);
    expect(refreshRow(newValue)?.revoked).toBe(0);
  });

  it('no refresh token at all → 400', async () => {
    const res = await refreshPost().send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('a refresh token in the request body is ignored (cookie only) → 400', async () => {
    const token = seedRefreshToken(userId);
    const res = await refreshPost().send({ refreshToken: token });
    expect(res.status).toBe(400);
    expect(refreshRow(token)?.revoked).toBe(0);
  });

  it('unknown / invalid refresh token → 401', async () => {
    const res = await refreshPost().set('Cookie',refreshCookie('not-a-real-token'));
    expect(res.status).toBe(401);
  });

  it('revoked refresh token → 401', async () => {
    const token = seedRefreshToken(userId, { revoked: true });
    const res = await refreshPost().set('Cookie',refreshCookie(token));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it('expired refresh token → 401 (and the row is cleaned up)', async () => {
    const token = seedRefreshToken(userId, { expiresAt: futureIso(-1) });
    const res = await refreshPost().set('Cookie',refreshCookie(token));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
    expect(refreshRow(token)).toBeUndefined();
  });

  // NOTE: the handler's "user not found" branch (refresh token with a dangling
  // user_id) is not exercised here — refresh_tokens.user_id has a FK to users
  // with ON DELETE CASCADE, so a dangling row cannot be created via the DB
  // without disabling FK enforcement (which we won't do, and can't from a test).
});

// ───────────────────────────────────────────────────────────────────────────
// 3. POST /api/auth/logout — revokes the presented refresh token
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  // logout kräver ingen access-token; cookien identifierar sessionen. Den är
  // fortfarande en muterande route men CSRF-undantagen, så inget x-csrf-token behövs.
  it('revokes the refresh token (by cookie only) so a subsequent refresh with it → 401', async () => {
    const email = 'logout@authtest.local';
    const userId = await createUser(email, PASSWORD);
    const refreshToken = seedRefreshToken(userId);

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', refreshCookie(refreshToken));
    expect(logout.status).toBe(204);
    expect(logout.text).toBe('');

    // Cookien rensas alltid.
    const setCookie = logout.headers['set-cookie'] as unknown as string[] | undefined;
    const cleared = setCookie?.find((c) => c.startsWith('refreshToken='));
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    // The token is now revoked in the DB.
    expect(refreshRow(refreshToken)?.revoked).toBe(1);

    // And refresh with that (revoked) token is rejected.
    const refresh = await refreshPost().set('Cookie', refreshCookie(refreshToken));
    expect(refresh.status).toBe(401);
  });

  it('works with an expired/garbage access token and without any cookie (204, cookie still cleared)', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer expired.or.garbage');
    expect(res.status).toBe(204);
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie?.some((c) => c.startsWith('refreshToken='))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. POST /api/auth/change-password — revokes ALL of the user's refresh tokens
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/change-password', () => {
  it('changes the password and revokes every existing refresh token (other sessions die)', async () => {
    const email = 'changepw@authtest.local';
    const userId = await createUser(email, PASSWORD);

    // Pre-existing "other session" refresh token (e.g. another device).
    const otherSessionToken = seedRefreshToken(userId);

    const { agent, token, csrf } = await loginAgent(email, PASSWORD);

    const res = await agent
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/changed/i);

    // The previously-issued refresh token from another session no longer works.
    const refresh = await refreshPost().set('Cookie',refreshCookie(otherSessionToken));
    expect(refresh.status).toBe(401);

    // Every OLD refresh token is revoked; only the new session's token (issued by the
    // response so the caller stays logged in) is live.
    const live = (db.prepare('SELECT COUNT(*) as c FROM refresh_tokens WHERE user_id = ? AND revoked = 0').get(userId) as { c: number }).c;
    expect(live).toBe(1);
    expect(refreshRow(otherSessionToken)?.revoked).toBe(1);

    // The new password hash actually verifies.
    const hash = (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string }).password_hash;
    expect(await bcrypt.compare(NEW_PASSWORD, hash)).toBe(true);
  });

  it('wrong current password → 400, password unchanged', async () => {
    const email = 'changepw-wrong@authtest.local';
    const userId = await createUser(email, PASSWORD);
    const { agent, token, csrf } = await loginAgent(email, PASSWORD);

    const res = await agent
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ currentPassword: 'not-the-current-pw', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/incorrect/i);

    const hash = (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string }).password_hash;
    expect(await bcrypt.compare(PASSWORD, hash)).toBe(true); // still the old password
  });

  it('new password that violates the policy → 400', async () => {
    const email = 'changepw-weak@authtest.local';
    await createUser(email, PASSWORD);
    const { agent, token, csrf } = await loginAgent(email, PASSWORD);

    const res = await agent
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ currentPassword: PASSWORD, newPassword: 'weak' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('without authentication → 401 (CSRF-exempt for GET-style? no — auth runs)', async () => {
    // change-password requires authenticate; with no token the request is rejected.
    // (It is also CSRF-protected, but CSRF runs first and would also reject; we
    // only assert the request is denied, not the exact 401 vs 403 ordering.)
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect([401, 403]).toContain(res.status);
  });

  // Dedicated rate limiter (5/15min per IP) — without it, a caller holding a
  // valid JWT could brute-force the current password unboundedly. Uses its own
  // fixed source IP (not used elsewhere) so it doesn't share a bucket with the
  // default-IP calls above, and its own changePasswordRateLimiter instance so it
  // can't be tripped by / interfere with the login rate-limit suite.
  it('rate limits repeated attempts: first 5 pass the limiter, 6th → 429', async () => {
    const RATELIMIT_IP = '192.0.2.77'; // TEST-NET-1, dedicated to this test only
    const email = 'changepw-ratelimit@authtest.local';
    await createUser(email, PASSWORD);
    const { agent, token, csrf } = await loginAgent(email, PASSWORD);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await agent
        .post('/api/auth/change-password')
        .set('X-Forwarded-For', RATELIMIT_IP)
        .set('Authorization', `Bearer ${token}`)
        .set('x-csrf-token', csrf)
        .send({ currentPassword: 'wrong-on-purpose', newPassword: NEW_PASSWORD });
      statuses.push(res.status);
    }

    // First 5 reach the handler (400 for wrong current password), the 6th is 429.
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses[5]).toBe(429);
  });

  // Audit-attribution gap: password_change is reachable via an API key (POST,
  // write-scope) but the logAudit() call omitted req.apiKey?.id, so a
  // key-initiated password change looked identical to a real session in the
  // audit log. Proves the fix attributes the row to the actual key, not NULL.
  it('attributes the audit row to the API key when changed via a key, not NULL', async () => {
    const email = 'changepw-apikey@authtest.local';
    const userId = await createUser(email, PASSWORD);

    const rawKey = `itk_live_${randomBytes(16).toString('hex')}`;
    const keyPrefix = rawKey.substring('itk_live_'.length, 'itk_live_'.length + 8);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyId = randomUUID();
    db.prepare(
      `INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(keyId, 'changepw-test-key', keyPrefix, keyHash, userId, JSON.stringify(['read', 'write']));

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${rawKey}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const row = db.prepare(
      "SELECT api_key_id FROM audit_log WHERE action = 'password_change' AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
    ).get(userId) as { api_key_id: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.api_key_id).toBe(keyId);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Sec-Fetch-Site: cookie-autentiserade, CSRF-undantagna endpoints
// ───────────────────────────────────────────────────────────────────────────
describe('Sec-Fetch-Site on refresh/logout', () => {
  let userId: string;
  beforeAll(async () => {
    userId = await createUser('secfetch@authtest.local', PASSWORD);
  });

  it.each(['cross-site', 'same-site'])('refresh and logout with Sec-Fetch-Site: %s → 403 and the token stays valid', async (site) => {
    const token = seedRefreshToken(userId);
    const refresh = await refreshPost().set('Cookie', refreshCookie(token)).set('Sec-Fetch-Site', site);
    expect(refresh.status).toBe(403);
    const logout = await request(app).post('/api/auth/logout').set('Cookie', refreshCookie(token)).set('Sec-Fetch-Site', site);
    expect(logout.status).toBe(403);
    expect(refreshRow(token)!.revoked).toBe(0);
  });

  it.each(['same-origin', 'none'])('Sec-Fetch-Site: %s is allowed', async (site) => {
    const refresh = await refreshPost().set('Cookie', refreshCookie(seedRefreshToken(userId))).set('Sec-Fetch-Site', site);
    expect(refresh.status).toBe(200);
    const logout = await request(app).post('/api/auth/logout').set('Cookie', refreshCookie(seedRefreshToken(userId))).set('Sec-Fetch-Site', site);
    expect(logout.status).toBe(204);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. forgot-password / reset-password
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/forgot-password & /reset-password', () => {
  // Anonymous CSRF agent: these endpoints are NOT CSRF-exempt and serve
  // unauthenticated users, so we fetch a CSRF token with no auth header first.
  beforeAll(async () => {
    await initAnonCsrf();
  });

  it('forgot-password returns the generic response for an unknown email (no account enumeration)', async () => {
    // forgot-password is rate-limited with the LOGIN limiter (5/15min/IP). This
    // suite issues only a couple of forgot calls, staying under the cap.
    const res = await forgotPost().send({ email: 'ghost@authtest.local' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Om e-postadressen finns i systemet har en återställningslänk skickats.');
  });

  it('forgot-password with missing email → 400', async () => {
    const res = await forgotPost().send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('reset-password with an invalid token → 400', async () => {
    const res = await resetPost()
      .send({ token: 'does-not-exist', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ogiltig|utgången/i);
  });

  it('reset-password with an expired token → 400', async () => {
    const userId = await createUser('reset-expired@authtest.local', PASSWORD);
    const rawToken = seedResetToken(userId, { expiresAt: futureIso(-1) });
    const res = await resetPost()
      .send({ token: rawToken, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gått ut/i);
  });

  it('reset-password with an already-used token → 400', async () => {
    const userId = await createUser('reset-used@authtest.local', PASSWORD);
    const rawToken = seedResetToken(userId, { usedAt: new Date().toISOString() });
    const res = await resetPost()
      .send({ token: rawToken, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/redan använts/i);
  });

  it('reset-password with a weak new password → 400 (policy enforced before token check would still 400)', async () => {
    const userId = await createUser('reset-weakpw@authtest.local', PASSWORD);
    const rawToken = seedResetToken(userId);
    const res = await resetPost()
      .send({ token: rawToken, newPassword: 'weak' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('reset-password with a valid token → 200, updates the hash, marks token used, and revokes refresh tokens', async () => {
    const email = 'reset-valid@authtest.local';
    const userId = await createUser(email, PASSWORD);
    const liveRefresh = seedRefreshToken(userId);
    const rawToken = seedResetToken(userId);

    const res = await resetPost()
      .send({ token: rawToken, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/återställts/i);

    // Password hash updated to the new password.
    const hash = (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string }).password_hash;
    expect(await bcrypt.compare(NEW_PASSWORD, hash)).toBe(true);

    // Token marked used → reusing it now → "already used" 400.
    const reuse = await resetPost()
      .send({ token: rawToken, newPassword: NEW_PASSWORD });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toMatch(/redan använts/i);

    // Pre-existing refresh token was revoked → refresh with it → 401.
    const refresh = await refreshPost().set('Cookie',refreshCookie(liveRefresh));
    expect(refresh.status).toBe(401);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Rate limiting on /api/auth/login (5 / 15 min per IP)
//    The login limiter is module-level and keyed by req.ip. By driving every
//    attempt from ONE fixed, dedicated source IP (not used by any other test),
//    we get a clean bucket: attempts 1-5 pass the limiter, attempt 6 trips 429.
//    Wrong-password attempts still increment the counter (the limiter runs before
//    passport), so we use bad creds and assert on the limiter status, not auth.
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login — rate limiting', () => {
  const RATELIMIT_IP = '192.0.2.42'; // TEST-NET-1, dedicated to this suite only

  it('allows the first 5 attempts then returns 429 on the 6th (per-IP limit)', async () => {
    const email = 'ratelimit@authtest.local';
    await createUser(email, PASSWORD);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', RATELIMIT_IP)
        .send({ email, password: 'wrong-on-purpose' });
      statuses.push(res.status);
    }

    // First 5 are processed by the handler (401 for bad creds), the 6th is 429.
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Refresh-token reuse detection + rotation grace window
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/refresh — reuse detection', () => {
  it('a just-rotated token replayed within the grace window → 200 access token, no new cookie, successor stays live', async () => {
    const userId = await createUser('grace@authtest.local', PASSWORD);
    const successorId = randomUUID();
    const successor = seedRefreshToken(userId, { id: successorId });
    const old = seedRefreshToken(userId, { revoked: true, replacedBy: successorId, lastUsedAt: new Date().toISOString() });

    const res = await refreshPost().set('Cookie', refreshCookie(old));
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(refreshRow(successor)?.revoked).toBe(0);
  });

  it('a rotated token replayed after the grace window → 401 and the whole family is revoked', async () => {
    const userId = await createUser('reuse@authtest.local', PASSWORD);
    const id3 = randomUUID();
    const id2 = randomUUID();
    const t3 = seedRefreshToken(userId, { id: id3 });
    const t2 = seedRefreshToken(userId, { id: id2, revoked: true, replacedBy: id3, lastUsedAt: new Date().toISOString() });
    const t1 = seedRefreshToken(userId, { revoked: true, replacedBy: id2, lastUsedAt: new Date(Date.now() - 60_000).toISOString() });
    const bystander = seedRefreshToken(userId); // annan session, ska inte beröras

    const res = await refreshPost().set('Cookie', refreshCookie(t1));
    expect(res.status).toBe(401);
    expect(refreshRow(t2)?.revoked).toBe(1);
    expect(refreshRow(t3)?.revoked).toBe(1);
    expect(refreshRow(bystander)?.revoked).toBe(0);

    // The live head of the family can no longer refresh.
    const head = await refreshPost().set('Cookie', refreshCookie(t3));
    expect(head.status).toBe(401);

    const audit = db.prepare("SELECT id FROM audit_log WHERE action = 'refresh_token_reuse' AND user_id = ?").get(userId);
    expect(audit).toBeDefined();
  });

  it('a token revoked by logout/password change (no successor) → 401 without touching the user\'s other tokens', async () => {
    const userId = await createUser('revoked-plain@authtest.local', PASSWORD);
    const revoked = seedRefreshToken(userId, { revoked: true });
    const other = seedRefreshToken(userId);

    const res = await refreshPost().set('Cookie', refreshCookie(revoked));
    expect(res.status).toBe(401);
    expect(refreshRow(other)?.revoked).toBe(0);
  });

  it('a successor that is itself revoked does not extend the grace window', async () => {
    const userId = await createUser('grace-dead@authtest.local', PASSWORD);
    const successorId = randomUUID();
    seedRefreshToken(userId, { id: successorId, revoked: true });
    const old = seedRefreshToken(userId, { revoked: true, replacedBy: successorId, lastUsedAt: new Date().toISOString() });

    const res = await refreshPost().set('Cookie', refreshCookie(old));
    expect(res.status).toBe(401);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 8. Rate limiter budgets
// ───────────────────────────────────────────────────────────────────────────
describe('rate limiter budgets', () => {
  it('successful refreshes do not consume the refresh budget (62 in a row from one IP)', async () => {
    const IP = '192.0.2.90';
    const userId = await createUser('refresh-budget@authtest.local', PASSWORD);
    let token = seedRefreshToken(userId);
    for (let i = 0; i < 62; i++) {
      const res = await request(app).post('/api/auth/refresh').set('X-Forwarded-For', IP).set('Cookie', refreshCookie(token));
      expect(res.status).toBe(200);
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refreshToken='))!;
      token = cookie.split(';')[0].slice('refreshToken='.length);
    }
  });

  it('failed refreshes are limited to 60 per window (61st → 429)', async () => {
    const IP = '192.0.2.91';
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const res = await request(app).post('/api/auth/refresh').set('X-Forwarded-For', IP).set('Cookie', refreshCookie('bogus-' + i));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 401)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it('successful logins do not consume the login budget (7 in a row from one IP)', async () => {
    const IP = '192.0.2.92';
    const email = 'login-budget@authtest.local';
    await createUser(email, PASSWORD);
    for (let i = 0; i < 7; i++) {
      const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', IP).send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
    }
  });

  it('forgot-password has its own budget: login failures from the same IP do not exhaust it', async () => {
    await initAnonCsrf();
    const IP = '192.0.2.93';
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').set('X-Forwarded-For', IP).send({ email: 'x@authtest.local', password: 'nope' });
    }
    const res = await anonAgent
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', IP)
      .set('x-csrf-token', anonCsrf)
      .send({ email: 'nobody@authtest.local' });
    expect(res.status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 9. Login hardening: per-account lockout, case-insensitive email, audit hygiene, rehash
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login — hardening', () => {
  const login = (email: unknown, password: string) =>
    request(app).post('/api/auth/login').set('X-Forwarded-For', freshIp()).send({ email, password });

  it('email lookup is case-insensitive', async () => {
    await createUser('mixedcase@authtest.local', PASSWORD);
    const res = await login('MixedCase@AuthTest.LOCAL', PASSWORD);
    expect(res.status).toBe(200);
  });

  it('locks an account after 10 failures (any IP): 429 + Retry-After, even with the right password', async () => {
    const email = 'lockout@authtest.local';
    await createUser(email, PASSWORD);
    for (let i = 0; i < 10; i++) {
      expect((await login(email, 'wrong-' + i)).status).toBe(401);
    }
    const locked = await login(email, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('För många misslyckade inloggningsförsök, försök igen om en stund');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    // Case variants hit the same counter; other accounts are unaffected.
    expect((await login('LOCKOUT@authtest.local', PASSWORD)).status).toBe(429);
    await createUser('lockout-other@authtest.local', PASSWORD);
    expect((await login('lockout-other@authtest.local', PASSWORD)).status).toBe(200);
  });

  it('rätt lösenord från en IP som tidigare loggat in lyckat går igenom låset, andra IP:n får 429', async () => {
    const email = 'lockout-known-ip@authtest.local';
    await createUser(email, PASSWORD);
    const ipA = freshIp();
    const ipB = freshIp();
    const ipC = freshIp();
    const loginFrom = (ip: string, password: string) =>
      request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password });

    expect((await loginFrom(ipB, PASSWORD)).status).toBe(200);
    // Angriparen låser kontot från IP A (varje fel kommer från en egen IP för att inte stoppas av IP-gränsen).
    expect((await loginFrom(ipA, 'wrong')).status).toBe(401);
    for (let i = 0; i < 9; i++) {
      expect((await login(email, 'wrong-' + i)).status).toBe(401);
    }
    expect((await loginFrom(ipA, PASSWORD)).status).toBe(429);
    expect((await loginFrom(ipC, PASSWORD)).status).toBe(429);

    // Känd IP: fel lösenord nekas fortfarande, rätt lösenord släpps in och nollställer låset.
    expect((await loginFrom(ipB, 'wrong')).status).toBe(401);
    expect((await loginFrom(ipB, PASSWORD)).status).toBe(200);
    expect((await loginFrom(ipA, PASSWORD)).status).toBe(200);
  });

  it('counts failures for unknown emails too (no enumeration via lockout behaviour)', async () => {
    const email = 'never-existed@authtest.local';
    for (let i = 0; i < 10; i++) {
      expect((await login(email, 'whatever')).status).toBe(401);
    }
    expect((await login(email, 'whatever')).status).toBe(429);
  });

  it('a successful login resets the per-account counter', async () => {
    const email = 'lockout-reset@authtest.local';
    await createUser(email, PASSWORD);
    for (let i = 0; i < 9; i++) await login(email, 'wrong');
    expect((await login(email, PASSWORD)).status).toBe(200);
    for (let i = 0; i < 9; i++) {
      expect((await login(email, 'wrong')).status).toBe(401);
    }
    expect((await login(email, PASSWORD)).status).toBe(200);
  });

  it('login_failure audit stores email-shaped input, but not arbitrary text (e.g. a pasted password)', async () => {
    await login('someone@authtest.local', 'x');
    await login('hunter2 is my password', 'x');
    const details = (db.prepare("SELECT details FROM audit_log WHERE action = 'login_failure' ORDER BY rowid DESC LIMIT 2").all() as { details: string }[])
      .map((r) => r.details);
    expect(details).toContain('email: <ogiltigt format>');
    expect(details).toContain('email: someone@authtest.local');
    expect(details.join('|')).not.toContain('hunter2');
  });

  it('a non-string email is rejected with 401/400 and does not crash', async () => {
    const res = await login({ $ne: 1 }, 'x');
    expect([400, 401]).toContain(res.status);
  });

  it('rehashes a legacy cost-10 hash to cost 12 on successful login, password still works', async () => {
    const email = 'rehash@authtest.local';
    const userId = await createUser(email, PASSWORD); // createUser hashes with cost 10
    const before = (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string }).password_hash;
    expect(bcrypt.getRounds(before)).toBe(10);

    expect((await login(email, PASSWORD)).status).toBe(200);
    const after = (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string }).password_hash;
    expect(bcrypt.getRounds(after)).toBe(12);
    expect(await bcrypt.compare(PASSWORD, after)).toBe(true);
    expect((await login(email, PASSWORD)).status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 10. must_change_password + token_version (access-token revocation)
// ───────────────────────────────────────────────────────────────────────────
describe('mustChangePassword + token_version', () => {
  it('login and /me expose mustChangePassword; change-password clears it', async () => {
    const email = 'mustchange@authtest.local';
    const userId = await createUser(email, PASSWORD);
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(userId);

    const loginRes = await request(app).post('/api/auth/login').set('X-Forwarded-For', freshIp()).send({ email, password: PASSWORD });
    expect(loginRes.body.user.mustChangePassword).toBe(true);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${loginRes.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(true);

    const { agent, token, csrf } = await loginAgent(email, PASSWORD);
    const change = await agent
      .post('/api/auth/change-password')
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(change.status).toBe(200);

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${change.body.accessToken}`);
    expect(after.body.user.mustChangePassword).toBe(false);
  });

  it('blocks every route except me/change-password/logout/refresh with 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const email = 'mustchange-block@authtest.local';
    const userId = await createUser(email, PASSWORD);
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(userId);
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', freshIp()).send({ email, password: PASSWORD });
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const blocked = await request(app).get('/api/tickets').set(auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({
      error: 'Lösenordet måste bytas innan du kan fortsätta',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    expect((await request(app).get('/api/users').set(auth)).status).toBe(403);

    expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(200);
    const logout = await request(app).post('/api/auth/logout').set('Cookie', refreshCookie(seedRefreshToken(userId)));
    expect(logout.status).toBe(204);
    expect((await refreshPost().set('Cookie', refreshCookie(seedRefreshToken(userId)))).status).toBe(200);
  });

  it('blocks API-key requests from a user who must change password, but lets change-password through', async () => {
    const email = 'mustchange-apikey@authtest.local';
    const userId = await createUser(email, PASSWORD);
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(userId);
    const rawKey = `itk_live_${randomBytes(16).toString('hex')}`;
    db.prepare(
      'INSERT INTO api_keys (id, name, key_prefix, key_hash, user_id, permissions) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), 'mustchange-key', rawKey.substring(9, 17), sha256(rawKey), userId, JSON.stringify(['read', 'write']));

    const blocked = await request(app).get('/api/tickets').set('Authorization', `Bearer ${rawKey}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const change = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${rawKey}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(change.status).toBe(200);
    expect((await request(app).get('/api/tickets').set('Authorization', `Bearer ${rawKey}`)).status).toBe(200);
  });

  it('change-password kills the old access token at once (tv bump) and hands the caller a working new one + cookie', async () => {
    const email = 'tv-change@authtest.local';
    const userId = await createUser(email, PASSWORD);
    const { agent, token, csrf } = await loginAgent(email, PASSWORD);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

    const change = await agent
      .post('/api/auth/change-password')
      .set('X-Forwarded-For', freshIp())
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(change.status).toBe(200);
    expect((change.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('refreshToken='))).toBe(true);

    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${change.body.accessToken}`)).status).toBe(200);
    expect((db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId) as { token_version: number }).token_version).toBe(1);
  });

  it('a token whose tv is lower than the stored token_version is rejected; equal/missing tv is accepted', async () => {
    const email = 'tv-manual@authtest.local';
    const userId = await createUser(email, PASSWORD);
    const { token } = await loginAgent(email, PASSWORD);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    db.prepare('UPDATE users SET token_version = 3 WHERE id = ?').run(userId);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);

    // Refresh mints a token carrying the current version.
    const refreshToken = seedRefreshToken(userId);
    const refreshed = await refreshPost().set('Cookie', refreshCookie(refreshToken));
    expect(refreshed.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${refreshed.body.accessToken}`)).status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 11. reset-password race + forgot-password background send
// ───────────────────────────────────────────────────────────────────────────
describe('reset-password / forgot-password hardening', () => {
  beforeAll(async () => {
    await initAnonCsrf();
  });

  it('two concurrent resets with the same token: exactly one wins, the other gets 400', async () => {
    const userId = await createUser('reset-race@authtest.local', PASSWORD);
    const rawToken = seedResetToken(userId);
    const [a, b] = await Promise.all([
      resetPost().send({ token: rawToken, newPassword: NEW_PASSWORD }),
      resetPost().send({ token: rawToken, newPassword: 'AnotherStr0ng!Pw99' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect((db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId) as { token_version: number }).token_version).toBe(1);
  });

  it('forgot-password matches the email case-insensitively and issues the token after responding', async () => {
    const userId = await createUser('forgot-case@authtest.local', PASSWORD);
    const res = await forgotPost().send({ email: '  Forgot-Case@AuthTest.local ' });
    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      const row = db.prepare('SELECT id FROM password_reset_tokens WHERE user_id = ?').get(userId);
      expect(row).toBeDefined();
    });
  });
});
