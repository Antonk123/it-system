import * as client from 'openid-client';
import { db } from '../db/connection.js';
import { logger } from './logger.js';

export interface OidcSettings {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  buttonLabel: string;
}

export type OidcConfigStatus =
  | { state: 'off'; missing: string[] }
  | { state: 'invalid'; reason: string }
  | { state: 'on'; settings: OidcSettings };

// Entras inloggningsvärdar — HELA familjen, inte bara den globala molnvärden.
// VARFÖR: alla nedanstående namnrymdar tenants i första path-segmentet och
// serverar samma multitenant-endpoints (/common, /organizations, /consumers).
// Kollar vi bara login.microsoftonline.com räcker det att konfigurera
// login.windows.net/common för att gå runt hela lås 1.
const ENTRA_HOSTS = new Set([
  'login.microsoftonline.com',
  'login.microsoftonline.us',
  'login.microsoftonline.de',
  'login.partner.microsoftonline.cn',
  'login.windows.net',
  // login.microsoft.com är ett alias/kortnamn för login.microsoftonline.com —
  // samma multitenant-endpoints (/common, /organizations, /consumers), samma
  // risk. Utan den här raden går lås 1 (env-kontrollen) att kringgå genom att
  // bara skriva den kortare värden i OIDC_ISSUER_URL — DNS löser den till
  // samma tjänst. Se KRAV B, lås 1 av 2.
  'login.microsoft.com',
]);
const ENTRA_V1_HOST = 'sts.windows.net';

// Entras multitenant-endpoints. VARFÖR de måste blockeras i kod och inte bara i
// dokumentationen: openid-client 6.x har ett Entra-specialfall
// (build/index.js: `clone[_expectedIssuer] = ({ claims: { tid } }) =>
// server.issuer.replace('{tenantid}', tid)`). Discovery mot /common,
// /organizations eller /consumers svarar med en issuer som innehåller
// platshållaren "{tenantid}", och då blir bibliotekets iss-kontroll
// SJÄLVREFERERANDE — id_tokenet pekar via sin egen tid-claim ut vilket issuer
// det ska jämföras med, så VILKEN Entra-tenant som helst validerar.
// Med en tenant-specifik issuer (GUID- ELLER domännamnsform) saknas
// platshållaren, .replace() blir en no-op och jämförelsen är en äkta literal
// strängjämförelse. Därför förbjuds endast multitenant-endpointsen — inte
// domännamnsform och inte avslutande snedstreck. (KRAV B, lås 1 av 2.)
const ENTRA_MULTITENANT_SEGMENTS = new Set(['common', 'organizations', 'consumers']);

// Microsofts fasta "tenant" för personliga Microsoft-konton (MSA). VARFÖR den
// måste avvisas separat: /consumers svarar INTE med platshållarmallen utan med
// en KONKRET issuer för den här GUID:en. Den passerar därför både lås 1
// (path-segmentet i env är inte "consumers" om man skrivit GUID:en direkt) och
// platshållarvakten i lås 2 — men släpper in hela världens privatkonton, vilket
// är raka motsatsen till KRAV B.
const MSA_CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stripper ETT avslutande "." — 'login.microsoftonline.com.' (ett fullt
// kvalificerat FQDN, giltig DNS-syntax) löser till EXAKT samma host som utan
// punkten, men som RÅ STRÄNG är den inte med i ENTRA_HOSTS → utan stripp
// kringgår den både lås 1 och (eftersom samma funktion används där) lås 2.
function isEntraHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const stripped = normalized.endsWith('.') ? normalized.slice(0, -1) : normalized;
  return ENTRA_HOSTS.has(stripped);
}

// VARFÖR decodeURIComponent: URL normaliserar INTE procentkodning i pathen.
// new URL('https://login.microsoftonline.com/%63ommon/v2.0').pathname är
// '/%63ommon/v2.0' — utan avkodning smiter "common" förbi blocklistan medan
// Entra självt tolkar det som /common.
function firstPathSegment(url: URL): string | null {
  const raw = url.pathname.split('/').filter(Boolean)[0];
  if (raw === undefined) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    // Trasig procentkodning (t.ex. "%zz") — använd rådata; det kan ändå inte
    // motsvara ett giltigt tenant-segment, och vi vill inte kasta här.
    return raw;
  }
}

// Returnerar en läsbar orsak om issuer-URL:en inte duger, annars null.
function issuerUrlRejection(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `OIDC_ISSUER_URL är ingen giltig URL: "${raw}"`;
  }
  if (url.protocol !== 'https:') {
    // id_token hämtas över samma kanal; utan TLS finns inget att lita på.
    return `OIDC_ISSUER_URL måste använda https (fick "${url.protocol}//")`;
  }
  // hostname (inte host) → en avvikande port kan inte användas för att smita
  // förbi värdnamnskontrollerna nedan.
  if (url.hostname === ENTRA_V1_HOST) {
    return `OIDC_ISSUER_URL pekar på Entra v1.0 (${ENTRA_V1_HOST}) — v2.0-endpointen krävs`;
  }
  if (isEntraHost(url.hostname)) {
    const segment = firstPathSegment(url)?.toLowerCase();
    if (segment && ENTRA_MULTITENANT_SEGMENTS.has(segment)) {
      return `OIDC_ISSUER_URL pekar på Entras multitenant-endpoint "/${segment}" — ange tenantens egen endpoint (GUID eller domännamn), annars kan vilken Entra-tenant som helst logga in`;
    }
  }
  return null;
}

// Exporteras så att boot-loggen kan skilja "helt osatt" (alla saknas) från
// halvvägs-konfiguration utan att hårdkoda antalet.
export const OIDC_REQUIRED_ENV = [
  'OIDC_ISSUER_URL',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI',
] as const;

// Loggnycklar för senast rapporterade diagnos. getOidcConfigStatus anropas per
// request — utan de här skulle en felstavad env spamma loggen vid varje anrop.
let lastLoggedInvalidReason: string | null = null;
let lastLoggedMissingKeys: string | null = null;

export function getOidcConfigStatus(): OidcConfigStatus {
  const missing = OIDC_REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    lastLoggedInvalidReason = null;
    // Halvvägs-konfiguration är annars odiagnostiserbar: SSO är av, men allt ser
    // ut som "medvetet avstängt". Logga NYCKLARNA (aldrig värdena — en av dem är
    // client secret). Bara när något ÄR satt; helt tom config är det normala.
    if (missing.length < OIDC_REQUIRED_ENV.length) {
      const dedupeKey = missing.join(',');
      if (lastLoggedMissingKeys !== dedupeKey) {
        logger.warn(
          'OIDC är bara delvis konfigurerat — SSO är AV tills alla fyra variabler är satta',
          { missing }
        );
        lastLoggedMissingKeys = dedupeKey;
      }
    } else {
      lastLoggedMissingKeys = null;
    }
    return { state: 'off', missing };
  }
  lastLoggedMissingKeys = null;

  const issuerUrl = process.env.OIDC_ISSUER_URL as string;
  const clientId = process.env.OIDC_CLIENT_ID as string;
  const clientSecret = process.env.OIDC_CLIENT_SECRET as string;
  const redirectUri = process.env.OIDC_REDIRECT_URI as string;

  const reason = issuerUrlRejection(issuerUrl);
  if (reason) {
    // Fail-closed men fail-SOFT: SSO är en valfri funktion, så vi dödar aldrig
    // processen (till skillnad från JWT_SECRET/CSRF_SECRET). Men utan en tydlig
    // logg är en felstavad env omöjlig att skilja från "medvetet avstängt".
    // ÄGARSKAP: den här funktionen är ENDA stället som loggar avvisad config —
    // den anropas både vid boot (index.ts) och per request, och dedupar. Loggar
    // index.ts en egen rad blir varje omstart en dubblett av exakt samma orsak.
    if (lastLoggedInvalidReason !== reason) {
      logger.error('OIDC-konfigurationen avvisades — SSO är avstängt', { reason });
      lastLoggedInvalidReason = reason;
    }
    return { state: 'invalid', reason };
  }

  lastLoggedInvalidReason = null;
  return {
    state: 'on',
    settings: {
      issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      buttonLabel: process.env.OIDC_BUTTON_LABEL || 'Logga in med SSO',
    },
  };
}

// Sätts av boot-proben när discovery LYCKADES men svarade med en issuer vi inte
// kan lita på. Då är konfigurationen syntaktiskt korrekt (env-låset ser inget
// fel) men praktiskt oanvändbar → hela SSO ska bete sig som avstängt.
let discoveryRejectionReason: string | null = null;

// Läses per anrop (ingen modul-cache av env) så tester kan mutera process.env.
// Returnerar settings ENDAST när konfigurationen är giltig — en avvisad config
// ska bete sig exakt som "SSO av" mot resten av appen.
export function getOidcSettings(): OidcSettings | null {
  if (discoveryRejectionReason !== null) return null;
  const status = getOidcConfigStatus();
  return status.state === 'on' ? status.settings : null;
}

// Discovery cachas efter första LYCKADE anropet (lazy). Fel cachas inte —
// nästa request gör om discovery, så en IdP-hicka självläker utan omstart.
let cachedConfig: client.Configuration | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
  const settings = getOidcSettings();
  if (!settings) throw new Error('OIDC is not configured');
  if (cachedConfig) return cachedConfig;
  cachedConfig = await client.discovery(
    new URL(settings.issuerUrl),
    settings.clientId,
    settings.clientSecret
  );
  return cachedConfig;
}

// Exporteras separat för tester som bara vill nollställa avstängningsflaggan.
export function resetOidcDiscoveryRejection(): void {
  discoveryRejectionReason = null;
}

export function resetOidcCache(): void {
  cachedConfig = null;
  // Måste ingå: annars läcker en avstängning från ett test in i nästa (och i
  // prod skulle en manuell cache-reset inte kunna häva en felaktig avstängning).
  resetOidcDiscoveryRejection();
}

export interface OidcIssuerIdentity {
  issuer: string;
  tenantId: string | null;
}

// KRAV B, lås 2 av 2: env-kontrollen ovan tittar på det vi KONFIGURERADE, den
// här på det IdP:n faktiskt SVARADE med. En upptäckt issuer som innehåller "{"
// är en platshållarmall ("…/{tenantid}/v2.0") — då är openid-clients
// iss-kontroll självrefererande och alla tenants validerar. Vägra hårt hellre
// än att köra vidare på en obrukbar jämförelse.
export function getOidcIssuerIdentity(config: client.Configuration): OidcIssuerIdentity {
  const issuer = config.serverMetadata().issuer;
  if (!issuer || typeof issuer !== 'string') {
    throw new Error('OIDC discovery saknar issuer i metadata');
  }
  if (issuer.includes('{')) {
    throw new Error(
      `OIDC-issuer från discovery är en platshållarmall ("${issuer}") — multitenant-endpoint upptäckt, avbryter`
    );
  }
  let tenantId: string | null = null;
  try {
    const url = new URL(issuer);
    // Bara Entra namnrymdar tenants i issuer-pathen. För en generisk IdP finns
    // ingen tid-claim att kontrollera → null (se verifyOidcClaims).
    if (isEntraHost(url.hostname)) tenantId = firstPathSegment(url);
  } catch {
    // Icke-URL-issuer: literal iss-jämförelse räcker, ingen tenant att låsa mot.
  }

  if (tenantId && tenantId.toLowerCase() === MSA_CONSUMER_TENANT_ID) {
    throw new Error(
      `OIDC-issuer pekar på Microsofts konsument-tenant (${MSA_CONSUMER_TENANT_ID}) — vilket personligt Microsoft-konto som helst skulle kunna logga in, avbryter`
    );
  }

  // Extra lås: den UPPTÄCKTA tenanten måste vara den vi KONFIGURERADE. Fångar
  // att discovery pekats om (DNS/proxy/felkonfigurerad well-known) till en annan
  // tenant än den admin skrev in.
  let configuredSegment: string | null = null;
  try {
    const configuredUrl = new URL(process.env.OIDC_ISSUER_URL ?? '');
    if (isEntraHost(configuredUrl.hostname)) configuredSegment = firstPathSegment(configuredUrl);
  } catch {
    // Ogiltig/osatt env — issuerUrlRejection äger den diagnosen, inte vi.
  }
  // VARFÖR bara GUID-form jämförs: konfigurerar man domännamnsform
  // (…/prefabmastarna.se/v2.0) svarar Entra ALLTID med GUID-form i issuern. En
  // strängjämförelse skulle då alltid falla trots att det är samma tenant, och
  // det finns inget sätt att översätta domän→GUID utan ett extra nätverksanrop.
  // Hoppa då över just den här kontrollen — tid-låset i verifyOidcClaims gäller
  // fortfarande mot den upptäckta issuern.
  if (
    tenantId &&
    configuredSegment &&
    GUID_RE.test(configuredSegment) &&
    configuredSegment.toLowerCase() !== tenantId.toLowerCase()
  ) {
    throw new Error(
      `OIDC-issuer från discovery tillhör en annan tenant än OIDC_ISSUER_URL (upptäckt "${tenantId}", konfigurerad "${configuredSegment}") — avbryter`
    );
  }

  return { issuer, tenantId };
}

// Boot-probe: kör discovery EN gång vid start så att en config som bara kan
// underkännas av lås 2 upptäcks direkt istället för vid första inloggningen
// (fram tills dess påstår både boot-loggen och GET /oidc/enabled att SSO är på).
// Icke-fatal och fire-and-forget: får ALDRIG kasta eller blockera app.listen().
export async function probeOidcAtBoot(): Promise<void> {
  const settings = getOidcSettings();
  if (!settings) return;
  let config: client.Configuration;
  try {
    config = await getOidcConfig();
  } catch (error) {
    // NÄTVERKSFEL (IdP nere, DNS-hicka vid uppstart) → bara en varning. Att
    // stänga av SSO permanent på en övergående hicka vore värre än problemet;
    // discovery görs om vid nästa request eftersom fel inte cachas.
    logger.warn('OIDC discovery kunde inte nås vid start — SSO lämnas PÅ och försöks igen vid första inloggningen', {
      error: String(error),
    });
    return;
  }
  try {
    getOidcIssuerIdentity(config);
  } catch (error) {
    // Discovery SVARADE men issuern går inte att lita på → detta självläker inte,
    // stäng av SSO tills konfigurationen rättas och processen startas om.
    discoveryRejectionReason = error instanceof Error ? error.message : String(error);
    logger.error('SSO (OIDC) stängs AV: discovery lyckades men issuern kan inte litas på', {
      reason: discoveryRejectionReason,
    });
  }
}

export type OidcRejectReason =
  | 'issuer_mismatch'
  | 'tenant_mismatch'
  | 'guest_account'
  | 'invalid_sub'
  | 'no_email'
  | 'unknown_user'
  | 'sub_conflict'
  | 'email_ambiguous';

// VÅR EGEN iss-kontroll. Anledningen att den inte är överflödig: openid-client
// ersätter för Entra det förväntade issuer-värdet med en funktion av tokenets
// egen tid-claim (se kommentaren vid ENTRA_MULTITENANT_SEGMENTS). Här jämför vi
// literalt mot den issuer discovery gav oss, och därefter tid mot tenanten i den
// issuern — så att exakt EN tenant kan autentisera. (KRAV B.)
export function verifyOidcClaims(
  claims: Record<string, unknown>,
  identity: OidcIssuerIdentity
): OidcRejectReason | null {
  if (claims.iss !== identity.issuer) return 'issuer_mismatch';
  if (identity.tenantId !== null) {
    const tid = claims.tid;
    // Saknad tid på en Entra-issuer = avslag (fail-closed): utan tid går det
    // inte att bevisa vilken tenant tokenet kommer från.
    if (typeof tid !== 'string' || tid.toLowerCase() !== identity.tenantId.toLowerCase()) {
      return 'tenant_mismatch';
    }
  }
  return null;
}

export interface OidcMatchedUser {
  id: string;
  email: string;
  role: string;
}

export type OidcMatchResult =
  | { ok: true; user: OidcMatchedUser; linked: boolean }
  | { ok: false; reason: OidcRejectReason; attemptedEmail: string | null };

export interface OidcUserClaims {
  sub: unknown;
  email?: unknown;
  email_verified?: unknown;
  xms_edov?: unknown;
  preferred_username?: unknown;
  upn?: unknown;
  acct?: unknown;
}

// Är email-claimen POSITIVT bevisad verifierad? Bara boolean true duger.
// VARFÖR strikt ===: strängen 'false' och talet 0 är truthy respektive faller
// utanför en `!== false`-kontroll, så varje form av "lös" tolkning slutar med
// att overifierade adresser räknas som verifierade. Även strängen 'true' räknas
// som overifierad — vi gissar inte om typen, vi kräver rätt typ.
function emailClaimIsVerified(claims: OidcUserClaims): boolean {
  // xms_edov = Microsofts "email domain owner verified". Sätts av Entra självt
  // och är deras egen motåtgärd mot nOAuth.
  return claims.xms_edov === true || claims.email_verified === true;
}

// Väljer EN adress att matcha mot users.email — i förtroendeordning, UTAN
// fallback om den valda inte hittar något konto (se findOrLinkOidcUser).
// Ordningen skiljer sig mellan Entra och en generisk OIDC-issuer — se de två
// grenarna nedan för varför.
//
// ENTRA (isEntra = true):
// 1. preferred_username när den innehåller '@': det är UPN:en. Entra kräver att
//    UPN-suffixet är en verifierad domän i tenanten, och användaren kan inte
//    ändra sin egen UPN.
// 2. annars email — men BARA med positivt verifieringsbevis (xms_edov ELLER
//    email_verified). email-claimen kan komma från otherMails, som användaren
//    själv kan sätta via self-service-registrering. Det är nOAuth-klassen: en
//    medlem i tenanten sätter sin alternativa e-post till en admins adress och
//    länkar sig till admin-kontot.
//
// GENERISK OIDC (isEntra = false):
// 1. email — men BARA med email_verified === true.
// VARFÖR preferred_username INTE litas på här: motiveringen ovan (punkt 1 för
// Entra) är Entra-specifik — Entra garanterar att UPN-suffixet är en
// domänverifierad del av tenanten. Det löftet finns INTE i OIDC-specen för en
// godtycklig IdP; "preferred_username" där är per spec "not guaranteed to be
// unique and NOT to be used for security purposes" (OIDC Core 5.1). VARFÖR
// INTE xms_edov för generisk IdP: det är Microsofts egen claim, en generisk
// IdP sätter den aldrig — vi kräver istället det verifieringsbevis OIDC-specen
// faktiskt definierar för alla IdP:er, email_verified.
function selectOidcEmailCandidate(claims: OidcUserClaims, isEntra: boolean): string | null {
  if (isEntra) {
    const upn = claims.preferred_username;
    if (typeof upn === 'string' && upn.includes('@')) return upn;
    const email = claims.email;
    if (typeof email === 'string' && email.includes('@') && emailClaimIsVerified(claims)) return email;
    return null;
  }
  const email = claims.email;
  if (typeof email === 'string' && email.includes('@') && claims.email_verified === true) return email;
  return null;
}

// Matchning i två steg: (1) paret (oidc_sub, oidc_iss), (2) e-post → länka
// identiteten vid första träffen. Okänd identitet → avslag (ingen
// JIT-provisionering; KRAV A). Rollen läses ALLTID ur DB-raden, aldrig ur
// claims — IdP:n får inte kunna dela ut admin.
//
// Tar emot HELA identity (inte bara issuer-strängen): selectOidcEmailCandidate
// behöver veta om issuern är Entra (identity.tenantId !== null) för att välja
// rätt förtroendeordning — se kommentaren där. Anropsstället (routes/auth.ts)
// har redan identity från getOidcIssuerIdentity, så inget extra nätverksanrop.
export function findOrLinkOidcUser(claims: OidcUserClaims, identity: OidcIssuerIdentity): OidcMatchResult {
  const issuer = identity.issuer;
  const attemptedEmail = selectOidcEmailCandidate(claims, identity.tenantId !== null);

  // Gästspärr: B2B-gäster ligger i VÅR tenant, så de passerar både iss- och
  // tid-kontrollen. Deras e-post är extern och domänverifieras aldrig vid
  // inbjudan — vem som helst som blivit inbjuden en gång skulle annars kunna
  // matcha ett internt konto på e-post. Entra märker gästers UPN med "#EXT#"
  // och sätter acct=1 (0 = medlem i tenanten, 1 = gäst).
  // ÄRLIG BEGRÄNSNING: både upn och acct är OPTIONAL claims — levererar inte
  // tenantens appregistrering dem, och saknar preferred_username "#EXT#"
  // (vanligt, den speglar ofta gästens ursprungliga adress), biter den här
  // kontrollen inte alls. HUVUDSPÄRREN är därför att kontot måste finnas i
  // users-tabellen (ingen JIT) plus "assignment required" på appen i Entra.
  const guestMarkers = [claims.preferred_username, claims.upn, claims.email];
  if (guestMarkers.some((v) => typeof v === 'string' && v.toLowerCase().includes('#ext#'))) {
    return { ok: false, reason: 'guest_account', attemptedEmail };
  }
  // acct kan komma som talet 1 ELLER strängen '1' beroende på IdP/claims-
  // serialisering — en strikt `=== 1` skulle bara fånga den ena formen och
  // släppa igenom gäster vars acct råkar landa som sträng.
  if (claims.acct === 1 || claims.acct === '1') {
    return { ok: false, reason: 'guest_account', attemptedEmail };
  }

  // Egen sub-guard (routen kollar bara truthiness): en tom sträng skulle länkas
  // som identitet, och ett tal skulle skrivas ner av SQLite som "12345.0" —
  // båda ger en identitet som inte går att matcha tillbaka igen.
  const sub = claims.sub;
  if (typeof sub !== 'string' || sub.trim() === '') {
    return { ok: false, reason: 'invalid_sub', attemptedEmail };
  }

  // sub matchas ALDRIG ensamt: sub är bara unikt inom en issuer, så paret
  // (sub, iss) är den enda identiteten som betyder något.
  const bySub = db
    .prepare('SELECT id, email, role FROM users WHERE oidc_sub = ? AND oidc_iss = ?')
    .get(sub, issuer) as OidcMatchedUser | undefined;
  if (bySub) return { ok: true, user: bySub, linked: false };

  if (attemptedEmail === null) return { ok: false, reason: 'no_email', attemptedEmail: null };

  // VARFÖR inte `WHERE lower(email) = ?`: SQLites lower() är ASCII-only medan
  // JS toLowerCase() är Unicode-medveten. 'Åsa.Ö@x.se' blir 'Åsa.Ö@x.se' i
  // SQLite men 'åsa.ö@x.se' i JS → en användare med diakriter i adressen
  // matchas ALDRIG. Läs kandidatraderna och jämför i JS istället. Tabellen är
  // liten (en instans per deployment, användare i tiotal/hundratal).
  // NFC på BÅDA sidor: 'ö' kan lagras som ett tecken (NFC) eller som 'o' + ett
  // kombinerande tremaljud (NFD). De är olika strängar för JS men samma adress.
  // Vi lovar alltså: skiftlägesokänslig jämförelse av NFC-normaliserad text —
  // inte full e-postadress-ekvivalens (t.ex. plus-adressering skiljer sig).
  const needle = normalizeEmail(attemptedEmail);
  const candidates = db
    .prepare('SELECT id, email, role, oidc_sub, oidc_iss FROM users')
    .all() as (OidcMatchedUser & { oidc_sub: string | null; oidc_iss: string | null })[];
  const matches = candidates.filter((u) => normalizeEmail(u.email) === needle);

  // INGEN FALLBACK till en annan claim här: hittade den valda adressen inget
  // konto är svaret unknown_user. Skulle vi prova email-claimen när UPN:en
  // missar återöppnas nOAuth-hålet — angriparens UPN matchar inget, men deras
  // självsatta email-claim matchar en admin.
  if (matches.length === 0) return { ok: false, reason: 'unknown_user', attemptedEmail };
  // Flera rader som bara skiljer sig i skiftläge: vi kan inte veta vilken som
  // avses → fail-closed istället för att gissa.
  if (matches.length > 1) return { ok: false, reason: 'email_ambiguous', attemptedEmail };

  const row = matches[0];
  if (row.oidc_sub !== null) {
    // Redan länkad — till samma identitet? (oidc_iss NULL = länkning från före
    // migration 068, kan inte bevisas tillhöra den här issuern → avslag.)
    if (row.oidc_sub === sub && row.oidc_iss === issuer) {
      return { ok: true, user: { id: row.id, email: row.email, role: row.role }, linked: false };
    }
    return { ok: false, reason: 'sub_conflict', attemptedEmail };
  }

  db.prepare('UPDATE users SET oidc_sub = ?, oidc_iss = ? WHERE id = ?').run(sub, issuer, row.id);
  return { ok: true, user: { id: row.id, email: row.email, role: row.role }, linked: true };
}

// Exporterad: routes/users.ts POST /api/users behöver EXAKT samma normalisering
// för sin dubblettkontroll — annars kan två rader som bara skiljer i
// NFC-/NFD-form av samma adress skapas, vilket findOrLinkOidcUser (som normaliserar
// här) sedan ser som en enda adress med två träffar → permanent 'email_ambiguous'
// för det kontot.
export function normalizeEmail(value: string): string {
  return value.normalize('NFC').toLowerCase();
}
