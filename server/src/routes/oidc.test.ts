import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

const { DB_PATH, TENANT_GUID, ISSUER, discovered } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-oidc-routes.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-oidcr-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-oidcr-0123456789abcdef0123456789abcdef';
  const tenant = '11111111-2222-3333-4444-555555555555';
  const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
  // Muterbar så enskilda test kan simulera vad discovery SVARAR med.
  return { DB_PATH: dbPath, TENANT_GUID: tenant, ISSUER: issuer, discovered: { issuer } };
});

// Mocka openid-client: deterministiska värden, ingen nätverkstrafik.
vi.mock('openid-client', () => ({
  discovery: vi.fn(async () => ({ serverMetadata: () => ({ issuer: discovered.issuer }) })),
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
import { resetOidcCache, probeOidcAtBoot } from '../lib/oidc.js';
import { describeIdpError } from './auth.js';
import * as oidcClient from 'openid-client';

let app: ReturnType<typeof createApp>;

const OIDC_ENV = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_BUTTON_LABEL'];
function setFullOidcEnv() {
  // Tenant-specifik issuer (inte /common) — annars vägrar getOidcConfigStatus.
  process.env.OIDC_ISSUER_URL = ISSUER;
  process.env.OIDC_CLIENT_ID = 'client-123';
  process.env.OIDC_CLIENT_SECRET = 'secret-abc';
  process.env.OIDC_REDIRECT_URI = 'https://ticket.example.se/api/auth/oidc/callback';
}

beforeAll(() => { initializeDatabase(); app = createApp(); });
afterAll(() => { closeDatabase(); if (existsSync(DB_PATH)) rmSync(DB_PATH); });
beforeEach(() => {
  OIDC_ENV.forEach((k) => delete process.env[k]);
  // Nollställer BÅDE discovery-cachen och boot-probens avstängningsflagga —
  // annars läcker en avstängning från ett test in i alla efterföljande.
  resetOidcCache();
  discovered.issuer = ISSUER;
  vi.clearAllMocks();
});

// Unik käll-IP per anrop: callback-routen är rate-limitad (20 per kvart per IP)
// och den här sviten gör fler anrop än så. Utan variationen faller de sista
// testerna på 429 istället för på det de faktiskt testar.
// (app.set('trust proxy', 1) → req.ip läses ur X-Forwarded-For.)
let callbackIpCounter = 0;
const oidcCallback = (query = 'code=abc&state=test-state') => {
  callbackIpCounter++;
  return request(app)
    .get(`/api/auth/oidc/callback?${query}`)
    .set('X-Forwarded-For', `10.9.${Math.floor(callbackIpCounter / 200)}.${(callbackIpCounter % 200) + 1}`);
};

describe('GET /api/auth/oidc/enabled', () => {
  it('utan config → { enabled: false, label: null, provider: null }', async () => {
    const res = await request(app).get('/api/auth/oidc/enabled');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, label: null, provider: null });
  });
  it('med Entra-config → { enabled: true, label, provider: "microsoft" }', async () => {
    setFullOidcEnv();
    process.env.OIDC_BUTTON_LABEL = 'Logga in med Microsoft';
    const res = await request(app).get('/api/auth/oidc/enabled');
    expect(res.body).toEqual({ enabled: true, label: 'Logga in med Microsoft', provider: 'microsoft' });
  });
  // Providerhinten får ALDRIG gissas ur OIDC_BUTTON_LABEL — en operatör med en
  // generisk (icke-Entra) IdP kan skriva vad som helst i labeln, inklusive
  // "Logga in med Microsoft", utan att providern faktiskt är Microsoft.
  it('med generisk (icke-Entra) config → provider: null trots en Microsoft-liknande label', async () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://keycloak.example.se/realms/it';
    process.env.OIDC_BUTTON_LABEL = 'Logga in med Microsoft';
    const res = await request(app).get('/api/auth/oidc/enabled');
    expect(res.body).toEqual({ enabled: true, label: 'Logga in med Microsoft', provider: null });
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

// ── Boot-probe: lås 2 utvärderas vid START, inte först vid första callbacken ──
describe('probeOidcAtBoot', () => {
  it('discovery lyckas men issuern är en platshållarmall → SSO stängs AV (enabled:false + 503)', async () => {
    setFullOidcEnv();
    discovered.issuer = 'https://login.microsoftonline.com/{tenantid}/v2.0';
    await probeOidcAtBoot();
    const enabled = await request(app).get('/api/auth/oidc/enabled');
    expect(enabled.body).toEqual({ enabled: false, label: null, provider: null });
    expect((await request(app).get('/api/auth/oidc/login')).status).toBe(503);
    // Callbacken är en top-level browser-navigation (inte ett fetch-anrop som
    // /oidc/login) — den ska redirecta till inloggningen, inte visa rå JSON.
    const cb = await oidcCallback('code=abc&state=test-state');
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/login?sso_error=failed');
  });

  it('discovery lyckas med en issuer vi litar på → SSO förblir PÅ', async () => {
    setFullOidcEnv();
    await probeOidcAtBoot();
    expect((await request(app).get('/api/auth/oidc/enabled')).body.enabled).toBe(true);
  });

  it('NÄTVERKSFEL vid start → SSO förblir PÅ (en IdP-hicka får inte slå av SSO permanent)', async () => {
    setFullOidcEnv();
    (oidcClient.discovery as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ENOTFOUND idp'));
    await expect(probeOidcAtBoot()).resolves.toBeUndefined();
    expect((await request(app).get('/api/auth/oidc/enabled')).body.enabled).toBe(true);
  });

  it('utan config gör proben ingenting (kastar inte, rör inte discovery)', async () => {
    await expect(probeOidcAtBoot()).resolves.toBeUndefined();
    expect(oidcClient.discovery).not.toHaveBeenCalled();
  });

  it('resetOidcCache nollställer avstängningsflaggan (annars läcker den mellan tester)', async () => {
    setFullOidcEnv();
    discovered.issuer = 'https://login.microsoftonline.com/{tenantid}/v2.0';
    await probeOidcAtBoot();
    expect((await request(app).get('/api/auth/oidc/enabled')).body.enabled).toBe(false);
    resetOidcCache();
    discovered.issuer = ISSUER;
    expect((await request(app).get('/api/auth/oidc/enabled')).body.enabled).toBe(true);
  });
});

function seedUser(email: string, oidcSub: string | null = null, oidcIss: string | null = null): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, role, oidc_sub, oidc_iss) VALUES (?, ?, 'x', 'user', ?, ?)")
    .run(id, email, oidcSub, oidcIss);
  return id;
}

// Bas-claims för ett giltigt token från VÅR tenant. preferred_username = UPN är
// den adress vi matchar på (email-claimen kräver verifieringsbevis).
const okClaims = (extra: Record<string, unknown>) => ({ iss: ISSUER, tid: TENANT_GUID, ...extra });

const refreshTokenCount = () =>
  (db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens').get() as { n: number }).n;
const auditActions = () =>
  (db.prepare('SELECT action, details FROM audit_log ORDER BY rowid').all() as { action: string; details: string }[]);

const TX_COOKIE = `oidcTx=${encodeURIComponent(JSON.stringify({ state: 'test-state', nonce: 'test-nonce', codeVerifier: 'test-verifier' }))}`;

function mockGrantSuccess(claims: Record<string, unknown>) {
  (oidcClient.authorizationCodeGrant as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    claims: () => claims,
  });
}

describe('GET /api/auth/oidc/callback', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM audit_log').run();
    db.prepare('DELETE FROM refresh_tokens').run();
    db.prepare('DELETE FROM users').run();
  });

  it('lyckad inloggning: länkar sub+iss, sätter refresh-cookie, 302 → /login?sso=1', async () => {
    setFullOidcEnv();
    const userId = seedUser('anna@x.se');
    mockGrantSuccess(okClaims({ sub: 'sub-1', preferred_username: 'anna@x.se' }));
    const res = await oidcCallback('code=abc&state=test-state')
      .set('Cookie', TX_COOKIE);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso=1');
    const setCookies = res.headers['set-cookie'] as unknown as string[];
    expect(setCookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
    expect(db.prepare('SELECT oidc_sub, oidc_iss FROM users WHERE id = ?').get(userId))
      .toEqual({ oidc_sub: 'sub-1', oidc_iss: ISSUER });
    expect(db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?').get(userId)).toMatchObject({ n: 1 });
    // Länkningen ska synas som egen audit-händelse, före login_success.
    expect(auditActions().map((a) => a.action)).toEqual(['oidc_link', 'login_success']);
    expect(auditActions()[0].details).toContain(ISSUER);
  });

  it('andra inloggningen länkar inte om (ingen ny oidc_link-rad)', async () => {
    setFullOidcEnv();
    seedUser('anna@x.se', 'sub-1', ISSUER);
    mockGrantSuccess(okClaims({ sub: 'sub-1', preferred_username: 'anna@x.se' }));
    await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(auditActions().map((a) => a.action)).toEqual(['login_success']);
  });

  it('refresh-cookien från SSO fungerar mot befintliga POST /refresh', async () => {
    setFullOidcEnv();
    seedUser('anna@x.se');
    mockGrantSuccess(okClaims({ sub: 'sub-1', preferred_username: 'anna@x.se' }));
    const cb = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    const refreshCookie = (cb.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('refreshToken='))!.split(';')[0];
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeDefined();
  });

  it('okänd användare → 302 /login?sso_error=unknown_user, inget konto skapas', async () => {
    setFullOidcEnv();
    mockGrantSuccess(okClaims({ sub: 'sub-x', preferred_username: 'ghost@x.se' }));
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=unknown_user');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 0 });
    // Den försökta e-postadressen ska finnas i audit-raden (som vid lösenordslogin).
    expect(auditActions()[0]).toMatchObject({ action: 'login_failure' });
    expect(auditActions()[0].details).toContain('ghost@x.se');
  });

  it('claim-styrda strängar trunkeras i audit-loggen', async () => {
    setFullOidcEnv();
    const longSub = 'S'.repeat(500);
    const longEmail = `${'e'.repeat(500)}@x.se`;
    mockGrantSuccess(okClaims({ sub: longSub, preferred_username: longEmail }));
    await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    const details = auditActions()[0].details;
    expect(details.length).toBeLessThan(400);
    expect(details).toContain('…');
    expect(details).not.toContain(longSub);
  });

  // ── KRAV B: exakt EN tenant får autentisera ────────────────────────────────
  it('fel iss (annan Entra-tenant) → failed, INGEN skrivning (oidc_sub NULL, 0 refresh_tokens)', async () => {
    setFullOidcEnv();
    const userId = seedUser('anna@x.se');
    mockGrantSuccess({
      iss: 'https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0',
      tid: '99999999-2222-3333-4444-555555555555',
      sub: 'sub-1',
      preferred_username: 'anna@x.se',
    });
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
    expect(auditActions()[0].details).toContain('issuer_mismatch');
  });

  it('rätt iss men fel tid → failed, INGEN skrivning', async () => {
    setFullOidcEnv();
    const userId = seedUser('anna@x.se');
    mockGrantSuccess({ iss: ISSUER, tid: '99999999-2222-3333-4444-555555555555', sub: 'sub-1', preferred_username: 'anna@x.se' });
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
    expect(auditActions()[0].details).toContain('tenant_mismatch');
  });

  it('tid saknas helt → failed, INGEN skrivning (fail-closed)', async () => {
    setFullOidcEnv();
    const userId = seedUser('anna@x.se');
    mockGrantSuccess({ iss: ISSUER, sub: 'sub-1', preferred_username: 'anna@x.se' });
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
  });

  // Isolerad tand: HÄR är platshållarvakten det ENDA som kan fälla anropet.
  // Därför en generisk IdP (inget tenant-lås) och ett token vars iss är EXAKT
  // den upptäckta platshållarsträngen — tas vakten bort loggas användaren in.
  it('platshållar-issuer fälls av platshållarvakten ENSAM (iss matchar, inget tenant-lås inblandat)', async () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://idp.example.se/realms/it';
    const placeholder = 'https://idp.example.se/{tenantid}/v2.0';
    discovered.issuer = placeholder;
    const userId = seedUser('anna@x.se');
    mockGrantSuccess({ iss: placeholder, sub: 'sub-1', preferred_username: 'anna@x.se' });
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
  });

  it('Entras platshållar-issuer ({tenantid}) → failed (vakten först, tenant-låset som andra linje)', async () => {
    setFullOidcEnv();
    discovered.issuer = 'https://login.microsoftonline.com/{tenantid}/v2.0';
    const userId = seedUser('anna@x.se');
    // Tokenet ser "giltigt" ut mot mallen — det är precis det som är faran.
    mockGrantSuccess({ iss: ISSUER, tid: TENANT_GUID, sub: 'sub-1', preferred_username: 'anna@x.se' });
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
  });

  it('discovery svarar med Microsofts konsument-tenant (MSA) → failed, INGEN skrivning', async () => {
    setFullOidcEnv();
    const msa = 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0';
    process.env.OIDC_ISSUER_URL = msa; // passerar lås 1: konkret GUID, inte /consumers
    discovered.issuer = msa;
    const userId = seedUser('anna@x.se');
    mockGrantSuccess({
      iss: msa,
      tid: '9188040d-6c67-4c5b-b112-36a304b66dad',
      sub: 'sub-1',
      preferred_username: 'anna@x.se',
    });
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
  });

  it('discovery pekar på en ANNAN tenant än OIDC_ISSUER_URL → failed, INGEN skrivning', async () => {
    setFullOidcEnv();
    const other = 'https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0';
    discovered.issuer = other;
    const userId = seedUser('anna@x.se');
    mockGrantSuccess({
      iss: other,
      tid: '99999999-2222-3333-4444-555555555555',
      sub: 'sub-1',
      preferred_username: 'anna@x.se',
    });
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
  });

  // Callbacken redirectar (aldrig JSON) även när SSO är av: den nås som en
  // top-level browser-navigation från IdP:n, så ett rått 503 hade renderats som
  // text i webbläsaren istället för att ta användaren tillbaka till login.
  it('multitenant-endpoint i OIDC_ISSUER_URL → SSO av, redirect utan token-exchange', async () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://login.microsoftonline.com/common/v2.0';
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(oidcClient.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it('procentkodad multitenant-endpoint i OIDC_ISSUER_URL → SSO av, redirect utan token-exchange', async () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://login.microsoftonline.com/%63ommon/v2.0';
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(oidcClient.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  // ── KRAV A: bara befintliga, interna konton ────────────────────────────────
  it('gästkonto (#EXT#) → failed (inte unknown_user), INGEN skrivning', async () => {
    setFullOidcEnv();
    const userId = seedUser('extern@partner.se');
    mockGrantSuccess(okClaims({
      sub: 'sub-g',
      email: 'extern@partner.se',
      preferred_username: 'extern_partner.se#EXT#@prefab.onmicrosoft.com',
    }));
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
    expect(auditActions()[0].details).toContain('guest_account');
  });

  it('gästkonto via acct: 1 → failed, INGEN skrivning', async () => {
    setFullOidcEnv();
    const userId = seedUser('gast@partner.se');
    mockGrantSuccess(okClaims({ sub: 'sub-g', preferred_username: 'gast@partner.se', acct: 1 }));
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
    expect(auditActions()[0].details).toContain('guest_account');
  });

  it('OVERIFIERAD email-claim som matchar ett konto → failed, INGEN inloggning (nOAuth)', async () => {
    setFullOidcEnv();
    const userId = seedUser('admin@prefab.se');
    mockGrantSuccess(okClaims({ sub: 'sub-angripare', email: 'admin@prefab.se' }));
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
  });

  it('UPN som inte finns + email som matchar admin → unknown_user, INGEN inloggning', async () => {
    setFullOidcEnv();
    const adminId = seedUser('admin@prefab.se');
    mockGrantSuccess(okClaims({
      sub: 'sub-angripare',
      preferred_username: 'angripare@prefab.se',
      email: 'admin@prefab.se',
      email_verified: true,
    }));
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=unknown_user');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(adminId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
  });

  it('verifierad email (xms_edov) utan UPN → inloggning fungerar', async () => {
    setFullOidcEnv();
    const userId = seedUser('anna@x.se');
    mockGrantSuccess(okClaims({ sub: 'sub-1', email: 'anna@x.se', xms_edov: true }));
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso=1');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: 'sub-1' });
  });

  it('sub_conflict → failed (orsaken läcker inte som unknown_user)', async () => {
    setFullOidcEnv();
    seedUser('anna@x.se', 'sub-gammal', ISSUER);
    mockGrantSuccess(okClaims({ sub: 'sub-ny', preferred_username: 'anna@x.se' }));
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(refreshTokenCount()).toBe(0);
  });

  it('saknad tx-cookie → 302 /login?sso_error=failed (ingen token-exchange görs)', async () => {
    setFullOidcEnv();
    const res = await oidcCallback('code=abc&state=test-state');
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(oidcClient.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it.each([
    ['inte JSON alls', 'inte-json'],
    ['JSON men inte ett objekt', '"bara-en-sträng"'],
    ['saknad codeVerifier', JSON.stringify({ state: 'test-state', nonce: 'test-nonce' })],
    ['tom state', JSON.stringify({ state: '', nonce: 'test-nonce', codeVerifier: 'test-verifier' })],
    ['fel typ på nonce', JSON.stringify({ state: 'test-state', nonce: 42, codeVerifier: 'test-verifier' })],
  ])('trasig tx-cookie (%s) → failed utan token-exchange', async (_label, raw) => {
    setFullOidcEnv();
    const res = await oidcCallback('code=abc&state=test-state')
      .set('Cookie', `oidcTx=${encodeURIComponent(raw)}`);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(oidcClient.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it('exchange-fel (t.ex. state-mismatch) → 302 /login?sso_error=failed', async () => {
    setFullOidcEnv();
    seedUser('anna@x.se');
    (oidcClient.authorizationCodeGrant as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('state mismatch'));
    const res = await oidcCallback('code=abc&state=FEL').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
  });

  it('tomt sub i tokenet → failed, ingen länkning', async () => {
    setFullOidcEnv();
    const userId = seedUser('anna@x.se');
    mockGrantSuccess(okClaims({ sub: '   ', preferred_username: 'anna@x.se' }));
    const res = await oidcCallback('code=abc&state=test-state').set('Cookie', TX_COOKIE);
    expect(res.headers.location).toBe('/login?sso_error=failed');
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(userId)).toMatchObject({ oidc_sub: null });
    expect(refreshTokenCount()).toBe(0);
  });

  it('utan config → redirect till login (aldrig JSON i en browser-navigation)', async () => {
    const res = await oidcCallback('code=abc&state=s');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso_error=failed');
  });
});

// Regression: första skarpa SSO-inloggningen på prod (2026-08-13) failade med
// "ResponseBodyError: server responded with an error in the response body" och
// INGET mer. Fel client secret, redirect-URI under fel plattform och förbrukad kod
// ger alla exakt den strängen — orsaken låg i fälten String(error) kastade bort.
describe('describeIdpError', () => {
  it('plockar ut IdP:ns error/error_description/status ur ett oauth4webapi-fel', () => {
    const err = Object.assign(new Error('server responded with an error in the response body'), {
      error: 'invalid_client',
      error_description: 'AADSTS7000215: Invalid client secret provided. Trace ID: abc',
      status: 401,
      code: 'OAUTH_RESPONSE_BODY_ERROR',
    });
    const d = describeIdpError(err);
    expect(d.idpError).toBe('invalid_client');
    expect(d.idpErrorDescription).toContain('AADSTS7000215');
    expect(d.idpHttpStatus).toBe(401);
    expect(d.idpErrorCode).toBe('OAUTH_RESPONSE_BODY_ERROR');
  });

  it('klarar ett vanligt fel utan IdP-fält (inga påhittade nycklar)', () => {
    const d = describeIdpError(new Error('boom'));
    expect(d.error).toContain('boom');
    expect(d).not.toHaveProperty('idpError');
    expect(d).not.toHaveProperty('idpErrorDescription');
    expect(d).not.toHaveProperty('idpHttpStatus');
  });

  it('trunkerar och rensar styrtecken ur IdP-texten (loggförfalskning)', () => {
    const d = describeIdpError(
      Object.assign(new Error('x'), { error_description: `AADSTS1\n"level":"info"\r${'y'.repeat(600)}` })
    );
    const desc = d.idpErrorDescription as string;
    expect(desc).not.toMatch(/[\n\r]/);
    expect(desc.length).toBeLessThanOrEqual(401);
    expect(desc.endsWith('…')).toBe(true);
  });
});
