// @vitest-environment jsdom
/**
 * Tester för API-klienten (src/lib/api.ts).
 *
 * Fokus (audit-v3 MEDIUM — api.ts saknade tester):
 *  1. Muterande request (POST/PUT/DELETE) hämtar CSRF-token och sätter X-CSRF-Token-headern.
 *  2. 401 → /auth/refresh → RETRY av originalanropet en gång; svar från retryn returneras.
 *  3. Refresh misslyckas (401) → auth/localStorage rensas, redirect till /login, ingen oändlig loop.
 *  4. Felpropagering: icke-ok-svar kastar Error; vid body utan JSON innehåller meddelandet statuskoden.
 *
 * msw är INTE installerat → vi stubbar global.fetch manuellt med vi.fn().
 * jsdom-miljön ger oss window/localStorage; window.location stubbas så redirect inte kraschar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hjälpare
// ---------------------------------------------------------------------------

const BASE = '/api'; // import.meta.env.VITE_API_URL saknas i testkörning → fallback '/api'

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  contentType?: string | null;
  text?: () => Promise<string>;
}

// Bygger ett minimalt Response-likt objekt som matchar det api.request() faktiskt rör:
// .ok, .status, .json(), .text(), .headers.get('content-type').
function fakeResponse(init: FakeResponseInit) {
  const status = init.status ?? (init.ok === false ? 400 : 200);
  const ok = init.ok ?? (status >= 200 && status < 300);
  const contentType = init.contentType === undefined ? 'application/json' : init.contentType;
  return {
    ok,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    json: init.json ?? (() => Promise.resolve({})),
    text: init.text ?? (() => Promise.resolve('')),
  };
}

// Returnerar headers-objektet som skickades med ett visst fetch-anrop.
function headersOfCall(call: unknown[] | undefined): Record<string, string> {
  return ((call?.[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;
}

// Returnerar URL:en för ett visst fetch-anrop.
function urlOfCall(call: unknown[] | undefined): string {
  return String(call?.[0]);
}

// jsdom:s location går inte att skriva till direkt (navigation not implemented).
// Vi ersätter den med ett vanligt objekt så att `window.location.href = ...` bara
// uppdaterar en sträng och inte kastar.
function stubLocation() {
  const loc = { href: '' };
  Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true });
  return loc;
}

// ---------------------------------------------------------------------------
// Setup — färsk fetch-mock + tom localStorage per test, färsk modul-instans.
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

// jsdom 25 levererar inte alltid localStorage utan storage-konfig → stubba en enkel
// in-memory-variant (samma mönster som secureFileAccess.test.ts).
function stubLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules(); // ny ApiClient-singleton (nollställd csrf-cache) per test
  vi.clearAllMocks();
});

// Importera en färsk `api`-singleton (modul-cachen nollställs i afterEach).
async function freshApi() {
  const mod = await import('./api');
  return mod.api;
}

// ---------------------------------------------------------------------------
// 1. CSRF — muterande request hämtar och bifogar X-CSRF-Token
// ---------------------------------------------------------------------------

describe('CSRF-token på muterande anrop', () => {
  it('hämtar /csrf-token först och sätter X-CSRF-Token på POST', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/csrf-token`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ csrfToken: 'csrf-abc' }) }));
      }
      // Själva POST:en
      return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ id: 't1' }) }));
    });

    const api = await freshApi();
    const result = await api.createTicket({ title: 'Hej' });

    expect(result).toEqual({ id: 't1' });

    // CSRF-token hämtades före POST:en
    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/csrf-token`);

    // Hitta det muterande anropet (POST mot /tickets) och verifiera headern
    const postCall = fetchMock.mock.calls.find(
      (c) => urlOfCall(c) === `${BASE}/tickets` && (c[1] as RequestInit)?.method === 'POST'
    );
    expect(postCall).toBeDefined();
    expect(headersOfCall(postCall)['X-CSRF-Token']).toBe('csrf-abc');
  });

  it('cachar CSRF-token: två muterande anrop ger bara ETT /csrf-token-anrop', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/csrf-token`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ csrfToken: 'csrf-1' }) }));
      }
      return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ ok: true }) }));
    });

    const api = await freshApi();
    await api.deleteTicket('a');
    await api.deleteTicket('b');

    const csrfCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/csrf-token`);
    expect(csrfCalls).toHaveLength(1);
  });

  it('skickar INTE X-CSRF-Token på en ren GET (icke-muterande)', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));

    const api = await freshApi();
    await api.getTickets();

    // Inget /csrf-token-anrop alls, och GET-anropet saknar headern
    const csrfCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/csrf-token`);
    expect(csrfCalls).toHaveLength(0);
    const getCall = fetchMock.mock.calls.find((c) => urlOfCall(c) === `${BASE}/tickets`);
    expect(headersOfCall(getCall)['X-CSRF-Token']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. 401 → refresh → retry originalanropet en gång
// ---------------------------------------------------------------------------

describe('401 → silent refresh → retry', () => {
  it('refreshar och retrar originalanropet en gång; retryns svar returneras', async () => {
    let getTicketsCalls = 0;
    fetchMock.mockImplementation((url: string, opts: RequestInit) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: 'fräscht-token' }) }));
      }
      if (url === `${BASE}/tickets`) {
        getTicketsCalls++;
        if (getTicketsCalls === 1) {
          // Första försöket: 401
          return Promise.resolve(fakeResponse({ ok: false, status: 401, json: () => Promise.resolve({}) }));
        }
        // Retryn: 200 med data
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve([{ id: 'efter-refresh' }]) }));
      }
      void opts;
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    const result = await api.getTickets();

    expect(result).toEqual([{ id: 'efter-refresh' }]);

    // refresh anropades en gång
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
    expect((refreshCalls[0][1] as RequestInit)?.method).toBe('POST');

    // /tickets anropades exakt två gånger (original + retry), ingen loop
    expect(getTicketsCalls).toBe(2);

    // Nya access-token sparades i localStorage av setToken()
    expect(localStorage.getItem('auth_token')).toBe('fräscht-token');
  });
});

// ---------------------------------------------------------------------------
// 3. Refresh misslyckas → rensa auth + redirect, ingen oändlig loop
// ---------------------------------------------------------------------------

describe('401 + refresh misslyckas → logout-path', () => {
  it('rensar token/user, redirectar till /login och kastar "Session expired"', async () => {
    const loc = stubLocation();
    localStorage.setItem('auth_token', 'gammalt');
    localStorage.setItem('user', JSON.stringify({ id: 'u1' }));

    let ticketCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        // refresh nekas → tryRefresh() returnerar false
        return Promise.resolve(fakeResponse({ ok: false, status: 401, json: () => Promise.resolve({}) }));
      }
      if (url === `${BASE}/tickets`) {
        ticketCalls++;
        return Promise.resolve(fakeResponse({ ok: false, status: 401, json: () => Promise.resolve({}) }));
      }
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();

    await expect(api.getTickets()).rejects.toThrow('Session expired');

    // Originalanropet gjordes bara EN gång (ingen retry när refresh misslyckas) → ingen loop
    expect(ticketCalls).toBe(1);
    // refresh försöktes en gång
    expect(fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`)).toHaveLength(1);

    // Auth rensad
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    // Redirect till login
    expect(loc.href).toBe('/login');
  });
});

// ---------------------------------------------------------------------------
// 4. Felpropagering vid icke-ok-svar
// ---------------------------------------------------------------------------

describe('felpropagering', () => {
  it('använder error.error från JSON-body', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Ogiltig data' }) })
    );

    const api = await freshApi();
    await expect(api.getTickets()).rejects.toThrow('Ogiltig data');
  });

  it('faller tillbaka på error.message när "error" saknas', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: false, status: 422, json: () => Promise.resolve({ message: 'Valideringsfel' }) })
    );

    const api = await freshApi();
    await expect(api.getTickets()).rejects.toThrow('Valideringsfel');
  });

  it('när body inte är JSON → meddelandet innehåller statuskoden', async () => {
    // .json() kastar (ingen JSON) → catch-fallbacken bygger `Request failed (500)`
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: false, status: 500, json: () => Promise.reject(new SyntaxError('Unexpected token')) })
    );

    const api = await freshApi();
    await expect(api.getTickets()).rejects.toThrow('Request failed (500)');
  });

  it('non-ok på 403 utan CSRF-fel kastar utan retry', async () => {
    let calls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/tickets`) {
        calls++;
        return Promise.resolve(
          fakeResponse({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Forbidden' }) })
        );
      }
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    await expect(api.getTickets()).rejects.toThrow('Forbidden');
    // 403 utan CSRF-kod → ingen retry
    expect(calls).toBe(1);
  });
});
