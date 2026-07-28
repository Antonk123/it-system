// @vitest-environment jsdom
/**
 * Tester för src/lib/api.ts — komplement till api.test.ts (som täcker CSRF,
 * 401-refresh-retry, session-expired och felpropagering-prioritet/fallback).
 *
 * Den här filen täcker det api.test.ts INTE gör:
 *  1. Querystring-byggarna med egen villkorslogik (getKbArticles, getRequesterAnalytics,
 *     getKpiTickets, getSLAPolicies, getInvoices) — exakt URL för olika parameterkombinationer,
 *     utelämnade parametrar, 'all'-värden och specialtecken som ska/inte ska URL-kodas.
 *  2. request()s svarsgrenar (rad 160–178): 204 → null, content-type-grenar, JSON.parse-fallback.
 *  3. API_BASE_URL (rad 3) — läses en gång vid modulladdning, båda grenarna (env satt/ej satt).
 *  4. Rena URL-byggare: getAttachmentUrl, oidcLoginUrl.
 *
 * OBS: error.error/error.message/'Request failed'-prioritet och "response.json() kastar →
 * fallback 'Request failed (STATUS)'" testas REDAN i api.test.ts (rad 277–303) — duplicerar
 * inte det här.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = '/api'; // import.meta.env.VITE_API_URL saknas i testkörning → fallback '/api'

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  contentType?: string | null;
  text?: () => Promise<string>;
}

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

function urlOfCall(call: unknown[] | undefined): string {
  return String(call?.[0]);
}

function stubLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

async function freshApi() {
  const mod = await import('./api');
  return mod.api;
}

// ---------------------------------------------------------------------------
// 1. Querystring-byggare
// ---------------------------------------------------------------------------

describe('getKbArticles — querystring', () => {
  it('alla parametrar satta → exakt query i deklarationsordning, mellanslag kodas som "+"', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getKbArticles({ search: 'hello world', category_id: 'cat1', article_type: 'howto', tag: 'urgent', stale: true });

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(
      `${BASE}/kb/articles?search=hello+world&category_id=cat1&article_type=howto&tag=urgent&stale=1`
    );
  });

  it('inga parametrar → ingen "?" alls', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getKbArticles();

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/kb/articles`);
  });

  it('utelämnad/tom parameter produceras inte som "undefined" i querystringen', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    // category_id: tom sträng är falsy → utelämnas; article_type/tag: helt utelämnade
    await api.getKbArticles({ search: 'x', category_id: '' });

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/kb/articles?search=x`);
  });

  it('stale: false → "stale"-parametern utelämnas helt (inte "stale=false" eller "stale=")', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getKbArticles({ search: 'x', stale: false });

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/kb/articles?search=x`);
  });

  it('specialtecken ("&") i search URL-kodas (URLSearchParams → %26)', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getKbArticles({ search: 'a&b' });

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/kb/articles?search=a%26b`);
  });
});

describe('getRequesterAnalytics — querystring', () => {
  it('år och månad satta → båda i query', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getRequesterAnalytics('2026', '7');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/reports/requester-analytics?year=2026&month=7`);
  });

  it("year='all' → year utelämnas, month behålls", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getRequesterAnalytics('all', '7');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/reports/requester-analytics?month=7`);
  });

  it("month='all' → month utelämnas, year behålls", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getRequesterAnalytics('2026', 'all');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/reports/requester-analytics?year=2026`);
  });

  it("båda 'all' → ingen '?' alls", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getRequesterAnalytics('all', 'all');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/reports/requester-analytics`);
  });

  it('tomma strängar → båda falsy → ingen "?" alls', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getRequesterAnalytics('', '');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/reports/requester-analytics`);
  });
});

describe('getKpiTickets — querystring', () => {
  it("scope='total' + år/månad satta → scope, year, month i den ordningen", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getKpiTickets('total', '2026', '7');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/reports/kpi-tickets?scope=total&year=2026&month=7`);
  });

  it("scope='total' + år/månad 'all' → bara scope kvar", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getKpiTickets('total', 'all', 'all');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/reports/kpi-tickets?scope=total`);
  });

  it("scope='total' utan år/månad-argument alls → bara scope", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getKpiTickets('total');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/reports/kpi-tickets?scope=total`);
  });

  it("scope='aging' ignorerar år/månad även om de skickas med", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getKpiTickets('aging', '2026', '7');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/reports/kpi-tickets?scope=aging`);
  });
});

describe('getSLAPolicies — querystring med default-fallback', () => {
  it('company_id satt → company_id i query (URL-kodad via encodeURIComponent)', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getSLAPolicies('comp-1');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/sla?company_id=comp-1`);
  });

  it('company_id utelämnad → default-fallback "?company_id=default"', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getSLAPolicies();

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/sla?company_id=default`);
  });

  it('company_id tom sträng → falsy → default-fallback (inte "?company_id=")', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getSLAPolicies('');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/sla?company_id=default`);
  });

  it('specialtecken i company_id kodas med encodeURIComponent (mellanslag → %20, "&" → %26)', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getSLAPolicies('a b&c');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/sla?company_id=a%20b%26c`);
  });
});

describe('getInvoices — querystring (OBS: ingen URL-kodning i källkoden)', () => {
  it('company_id satt → company_id i query', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getInvoices('comp-1');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/billing/invoices?company_id=comp-1`);
  });

  it('company_id utelämnad → ingen "?" alls', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getInvoices();

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/billing/invoices`);
  });

  it('specialtecken i company_id URL-kodas INTE (dokumenterar faktiskt beteende — rå template-literal)', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    const api = await freshApi();
    await api.getInvoices('a&b');

    // encodeURIComponent skulle ha gett "a%26b" — koden gör det inte, så "&" slinker igenom rått.
    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/billing/invoices?company_id=a&b`);
  });
});

// ---------------------------------------------------------------------------
// 2. request()s svarsgrenar (rad 160–178)
// ---------------------------------------------------------------------------

describe('request() — svarshantering (content negotiation)', () => {
  it('204 → returnerar null UTAN att konsumera response.json()/text() (bevisar tidig retur, inte råkad tom-text-fallback)', async () => {
    const jsonSpy = vi.fn(() => Promise.resolve({ should: 'not-be-called' }));
    const textSpy = vi.fn(() => Promise.resolve('should-not-be-called-either'));
    fetchMock.mockResolvedValue(fakeResponse({ status: 204, contentType: null, json: jsonSpy, text: textSpy }));
    const api = await freshApi();

    const result = await api.getTickets();

    expect(result).toBeNull();
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("content-type application/json → resultatet är svaret från response.json()", async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ contentType: 'application/json; charset=utf-8', json: () => Promise.resolve([{ id: 't1' }]) })
    );
    const api = await freshApi();

    const result = await api.getTickets();

    expect(result).toEqual([{ id: 't1' }]);
  });

  it('annan content-type men texten är giltig JSON → parsas via JSON.parse', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ contentType: 'text/plain', text: () => Promise.resolve('{"a":1}') })
    );
    const api = await freshApi();

    const result = await api.getTickets();

    expect(result).toEqual({ a: 1 });
  });

  it('annan content-type och texten är INTE giltig JSON → faller tillbaka till rå text', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ contentType: 'text/plain', text: () => Promise.resolve('bara text, inte json') })
    );
    const api = await freshApi();

    const result = await api.getTickets();

    expect(result).toBe('bara text, inte json');
  });

  it('annan content-type och tom text → returnerar null (inte tom sträng)', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ contentType: 'text/plain', text: () => Promise.resolve('') })
    );
    const api = await freshApi();

    const result = await api.getTickets();

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. API_BASE_URL — läses en gång vid modulladdning (rad 3)
// ---------------------------------------------------------------------------

describe('API_BASE_URL', () => {
  it("VITE_API_URL saknas/tom → faller tillbaka till '/api'", async () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.resetModules();
    const api = await freshApi();

    expect(api.oidcLoginUrl()).toBe('/api/auth/oidc/login');
  });

  it('VITE_API_URL satt → används som bas för alla anrop', async () => {
    vi.stubEnv('VITE_API_URL', 'https://example.test/api');
    vi.resetModules();
    const api = await freshApi();

    expect(api.oidcLoginUrl()).toBe('https://example.test/api/auth/oidc/login');
    expect(api.getAttachmentUrl('att-1')).toBe('https://example.test/api/attachments/file/att-1');

    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));
    await api.getTickets();
    expect(urlOfCall(fetchMock.mock.calls[0])).toBe('https://example.test/api/tickets');
  });
});

// ---------------------------------------------------------------------------
// 3b. getBranding() — logoUrl måste resolva mot API_BASE_URL, inte mot
// frontendens origin (L2b: trasig bild i dev/prod när VITE_API_URL pekar på
// en annan origin än frontenden — jsdom med tom VITE_API_URL döljer buggen
// eftersom '/api' då råkar vara både bas och prefix).
// ---------------------------------------------------------------------------

describe('getBranding — logoUrl-prefix mot korrekt bas', () => {
  it("VITE_API_URL absolut (annan origin) → '/api/'-prefixet i svaret byts mot basen", async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com/api');
    vi.resetModules();
    const api = await freshApi();

    fetchMock.mockResolvedValue(
      fakeResponse({ json: () => Promise.resolve({ logoUrl: '/api/public/branding/logo?v=123' }) })
    );

    const result = await api.getBranding();
    expect(result).toEqual({ logoUrl: 'https://api.example.com/api/public/branding/logo?v=123' });
  });

  it("VITE_API_URL tom (relativ bas) → svaret lämnas oförändrat", async () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.resetModules();
    const api = await freshApi();

    fetchMock.mockResolvedValue(
      fakeResponse({ json: () => Promise.resolve({ logoUrl: '/api/public/branding/logo?v=123' }) })
    );

    const result = await api.getBranding();
    expect(result).toEqual({ logoUrl: '/api/public/branding/logo?v=123' });
  });

  it('logoUrl null → förblir null oavsett bas', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com/api');
    vi.resetModules();
    const api = await freshApi();

    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve({ logoUrl: null }) }));

    const result = await api.getBranding();
    expect(result).toEqual({ logoUrl: null });
  });
});

// ---------------------------------------------------------------------------
// 4. Rena URL-byggare
// ---------------------------------------------------------------------------

describe('rena strängbyggare', () => {
  it('getAttachmentUrl(id) → "<baseUrl>/attachments/file/<id>"', async () => {
    const api = await freshApi();
    expect(api.getAttachmentUrl('att-42')).toBe(`${BASE}/attachments/file/att-42`);
  });

  it('oidcLoginUrl() → "<baseUrl>/auth/oidc/login"', async () => {
    const api = await freshApi();
    expect(api.oidcLoginUrl()).toBe(`${BASE}/auth/oidc/login`);
  });
});
