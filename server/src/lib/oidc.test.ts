import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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

import type * as client from 'openid-client';
import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import {
  getOidcSettings,
  getOidcConfigStatus,
  getOidcIssuerIdentity,
  verifyOidcClaims,
  findOrLinkOidcUser,
  getOidcProviderHint,
  OIDC_REQUIRED_ENV,
} from './oidc.js';

const OIDC_ENV = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_BUTTON_LABEL'];

const TENANT_GUID = '11111111-2222-3333-4444-555555555555';
const ISSUER = `https://login.microsoftonline.com/${TENANT_GUID}/v2.0`;

function setFullOidcEnv() {
  process.env.OIDC_ISSUER_URL = ISSUER;
  process.env.OIDC_CLIENT_ID = 'client-123';
  process.env.OIDC_CLIENT_SECRET = 'secret-abc';
  process.env.OIDC_REDIRECT_URI = 'https://ticket.example.se/api/auth/oidc/callback';
}

function seedUser(
  email: string,
  oidcSub: string | null = null,
  oidcIss: string | null = null,
  role = 'user'
): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, role, oidc_sub, oidc_iss) VALUES (?, ?, 'x', ?, ?, ?)")
    .run(id, email, role, oidcSub, oidcIss);
  return id;
}

// getOidcIssuerIdentity tar bara emot en Configuration för serverMetadata().
function fakeConfig(issuer: unknown): client.Configuration {
  return { serverMetadata: () => ({ issuer }) } as unknown as client.Configuration;
}

const entraIdentity = { issuer: ISSUER, tenantId: TENANT_GUID };

beforeAll(() => initializeDatabase());
afterAll(() => { closeDatabase(); if (existsSync(DB_PATH)) rmSync(DB_PATH); });
beforeEach(() => {
  OIDC_ENV.forEach((k) => delete process.env[k]);
  db.prepare('DELETE FROM users').run();
});

describe('getOidcConfigStatus', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { errSpy.mockRestore(); warnSpy.mockRestore(); });

  it('off när config saknas helt (missing listar alla fyra)', () => {
    expect(getOidcConfigStatus()).toEqual({ state: 'off', missing: [...OIDC_REQUIRED_ENV] });
    // Ingen varning när INGET är satt — det är det normala läget.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('off när en av de fyra obligatoriska saknas', () => {
    setFullOidcEnv();
    delete process.env.OIDC_CLIENT_SECRET;
    expect(getOidcConfigStatus().state).toBe('off');
  });

  it('halvvägs-config: missing namnger nyckeln och loggas som varning (aldrig värdet)', () => {
    // Nollställ dedupe-nyckeln först (grenen "allt saknas" sätter den till null),
    // annars kan ett tidigare test redan ha loggat samma uppsättning nycklar.
    getOidcConfigStatus();
    setFullOidcEnv();
    delete process.env.OIDC_CLIENT_SECRET;
    const status = getOidcConfigStatus();
    expect(status).toEqual({ state: 'off', missing: ['OIDC_CLIENT_SECRET'] });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = String(warnSpy.mock.calls[0][0]);
    expect(line).toContain('OIDC_CLIENT_SECRET');
    // Värdena får ALDRIG loggas.
    expect(line).not.toContain('secret-abc');
    expect(line).not.toContain('client-123');
  });

  it('halvvägs-config loggas en gång per unik uppsättning saknade nycklar', () => {
    // Nollställ dedupe-nyckeln (all-saknad-grenen sätter den till null).
    getOidcConfigStatus();
    setFullOidcEnv();
    delete process.env.OIDC_REDIRECT_URI;
    getOidcConfigStatus();
    getOidcConfigStatus();
    getOidcConfigStatus();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('on för tenant-specifik GUID-issuer', () => {
    setFullOidcEnv();
    const status = getOidcConfigStatus();
    expect(status.state).toBe('on');
    expect(getOidcSettings()).toMatchObject({ clientId: 'client-123', buttonLabel: 'Logga in med SSO' });
  });

  it('on för tenant-domänform (MÅSTE tillåtas — issuern saknar platshållare)', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://login.microsoftonline.com/prefabmastarna.se/v2.0';
    expect(getOidcConfigStatus().state).toBe('on');
  });

  it('on trots avslutande snedstreck', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = `${ISSUER}/`;
    expect(getOidcConfigStatus().state).toBe('on');
  });

  it('on för generisk IdP (icke-Entra)', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://idp.example.se/realms/it';
    expect(getOidcConfigStatus().state).toBe('on');
  });

  it('invalid när OIDC_ISSUER_URL inte är en URL', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'inte-en-url';
    expect(getOidcConfigStatus()).toMatchObject({ state: 'invalid' });
    expect(getOidcSettings()).toBeNull();
  });

  it('invalid för http:// (klartext)', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = `http://login.microsoftonline.com/${TENANT_GUID}/v2.0`;
    expect(getOidcConfigStatus()).toMatchObject({ state: 'invalid' });
  });

  it('invalid för sts.windows.net (Entra v1.0)', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = `https://sts.windows.net/${TENANT_GUID}/`;
    expect(getOidcConfigStatus()).toMatchObject({ state: 'invalid' });
  });

  it.each(['common', 'Organizations', 'CONSUMERS'])(
    'invalid för Entras multitenant-endpoint /%s (case-okänsligt)',
    (segment) => {
      setFullOidcEnv();
      process.env.OIDC_ISSUER_URL = `https://login.microsoftonline.com/${segment}/v2.0`;
      const status = getOidcConfigStatus();
      expect(status.state).toBe('invalid');
      expect(getOidcSettings()).toBeNull();
    }
  );

  it.each(['%63ommon', 'c%6Fmmon', '%6Frganizations'])(
    'procentkodad multitenant-endpoint /%s avkodas innan uppslag → invalid',
    (segment) => {
      setFullOidcEnv();
      process.env.OIDC_ISSUER_URL = `https://login.microsoftonline.com/${segment}/v2.0`;
      expect(getOidcConfigStatus().state).toBe('invalid');
    }
  );

  it.each([
    'login.microsoftonline.us',
    'login.microsoftonline.de',
    'login.partner.microsoftonline.cn',
    'login.windows.net',
  ])('multitenant-blocklistan gäller hela Entra-familjen: %s/common → invalid', (host) => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = `https://${host}/common/v2.0`;
    expect(getOidcConfigStatus().state).toBe('invalid');
  });

  it('avslutande "." i värdnamnet (FQDN, löser till samma DNS-namn) kringgår INTE multitenant-blocklistan', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://login.microsoftonline.com./common/v2.0';
    expect(getOidcConfigStatus()).toMatchObject({ state: 'invalid' });
  });

  it('login.microsoft.com (kortnamnsalias för login.microsoftonline.com) räknas till Entra-familjen → /common invalid', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://login.microsoft.com/common/v2.0';
    expect(getOidcConfigStatus()).toMatchObject({ state: 'invalid' });
  });

  it('login.microsoft.com med tenant-specifik endpoint är fortfarande OK', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = `https://login.microsoft.com/${TENANT_GUID}/v2.0`;
    expect(getOidcConfigStatus().state).toBe('on');
  });

  it('tenant-specifik endpoint på en annan Entra-värd är fortfarande OK', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = `https://login.microsoftonline.us/${TENANT_GUID}/v2.0`;
    expect(getOidcConfigStatus().state).toBe('on');
  });

  it('trasig procentkodning kastar inte (faller tillbaka på rådata)', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://login.microsoftonline.com/%zz/v2.0';
    expect(getOidcConfigStatus().state).toBe('on');
  });

  it('"common" som tenantNAMN hos en annan IdP är inte multitenant → on', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://idp.example.se/common/v2.0';
    expect(getOidcConfigStatus().state).toBe('on');
  });

  it('loggar orsaken en gång per unik orsak (ingen spam per request)', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://login.microsoftonline.com/common/v2.0';
    getOidcConfigStatus();
    getOidcConfigStatus();
    getOidcConfigStatus();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});

describe('getOidcIssuerIdentity', () => {
  it('kastar när upptäckt issuer är en platshållarmall (multitenant-discovery)', () => {
    expect(() =>
      getOidcIssuerIdentity(fakeConfig('https://login.microsoftonline.com/{tenantid}/v2.0'))
    ).toThrow(/platshållarmall/);
  });

  it('extraherar tenantId för Entra', () => {
    expect(getOidcIssuerIdentity(fakeConfig(ISSUER))).toEqual({ issuer: ISSUER, tenantId: TENANT_GUID });
  });

  it('extraherar tenantId även på andra Entra-värdar (samma familj som blocklistan)', () => {
    const iss = `https://login.windows.net/${TENANT_GUID}/v2.0`;
    expect(getOidcIssuerIdentity(fakeConfig(iss))).toEqual({ issuer: iss, tenantId: TENANT_GUID });
  });

  it('extraherar tenantId trots avslutande "." i värdnamnet (samma isEntraHost som lås 1)', () => {
    const iss = `https://login.microsoftonline.com./${TENANT_GUID}/v2.0`;
    expect(getOidcIssuerIdentity(fakeConfig(iss))).toEqual({ issuer: iss, tenantId: TENANT_GUID });
  });

  it('extraherar tenantId för login.microsoft.com (alias, samma familj som blocklistan)', () => {
    const iss = `https://login.microsoft.com/${TENANT_GUID}/v2.0`;
    expect(getOidcIssuerIdentity(fakeConfig(iss))).toEqual({ issuer: iss, tenantId: TENANT_GUID });
  });

  it('tenantId = null för generisk IdP', () => {
    const iss = 'https://idp.example.se/realms/it';
    expect(getOidcIssuerIdentity(fakeConfig(iss))).toEqual({ issuer: iss, tenantId: null });
  });

  it('kastar när metadata saknar issuer', () => {
    expect(() => getOidcIssuerIdentity(fakeConfig(undefined))).toThrow();
  });

  // /consumers ger en KONKRET issuer (MSA-tenanten) — inte platshållarmallen —
  // och passerar därför både lås 1 och platshållarvakten.
  it.each([
    'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0',
    'https://login.windows.net/9188040D-6C67-4C5B-B112-36A304B66DAD/v2.0',
  ])('kastar för Microsofts konsument-tenant: %s', (iss) => {
    expect(() => getOidcIssuerIdentity(fakeConfig(iss))).toThrow(/konsument-tenant/);
  });

  it('kastar när upptäckt tenant-GUID inte är det konfigurerade', () => {
    setFullOidcEnv();
    const other = `https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0`;
    expect(() => getOidcIssuerIdentity(fakeConfig(other))).toThrow(/annan tenant/);
  });

  it('samma tenant i annat skiftläge är OK', () => {
    setFullOidcEnv();
    const upper = `https://login.microsoftonline.com/${TENANT_GUID.toUpperCase()}/v2.0`;
    expect(getOidcIssuerIdentity(fakeConfig(upper))).toMatchObject({ tenantId: TENANT_GUID.toUpperCase() });
  });

  it('konfigurerad domännamnsform jämförs INTE mot upptäckt GUID (går inte att översätta)', () => {
    setFullOidcEnv();
    process.env.OIDC_ISSUER_URL = 'https://login.microsoftonline.com/prefabmastarna.se/v2.0';
    expect(getOidcIssuerIdentity(fakeConfig(ISSUER))).toEqual({ issuer: ISSUER, tenantId: TENANT_GUID });
  });
});

describe('getOidcProviderHint', () => {
  it("'microsoft' för login.microsoftonline.com", () => {
    expect(getOidcProviderHint(ISSUER)).toBe('microsoft');
  });

  it("'microsoft' för en annan värd i Entra-familjen (login.windows.net)", () => {
    expect(getOidcProviderHint(`https://login.windows.net/${TENANT_GUID}/v2.0`)).toBe('microsoft');
  });

  it('null för en generisk IdP', () => {
    expect(getOidcProviderHint('https://keycloak.example.se/realms/it')).toBeNull();
  });

  it('null för en ogiltig issuer-URL (kastar inte)', () => {
    expect(getOidcProviderHint('inte-en-url')).toBeNull();
  });
});

describe('verifyOidcClaims', () => {
  it('iss som inte är exakt lika → issuer_mismatch', () => {
    expect(
      verifyOidcClaims({ iss: 'https://login.microsoftonline.com/annan-tenant/v2.0', tid: TENANT_GUID }, entraIdentity)
    ).toBe('issuer_mismatch');
  });

  it('rätt iss men annan tid → tenant_mismatch', () => {
    expect(verifyOidcClaims({ iss: ISSUER, tid: '99999999-2222-3333-4444-555555555555' }, entraIdentity))
      .toBe('tenant_mismatch');
  });

  it('rätt iss men tid saknas (Entra) → tenant_mismatch (fail-closed)', () => {
    expect(verifyOidcClaims({ iss: ISSUER }, entraIdentity)).toBe('tenant_mismatch');
  });

  it('tid av fel typ → tenant_mismatch', () => {
    expect(verifyOidcClaims({ iss: ISSUER, tid: { toLowerCase: () => TENANT_GUID } }, entraIdentity))
      .toBe('tenant_mismatch');
  });

  it('rätt iss + tid i annat skiftläge → OK', () => {
    expect(verifyOidcClaims({ iss: ISSUER, tid: TENANT_GUID.toUpperCase() }, entraIdentity)).toBeNull();
  });

  it('generisk IdP (tenantId null) utan tid → OK', () => {
    const identity = { issuer: 'https://idp.example.se/realms/it', tenantId: null };
    expect(verifyOidcClaims({ iss: identity.issuer }, identity)).toBeNull();
  });

  it('generisk IdP med fel iss → issuer_mismatch', () => {
    const identity = { issuer: 'https://idp.example.se/realms/it', tenantId: null };
    expect(verifyOidcClaims({ iss: 'https://ond.example/realms/it' }, identity)).toBe('issuer_mismatch');
  });
});

describe('findOrLinkOidcUser', () => {
  it('matchar på PARET (oidc_sub, oidc_iss)', () => {
    const id = seedUser('anna@x.se', 'sub-1', ISSUER);
    expect(findOrLinkOidcUser({ sub: 'sub-1' }, entraIdentity)).toEqual({
      ok: true, linked: false, user: { id, email: 'anna@x.se', role: 'user' },
    });
  });

  it('sub matchar men issuern är en ANNAN → ingen sub-träff (och ingen e-postträff) ', () => {
    seedUser('anna@x.se', 'sub-1', 'https://login.microsoftonline.com/annan/v2.0');
    // Ingen e-post i claims → faller igenom till no_email, alltså INTE en träff.
    expect(findOrLinkOidcUser({ sub: 'sub-1' }, entraIdentity)).toMatchObject({ ok: false, reason: 'no_email' });
  });

  it('e-postträff på rad länkad till samma sub men annan issuer → sub_conflict', () => {
    seedUser('anna@x.se', 'sub-1', 'https://login.microsoftonline.com/annan/v2.0');
    expect(findOrLinkOidcUser({ sub: 'sub-1', preferred_username: 'anna@x.se' }, entraIdentity))
      .toMatchObject({ ok: false, reason: 'sub_conflict', attemptedEmail: 'anna@x.se' });
  });

  it('UPN-matchning länkar sub + iss första gången (linked: true)', () => {
    const id = seedUser('Anna@X.se');
    const res = findOrLinkOidcUser({ sub: 'sub-9', preferred_username: 'anna@x.se' }, entraIdentity);
    expect(res).toEqual({ ok: true, linked: true, user: { id, email: 'Anna@X.se', role: 'user' } });
    expect(db.prepare('SELECT oidc_sub, oidc_iss FROM users WHERE id = ?').get(id))
      .toEqual({ oidc_sub: 'sub-9', oidc_iss: ISSUER });
  });

  it('Unicode-e-post matchas (SQLites lower() är ASCII-only, JS toLowerCase() är det inte)', () => {
    const id = seedUser('Åsa.Ö@Prefab.se');
    const res = findOrLinkOidcUser({ sub: 'sub-å', preferred_username: 'åsa.ö@prefab.se' }, entraIdentity);
    expect(res).toMatchObject({ ok: true, linked: true });
    expect(res).toMatchObject({ user: { id } });
  });

  it('rad lagrad i NFD matchas av en claim i NFC (och tvärtom)', () => {
    const nfd = 'Åsa.Ö@Prefab.se'.normalize('NFD');
    const nfc = 'åsa.ö@prefab.se'.normalize('NFC');
    // Förutsättning för att testet ska betyda något: strängarna är OLIKA i JS.
    expect(nfd.toLowerCase()).not.toBe(nfc);
    const id = seedUser(nfd);
    expect(findOrLinkOidcUser({ sub: 'sub-nfd', preferred_username: nfc }, entraIdentity))
      .toMatchObject({ ok: true, linked: true, user: { id } });

    db.prepare('DELETE FROM users').run();
    const id2 = seedUser('Åsa.Ö@Prefab.se'.normalize('NFC'));
    expect(findOrLinkOidcUser({ sub: 'sub-nfc', preferred_username: 'åsa.ö@prefab.se'.normalize('NFD') }, entraIdentity))
      .toMatchObject({ ok: true, linked: true, user: { id: id2 } });
  });

  it('två rader som bara skiljer i skiftläge → email_ambiguous (fail-closed)', () => {
    seedUser('bo@x.se');
    seedUser('BO@X.se');
    expect(findOrLinkOidcUser({ sub: 's', preferred_username: 'Bo@x.se' }, entraIdentity))
      .toMatchObject({ ok: false, reason: 'email_ambiguous' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE oidc_sub IS NOT NULL").get()).toMatchObject({ n: 0 });
  });

  // ── Identitetssemantik: EN kandidat, i förtroendeordning, utan fallback ─────
  it('preferred_username (UPN) VINNER över email-claimen', () => {
    const upnUser = seedUser('anstalld@prefab.se');
    seedUser('admin@prefab.se', null, null, 'admin');
    const res = findOrLinkOidcUser(
      {
        sub: 'sub-upn',
        preferred_username: 'anstalld@prefab.se',
        email: 'admin@prefab.se',
        email_verified: true,
      },
      entraIdentity
    );
    expect(res).toMatchObject({ ok: true, user: { id: upnUser, role: 'user' } });
  });

  it('OVERIFIERAD email som matchar ett admin-konto → avslag, ingen länkning (nOAuth)', () => {
    const adminId = seedUser('admin@prefab.se', null, null, 'admin');
    const res = findOrLinkOidcUser({ sub: 'sub-angripare', email: 'admin@prefab.se' }, entraIdentity);
    expect(res).toMatchObject({ ok: false, reason: 'no_email' });
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(adminId)).toMatchObject({ oidc_sub: null });
  });

  it('xms_edov: true + email → träff', () => {
    const id = seedUser('helge@x.se');
    expect(findOrLinkOidcUser({ sub: 'sub-h', email: 'helge@x.se', xms_edov: true }, entraIdentity))
      .toMatchObject({ ok: true, linked: true, user: { id } });
  });

  it('email_verified: true + email → träff', () => {
    const id = seedUser('ida@x.se');
    expect(findOrLinkOidcUser({ sub: 'sub-i', email: 'ida@x.se', email_verified: true }, entraIdentity))
      .toMatchObject({ ok: true, linked: true, user: { id } });
  });

  it('UPN utan träff + email som matchar → unknown_user (INGEN fallback till email)', () => {
    const adminId = seedUser('admin@prefab.se', null, null, 'admin');
    const res = findOrLinkOidcUser(
      {
        sub: 'sub-angripare',
        preferred_username: 'angripare@prefab.se',
        email: 'admin@prefab.se',
        email_verified: true, // även "verifierad" email får INTE rädda ett UPN-miss
        xms_edov: true,
      },
      entraIdentity
    );
    expect(res).toEqual({ ok: false, reason: 'unknown_user', attemptedEmail: 'angripare@prefab.se' });
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(adminId)).toMatchObject({ oidc_sub: null });
  });

  it.each([
    ['strängen "false"', 'false'],
    ['strängen "true" (fel typ räknas inte som bevis)', 'true'],
    ['talet 0', 0],
    ['talet 1', 1],
    ['null', null],
  ])('email_verified som %s räknas som OVERIFIERAD → no_email', (_label, value) => {
    seedUser('jan@x.se');
    expect(findOrLinkOidcUser({ sub: 'sub-j', email: 'jan@x.se', email_verified: value }, entraIdentity))
      .toMatchObject({ ok: false, reason: 'no_email' });
  });

  it('email_verified: false men redan länkad via (sub, iss) → sub-matchen vinner', () => {
    const id = seedUser('finn@x.se', 'sub-finn', ISSUER);
    expect(findOrLinkOidcUser({ sub: 'sub-finn', email: 'finn@x.se', email_verified: false }, entraIdentity))
      .toMatchObject({ ok: true, user: { id } });
  });

  it('preferred_username utan @ används inte som adress', () => {
    seedUser('kim@x.se');
    expect(findOrLinkOidcUser({ sub: 'sub-k', preferred_username: 'kim' }, entraIdentity))
      .toMatchObject({ ok: false, reason: 'no_email' });
  });

  // ── Gästspärr ──────────────────────────────────────────────────────────────
  it('gästkonto (#EXT# i preferred_username) → guest_account, ingen DB-skrivning', () => {
    const id = seedUser('extern@partner.se');
    const res = findOrLinkOidcUser(
      { sub: 'sub-g', email: 'extern@partner.se', preferred_username: 'extern_partner.se#EXT#@prefab.onmicrosoft.com' },
      entraIdentity
    );
    expect(res).toMatchObject({ ok: false, reason: 'guest_account' });
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(id)).toMatchObject({ oidc_sub: null });
  });

  it('gästkonto med #ext# i upn (annat skiftläge) → guest_account', () => {
    seedUser('extern@partner.se');
    expect(
      findOrLinkOidcUser({ sub: 'sub-g', email: 'extern@partner.se', upn: 'extern_partner.se#ext#@prefab.onmicrosoft.com' }, entraIdentity)
    ).toMatchObject({ ok: false, reason: 'guest_account' });
  });

  it('acct: 1 (Entras gäst-markör) → guest_account även utan #EXT# någonstans', () => {
    const id = seedUser('gast@partner.se');
    const res = findOrLinkOidcUser(
      { sub: 'sub-acct', preferred_username: 'gast@partner.se', acct: 1 },
      entraIdentity
    );
    expect(res).toMatchObject({ ok: false, reason: 'guest_account' });
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(id)).toMatchObject({ oidc_sub: null });
  });

  it("acct: '1' (strängform av gäst-markören) → guest_account, inte bara talet 1", () => {
    const id = seedUser('gast2@partner.se');
    const res = findOrLinkOidcUser(
      { sub: 'sub-acct-str', preferred_username: 'gast2@partner.se', acct: '1' },
      entraIdentity
    );
    expect(res).toMatchObject({ ok: false, reason: 'guest_account' });
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(id)).toMatchObject({ oidc_sub: null });
  });

  it('acct: 0 (medlem) släpps igenom', () => {
    const id = seedUser('medlem@prefab.se');
    expect(findOrLinkOidcUser({ sub: 'sub-m', preferred_username: 'medlem@prefab.se', acct: 0 }, entraIdentity))
      .toMatchObject({ ok: true, user: { id } });
  });

  it('gästspärren går FÖRE sub-matchning (en redan länkad gäst släpps inte in)', () => {
    seedUser('extern@partner.se', 'sub-g', ISSUER);
    expect(
      findOrLinkOidcUser({ sub: 'sub-g', preferred_username: 'extern_partner.se#EXT#@prefab.onmicrosoft.com' }, entraIdentity)
    ).toMatchObject({ ok: false, reason: 'guest_account' });
  });

  it('acct: 1 går FÖRE sub-matchning', () => {
    seedUser('gast@partner.se', 'sub-g2', ISSUER);
    expect(findOrLinkOidcUser({ sub: 'sub-g2', acct: 1 }, entraIdentity))
      .toMatchObject({ ok: false, reason: 'guest_account' });
  });

  // ── sub-guard ──────────────────────────────────────────────────────────────
  it.each([
    ['tom sträng', ''],
    ['bara blanksteg', '   '],
    ['ett tal', 12345],
    ['null', null],
    ['undefined', undefined],
  ])('sub som %s → invalid_sub, ingen länkning', (_label, sub) => {
    const id = seedUser('lena@x.se');
    expect(findOrLinkOidcUser({ sub, preferred_username: 'lena@x.se' }, entraIdentity))
      .toMatchObject({ ok: false, reason: 'invalid_sub' });
    expect(db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(id)).toMatchObject({ oidc_sub: null });
  });

  it('okänd användare → unknown_user, inget konto skapas (ingen JIT)', () => {
    expect(findOrLinkOidcUser({ sub: 's', preferred_username: 'ghost@x.se' }, entraIdentity))
      .toEqual({ ok: false, reason: 'unknown_user', attemptedEmail: 'ghost@x.se' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 0 });
  });

  it('claims utan användbar e-post → no_email', () => {
    seedUser('d@x.se');
    expect(findOrLinkOidcUser({ sub: 's', email: { evil: true }, email_verified: true }, entraIdentity))
      .toMatchObject({ reason: 'no_email' });
    expect(findOrLinkOidcUser({ sub: 's', email: 'inte-en-adress', email_verified: true }, entraIdentity))
      .toMatchObject({ reason: 'no_email' });
  });

  it('e-postträff på konto länkat till ANNAN sub → sub_conflict', () => {
    seedUser('c@x.se', 'sub-annan', ISSUER);
    expect(findOrLinkOidcUser({ sub: 'sub-ny', preferred_username: 'c@x.se' }, entraIdentity))
      .toMatchObject({ reason: 'sub_conflict' });
  });

  it('legacy-rad med oidc_sub men utan oidc_iss → sub_conflict (kan inte bevisas tillhöra issuern)', () => {
    seedUser('legacy@x.se', 'sub-legacy', null);
    expect(findOrLinkOidcUser({ sub: 'sub-legacy', preferred_username: 'legacy@x.se' }, entraIdentity))
      .toMatchObject({ ok: false, reason: 'sub_conflict' });
  });

  it('rollen läses ur DB-raden, aldrig ur claims', () => {
    const id = seedUser('adminwannabe@x.se');
    const res = findOrLinkOidcUser(
      { sub: 'sub-r', preferred_username: 'adminwannabe@x.se', role: 'admin', roles: ['admin'] } as never,
      entraIdentity
    );
    expect(res).toMatchObject({ ok: true, user: { id, role: 'user' } });
  });

  // ── Generisk OIDC-issuer (tenantId === null): ANNAN förtroendeordning ───────
  // Entra-motiveringen för preferred_username (domänverifierat UPN-suffix) är
  // Entra-specifik — en godtycklig IdP ger ingen sådan garanti. Där krävs
  // istället OIDC-specens egen email_verified. Se selectOidcEmailCandidate.
  describe('generisk OIDC-issuer (icke-Entra)', () => {
    const genericIdentity = { issuer: 'https://idp.example.se/realms/it', tenantId: null };

    it('preferred_username med "@" LITAS INTE PÅ (till skillnad från Entra) → no_email', () => {
      seedUser('anna@x.se');
      expect(
        findOrLinkOidcUser({ sub: 'sub-generic-1', preferred_username: 'anna@x.se' }, genericIdentity)
      ).toMatchObject({ ok: false, reason: 'no_email' });
    });

    it('email + email_verified: true → träff', () => {
      const id = seedUser('bo@x.se');
      expect(
        findOrLinkOidcUser({ sub: 'sub-generic-2', email: 'bo@x.se', email_verified: true }, genericIdentity)
      ).toMatchObject({ ok: true, linked: true, user: { id } });
    });

    it('email UTAN email_verified → no_email (ingen fallback, ingen Entra-specifik xms_edov-väg)', () => {
      seedUser('cia@x.se');
      expect(
        findOrLinkOidcUser({ sub: 'sub-generic-3', email: 'cia@x.se' }, genericIdentity)
      ).toMatchObject({ ok: false, reason: 'no_email' });
    });

    it('xms_edov: true räknas INTE som bevis för en generisk IdP (den claimen är Microsofts egen)', () => {
      seedUser('dana@x.se');
      expect(
        findOrLinkOidcUser({ sub: 'sub-generic-4', email: 'dana@x.se', xms_edov: true }, genericIdentity)
      ).toMatchObject({ ok: false, reason: 'no_email' });
    });

    it('preferred_username + verifierad email samtidigt → email vinner (UPN har ingen särställning här)', () => {
      const adminId = seedUser('admin@prefab.se', null, null, 'admin');
      seedUser('angripare@prefab.se');
      const res = findOrLinkOidcUser(
        {
          sub: 'sub-generic-5',
          preferred_username: 'angripare@prefab.se',
          email: 'admin@prefab.se',
          email_verified: true,
        },
        genericIdentity
      );
      // Ingen JIT/felaktig länkning — träffen matchar det VERIFIERADE admin-kontot,
      // exakt den identitet claims bevisar (till skillnad från Entra-fallet, där
      // ett UPN-miss aldrig faller tillbaka till email — här finns inget UPN
      // som "vinner" över email, för i det här läget är email det enda som
      // någonsin övervägs).
      expect(res).toMatchObject({ ok: true, user: { id: adminId } });
    });

    it('samma (sub, iss) matchar tillbaka → sub-vägen är oberoende av Entra/generisk-grenen', () => {
      const id = seedUser('erik@x.se', 'sub-generic-6', genericIdentity.issuer);
      expect(findOrLinkOidcUser({ sub: 'sub-generic-6' }, genericIdentity)).toEqual({
        ok: true, linked: false, user: { id, email: 'erik@x.se', role: 'user' },
      });
    });
  });
});
