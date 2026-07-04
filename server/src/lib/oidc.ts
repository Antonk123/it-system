import * as client from 'openid-client';
import { db } from '../db/connection.js';

export interface OidcSettings {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  buttonLabel: string;
}

// Läses per anrop (ingen modul-cache av env) så tester kan mutera process.env.
export function getOidcSettings(): OidcSettings | null {
  const issuerUrl = process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const redirectUri = process.env.OIDC_REDIRECT_URI;
  if (!issuerUrl || !clientId || !clientSecret || !redirectUri) return null;
  return {
    issuerUrl,
    clientId,
    clientSecret,
    redirectUri,
    buttonLabel: process.env.OIDC_BUTTON_LABEL || 'Logga in med SSO',
  };
}

export function isOidcEnabled(): boolean {
  return getOidcSettings() !== null;
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

export function resetOidcCache(): void {
  cachedConfig = null;
}

export interface OidcMatchedUser {
  id: string;
  email: string;
  role: string;
}

// Matchning i två steg: (1) oidc_sub, (2) e-post (lowercase; email-claim med
// fallback preferred_username) → länka sub vid första träffen. Okänd → null
// (ingen JIT-provisionering). Konto redan länkat till annan sub → null.
export function findOrLinkOidcUser(
  claims: { sub: string; email?: unknown; preferred_username?: unknown }
): OidcMatchedUser | null {
  const bySub = db
    .prepare('SELECT id, email, role FROM users WHERE oidc_sub = ?')
    .get(claims.sub) as OidcMatchedUser | undefined;
  if (bySub) return bySub;

  const rawEmail =
    typeof claims.email === 'string' && claims.email
      ? claims.email
      : typeof claims.preferred_username === 'string'
        ? claims.preferred_username
        : '';
  if (!rawEmail.includes('@')) return null;
  const email = rawEmail.toLowerCase();

  const byEmail = db
    .prepare('SELECT id, email, role, oidc_sub FROM users WHERE lower(email) = ?')
    .get(email) as (OidcMatchedUser & { oidc_sub: string | null }) | undefined;
  if (!byEmail) return null;
  if (byEmail.oidc_sub && byEmail.oidc_sub !== claims.sub) return null;
  if (!byEmail.oidc_sub) {
    db.prepare('UPDATE users SET oidc_sub = ? WHERE id = ?').run(claims.sub, byEmail.id);
  }
  return { id: byEmail.id, email: byEmail.email, role: byEmail.role };
}
