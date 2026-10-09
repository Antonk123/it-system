import { request, type FullConfig } from '@playwright/test';
import { E2E_ADMIN, E2E_CONTACT } from './constants';

// Ett ärende kräver en beställare (kontakt). Skapa den en gång via API:t
// (CSRF-token + inloggning) innan testerna startar.
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const ctx = await request.newContext({ baseURL });
  try {
    const csrf = await ctx.get('/api/csrf-token');
    const { csrfToken } = await csrf.json();
    const login = await ctx.post('/api/auth/login', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: E2E_ADMIN,
    });
    if (!login.ok()) {
      throw new Error(
        `E2E-inloggning misslyckades (${login.status()}). Kör någon annan backend på :3001 än den sviten startar? Stoppa den eller sätt CI=1.`,
      );
    }
    const { accessToken } = await login.json();
    const auth = { Authorization: `Bearer ${accessToken}` };
    // CSRF-token är bundet till sessionen → hämta ett nytt efter inloggning.
    const csrf2 = await ctx.get('/api/csrf-token', { headers: auth });
    const res = await ctx.post('/api/contacts', {
      headers: { ...auth, 'X-CSRF-Token': (await csrf2.json()).csrfToken },
      data: E2E_CONTACT,
    });
    if (!res.ok() && res.status() !== 409) {
      throw new Error(`Kunde inte skapa e2e-kontakt: ${res.status()} ${await res.text()}`);
    }
  } finally {
    await ctx.dispose();
  }
}
