import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID, createHash } from 'crypto';

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
 * Rate-limit budget: the SAME module-level loginRateLimiter (5 attempts /
 * 15 min per IP) guards /login, /forgot-password AND /reset-password, and there
 * is no test-mode bypass in the source. The app runs with `trust proxy = 1`, so
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
function seedRefreshToken(userId: string, opts: { revoked?: boolean; expiresAt?: string } = {}): string {
  const token = randomUUID() + randomUUID(); // unique 64-ish hex-ish value
  db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token, expires_at, revoked) VALUES (?, ?, ?, ?, ?)'
  ).run(randomUUID(), userId, token, opts.expiresAt ?? futureIso(REFRESH_EXPIRY_DAYS), opts.revoked ? 1 : 0);
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

    // The login actually persisted a refresh token for this user.
    const count = (db.prepare('SELECT COUNT(*) as c FROM refresh_tokens WHERE user_id = ?').get(userId) as { c: number }).c;
    expect(count).toBeGreaterThanOrEqual(1);
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

    // Rotation: a fresh refresh cookie is set, and the old token is gone from the DB.
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const rotated = setCookie?.find((c) => c.startsWith('refreshToken='));
    expect(rotated).toBeTruthy();
    expect(rotated).not.toContain(token);
    const oldStillThere = db.prepare('SELECT id FROM refresh_tokens WHERE token = ?').get(token);
    expect(oldStillThere).toBeUndefined();
  });

  it('replaying the rotated-away old token → 401', async () => {
    const token = seedRefreshToken(userId);
    // First refresh consumes (rotates away) the token.
    const first = await refreshPost().set('Cookie',refreshCookie(token));
    expect(first.status).toBe(200);
    // Replay the now-deleted token.
    const replay = await refreshPost().set('Cookie',refreshCookie(token));
    expect(replay.status).toBe(401);
  });

  it('no refresh token at all → 400', async () => {
    const res = await refreshPost().send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
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
    const row = db.prepare('SELECT id FROM refresh_tokens WHERE token = ?').get(token);
    expect(row).toBeUndefined();
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
  // logout requires `authenticate` (a valid access token via login) AND is a
  // mutating route that is NOT CSRF-exempt, so it needs the x-csrf-token header.
  it('revokes the refresh token so a subsequent refresh with it → 401', async () => {
    const email = 'logout@authtest.local';
    await createUser(email, PASSWORD);
    const { agent, token, csrf } = await loginAgent(email, PASSWORD);

    // The login set a refresh cookie on the agent; grab its raw value from the DB
    // (the cookie is HttpOnly so we cannot read it from JS, but it is the only
    // refresh token for this user).
    const row = db.prepare('SELECT token FROM refresh_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?)')
      .get(email) as { token: string } | undefined;
    expect(row?.token).toBeTruthy();
    const refreshToken = row!.token;

    const logout = await agent
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrf);
    expect(logout.status).toBe(200);
    expect(logout.body.message).toMatch(/logged out/i);

    // The token is now revoked in the DB.
    const after = db.prepare('SELECT revoked FROM refresh_tokens WHERE token = ?').get(refreshToken) as { revoked: number } | undefined;
    expect(after?.revoked).toBe(1);

    // And refresh with that (revoked) token is rejected.
    const refresh = await refreshPost().set('Cookie',refreshCookie(refreshToken));
    expect(refresh.status).toBe(401);
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

    // Every refresh token for this user is revoked.
    const live = (db.prepare('SELECT COUNT(*) as c FROM refresh_tokens WHERE user_id = ? AND revoked = 0').get(userId) as { c: number }).c;
    expect(live).toBe(0);

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
