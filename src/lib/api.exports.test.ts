// @vitest-environment jsdom
/**
 * Tester för api.ts:s RÅA fetch()-metoder — de som ligger utanför kärn-pipen
 * request()/requestBlob() och därför dupplicerar delar av dess logik
 * (auth-header, CSRF, 401-hantering) på egen hand:
 *
 *  1. exportTickets/exportArchive/exportContacts — nedladdning via rå fetch:
 *     Content-Disposition-filnamnsparsning + DOM-städning (createObjectURL/
 *     revokeObjectURL, createElement/appendChild/removeChild).
 *  2. importTicketsPreview/importContactsPreview/uploadKbImage — FormData +
 *     CSRF, delad implementation via den privata `postFile()`-hjälparen
 *     (samma hjälpare som uploadFile() använder). Tidigare (fixad bugg)
 *     saknade dessa tre helt 401-hantering — de förnyade aldrig access-token
 *     och kraschade hårt efter ~15 min inaktivitet. Nu delar alla fyra
 *     FormData-metoder samma 401-refresh-retry + 403-CSRF-retry + proaktiv
 *     refresh som uploadFile(); testas explicit nedan per metod.
 *  3. downloadBackup — egen duplicerad proaktiv-refresh + 401-retry, skild
 *     från request()/requestBlob().
 *
 * Se api.test.ts för kärn-pipens CSRF/401/felpropagering — dupliceras INTE här.
 * Mönster (fakeResponse/stubLocalStorage/stubLocation/freshApi/vi.stubGlobal)
 * kopierat rakt av från api.test.ts; DOM-stubbning för createElement/URL
 * kopierat från secureFileAccess.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hjälpare (kopierade/adapterade från api.test.ts och secureFileAccess.test.ts)
// ---------------------------------------------------------------------------

const BASE = '/api'; // import.meta.env.VITE_API_URL saknas i testkörning → fallback '/api'

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  headers?: Record<string, string | null>;
  blob?: () => Promise<Blob>;
  text?: () => Promise<string>;
}

// OBS: default 'content-type': 'application/json' krävs eftersom getCsrfToken()
// (använd av FormData-metoderna) går via kärn-pipens request(), som grenar på
// content-type-headern (rad 165-177 i api.ts) — utan den hamnar den i
// text()-fallbacken och kraschar om text() saknas.
function fakeResponse(init: FakeResponseInit) {
  const status = init.status ?? (init.ok === false ? 400 : 200);
  const ok = init.ok ?? (status >= 200 && status < 300);
  const headerMap: Record<string, string | null> = { 'content-type': 'application/json', ...(init.headers ?? {}) };
  return {
    ok,
    status,
    headers: {
      get: (h: string) => {
        const hit = Object.keys(headerMap).find((k) => k.toLowerCase() === h.toLowerCase());
        return hit ? headerMap[hit] : null;
      },
    },
    json: init.json ?? (() => Promise.resolve({})),
    text: init.text ?? (() => Promise.resolve('')),
    blob: init.blob ?? (() => Promise.resolve(new Blob(['innehåll'], { type: 'application/octet-stream' }))),
  };
}

function headersOfCall(call: unknown[] | undefined): Record<string, string> {
  return ((call?.[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;
}

function urlOfCall(call: unknown[] | undefined): string {
  return String(call?.[0]);
}

function stubLocation() {
  const loc = { href: '' };
  Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true });
  return loc;
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

// Fejkar en JWT (header.payload.signature) med given exp (unix-sekunder), så att
// ApiClient.isTokenExpired() kan avkoda den via atob(token.split('.')[1]).
function makeJwt(expSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: 'none' }));
  const payload = btoa(JSON.stringify({ exp: expSeconds }));
  return `${header}.${payload}.sig`;
}

// Stubbar document (createElement/body.appendChild/removeChild) och
// URL.createObjectURL/revokeObjectURL, precis som secureFileAccess.test.ts.
function stubDom() {
  const linkEl = { href: '', download: '', click: vi.fn() };
  const createElementMock = vi.fn(() => linkEl);
  const appendChildMock = vi.fn();
  const removeChildMock = vi.fn();
  vi.stubGlobal('document', {
    createElement: createElementMock,
    body: { appendChild: appendChildMock, removeChild: removeChildMock },
  });
  return { linkEl, createElementMock, appendChildMock, removeChildMock };
}

let urlCounter = 0;
const createObjectURLMock = vi.fn(() => `blob:mock-${++urlCounter}`);
const revokeObjectURLMock = vi.fn();

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  stubLocalStorage();
  urlCounter = 0;
  createObjectURLMock.mockClear();
  revokeObjectURLMock.mockClear();
  // Statiska metoder på URL-klassen mockas direkt (som secureFileAccess.test.ts) —
  // ersätter INTE hela URL-objektet så att `new URL(...)` fortsatt fungerar.
  URL.createObjectURL = createObjectURLMock;
  URL.revokeObjectURL = revokeObjectURLMock;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules(); // ny ApiClient-singleton (nollställd csrf-cache) per test
  vi.clearAllMocks();
});

async function freshApi() {
  const mod = await import('./api');
  return mod.api;
}

// ---------------------------------------------------------------------------
// 1a. exportTickets — filnamnsparsning + DOM-städning
// ---------------------------------------------------------------------------

describe('exportTickets', () => {
  it('laddar ner filen: rätt URL/metod/Authorization, filnamn från Content-Disposition, DOM-städning', async () => {
    localStorage.setItem('auth_token', 'mitt-jwt');
    const blob = new Blob(['xlsx-data']);
    fetchMock.mockResolvedValue(
      fakeResponse({ headers: { 'Content-Disposition': 'attachment; filename="mina-arenden.xlsx"' }, blob: () => Promise.resolve(blob) })
    );
    const dom = stubDom();

    const api = await freshApi();
    await api.exportTickets('?status=open');

    // Rätt anrop
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(urlOfCall(call)).toBe(`${BASE}/tickets/export?status=open`);
    expect((call[1] as RequestInit).method).toBe('GET');
    expect(headersOfCall(call)['Authorization']).toBe('Bearer mitt-jwt');

    // Filnamn parsat ur Content-Disposition och satt på <a download>
    expect(dom.linkEl.download).toBe('mina-arenden.xlsx');
    expect(dom.linkEl.href).toBe(`blob:mock-1`);

    // DOM-städning: elementet läggs till, klickas, och städas bort igen; URL:en revokas
    expect(dom.createElementMock).toHaveBeenCalledWith('a');
    expect(dom.appendChildMock).toHaveBeenCalledWith(dom.linkEl);
    expect(dom.linkEl.click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith(`blob:mock-1`);
    expect(dom.removeChildMock).toHaveBeenCalledWith(dom.linkEl);
  });

  it('faller tillbaka på ett datumstämplat standardnamn när Content-Disposition saknas', async () => {
    fetchMock.mockResolvedValue(fakeResponse({}));
    const dom = stubDom();

    const api = await freshApi();
    await api.exportTickets();

    expect(dom.linkEl.download).toMatch(/^arenden-export-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('faller tillbaka på standardnamnet när Content-Disposition inte matchar det citerade mönstret (udda värde)', async () => {
    // Extended-filename-syntax (RFC 5987) utan en enkel filename="..." — regexen
    // `/filename="(.+)"/` kräver citattecken och matchar INTE detta.
    fetchMock.mockResolvedValue(
      fakeResponse({ headers: { 'Content-Disposition': "attachment; filename*=UTF-8''%C3%A4renden.xlsx" } })
    );
    const dom = stubDom();

    const api = await freshApi();
    await api.exportTickets();

    expect(dom.linkEl.download).toMatch(/^arenden-export-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('kastar och gör ingen DOM-manipulation vid icke-ok svar', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 500 }));
    const dom = stubDom();

    const api = await freshApi();
    await expect(api.exportTickets()).rejects.toThrow('Failed to export tickets');

    expect(dom.createElementMock).not.toHaveBeenCalled();
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 1b. exportArchive — samma dupplicerade logik, kortare svit
// ---------------------------------------------------------------------------

describe('exportArchive', () => {
  it('laddar ner arkivfilen med filnamn ur Content-Disposition och städar upp DOM', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ headers: { 'Content-Disposition': 'attachment; filename="arkiv-2026.xlsx"' } })
    );
    const dom = stubDom();

    const api = await freshApi();
    await api.exportArchive('?year=2026');

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/tickets/export-archive?year=2026`);
    expect(dom.linkEl.download).toBe('arkiv-2026.xlsx');
    expect(revokeObjectURLMock).toHaveBeenCalledWith(dom.linkEl.href);
    expect(dom.removeChildMock).toHaveBeenCalledWith(dom.linkEl);
  });

  it('faller tillbaka på datumstämplat standardnamn utan Content-Disposition', async () => {
    fetchMock.mockResolvedValue(fakeResponse({}));
    const dom = stubDom();

    const api = await freshApi();
    await api.exportArchive();

    expect(dom.linkEl.download).toMatch(/^arkiv-export-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('kastar "Failed to export archive" vid icke-ok svar', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 403 }));
    stubDom();

    const api = await freshApi();
    await expect(api.exportArchive()).rejects.toThrow('Failed to export archive');
  });
});

// ---------------------------------------------------------------------------
// 1c. exportContacts — samma dupplicerade logik, statiskt standardnamn (inget datum)
// ---------------------------------------------------------------------------

describe('exportContacts', () => {
  it('laddar ner kontaktfilen med filnamn ur Content-Disposition och städar upp DOM', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ headers: { 'Content-Disposition': 'attachment; filename="kunder-q3.xlsx"' } })
    );
    const dom = stubDom();

    const api = await freshApi();
    await api.exportContacts();

    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/contacts/export`);
    expect(dom.linkEl.download).toBe('kunder-q3.xlsx');
    expect(revokeObjectURLMock).toHaveBeenCalledWith(dom.linkEl.href);
    expect(dom.appendChildMock).toHaveBeenCalledWith(dom.linkEl);
    expect(dom.removeChildMock).toHaveBeenCalledWith(dom.linkEl);
  });

  it('faller tillbaka på det statiska standardnamnet "kontakter-export.xlsx" utan Content-Disposition', async () => {
    fetchMock.mockResolvedValue(fakeResponse({}));
    const dom = stubDom();

    const api = await freshApi();
    await api.exportContacts();

    expect(dom.linkEl.download).toBe('kontakter-export.xlsx');
  });

  it('kastar "Failed to export contacts" vid icke-ok svar', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 401 }));
    stubDom();

    const api = await freshApi();
    await expect(api.exportContacts()).rejects.toThrow('Failed to export contacts');
  });
});

// ---------------------------------------------------------------------------
// 2. importTicketsPreview / importContactsPreview / uploadKbImage
//    — FormData + CSRF via den delade postFile()-hjälparen (samma pipe som
//    uploadFile()). 401-refresh-retry, misslyckad-refresh-session-expired och
//    proaktiv refresh testas explicit per metod nedan (se targetDispatch).
// ---------------------------------------------------------------------------

function csrfDispatch(csrfToken: string, otherHandler: (url: string, opts: RequestInit) => unknown) {
  return (url: string, opts: RequestInit) => {
    if (url === `${BASE}/csrf-token`) {
      return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ csrfToken }) }));
    }
    return otherHandler(url, opts);
  };
}

// Dispatcher för 401-refresh-retry/session-expired/proaktiv-refresh-tester:
// svarar på /csrf-token och /auth/refresh, och räknar anrop mot målendpointen
// så vi kan verifiera "exakt en omkörning" (ingen loop, ingen dubbel-refresh).
function targetDispatch(
  targetUrl: string,
  csrfToken: string,
  onTarget: (call: number, opts: RequestInit) => ReturnType<typeof fakeResponse>,
  onRefresh?: () => ReturnType<typeof fakeResponse>,
) {
  let calls = 0;
  return (url: string, opts: RequestInit) => {
    if (url === `${BASE}/csrf-token`) {
      return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ csrfToken }) }));
    }
    if (url === `${BASE}/auth/refresh`) {
      return Promise.resolve(onRefresh ? onRefresh() : fakeResponse({ ok: false, status: 401 }));
    }
    if (url === targetUrl) {
      calls++;
      return Promise.resolve(onTarget(calls, opts));
    }
    return Promise.resolve(fakeResponse({}));
  };
}

describe('importTicketsPreview', () => {
  it('skickar FormData med filen, CSRF-header, Authorization och credentials:"include" mot rätt URL', async () => {
    localStorage.setItem('auth_token', 'mitt-jwt');
    fetchMock.mockImplementation(
      csrfDispatch('csrf-xyz', () => Promise.resolve(fakeResponse({ json: () => Promise.resolve({ preview: [] }) })))
    );

    const api = await freshApi();
    const file = new File(['a,b,c'], 'import.csv', { type: 'text/csv' });
    const result = await api.importTicketsPreview(file);

    expect(result).toEqual({ preview: [] });

    const call = fetchMock.mock.calls.find((c) => urlOfCall(c) === `${BASE}/tickets/import/preview`);
    expect(call).toBeDefined();
    const [, opts] = call as [string, RequestInit];
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('include');
    expect(headersOfCall(call)['X-CSRF-Token']).toBe('csrf-xyz');
    expect(headersOfCall(call)['Authorization']).toBe('Bearer mitt-jwt');
    expect(headersOfCall(call)['Content-Type']).toBeUndefined(); // browsern sätter multipart-boundary

    const body = opts.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const sentFile = body.get('file') as File;
    expect(sentFile).toBeInstanceOf(File);
    expect(sentFile.name).toBe('import.csv');
  });

  it('kastar serverns felmeddelande vid icke-ok svar', async () => {
    fetchMock.mockImplementation(
      csrfDispatch('csrf-1', () =>
        Promise.resolve(fakeResponse({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Ogiltig fil' }) }))
      )
    );

    const api = await freshApi();
    const file = new File(['x'], 'bad.csv');
    await expect(api.importTicketsPreview(file)).rejects.toThrow('Ogiltig fil');
  });

  it('faller tillbaka på "Preview failed" när felsvaret saknar JSON', async () => {
    fetchMock.mockImplementation(
      csrfDispatch('csrf-1', () =>
        Promise.resolve(fakeResponse({ ok: false, status: 500, json: () => Promise.reject(new Error('no json')) }))
      )
    );

    const api = await freshApi();
    await expect(api.importTicketsPreview(new File(['x'], 'bad.csv'))).rejects.toThrow('Preview failed');
  });

  it('401 → EN /auth/refresh → EN omkörning som lyckas, med nya token i Authorization', async () => {
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600)); // giltig, ingen proaktiv refresh
    let retryHeaders: Record<string, string> | undefined;
    fetchMock.mockImplementation(
      targetDispatch(
        `${BASE}/tickets/import/preview`,
        'csrf-1',
        (call, opts) => {
          if (call === 1) return fakeResponse({ ok: false, status: 401 });
          retryHeaders = (opts.headers ?? {}) as Record<string, string>;
          return fakeResponse({ json: () => Promise.resolve({ preview: ['ok'] }) });
        },
        () => fakeResponse({ json: () => Promise.resolve({ accessToken: 'nytt-token' }) }),
      ),
    );

    const api = await freshApi();
    const result = await api.importTicketsPreview(new File(['a'], 'x.csv'));

    expect(result).toEqual({ preview: ['ok'] });
    expect(retryHeaders?.['Authorization']).toBe('Bearer nytt-token');
    const targetCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/tickets/import/preview`);
    expect(targetCalls).toHaveLength(2); // original + exakt en omkörning
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
  });

  it('401, refresh misslyckas → session expired: token rensad, redirect till /login, kastar', async () => {
    const loc = stubLocation();
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
    localStorage.setItem('user', JSON.stringify({ id: 'u1' }));
    fetchMock.mockImplementation(
      targetDispatch(
        `${BASE}/tickets/import/preview`,
        'csrf-1',
        () => fakeResponse({ ok: false, status: 401 }),
        () => fakeResponse({ ok: false, status: 401 }),
      ),
    );

    const api = await freshApi();
    await expect(api.importTicketsPreview(new File(['a'], 'x.csv'))).rejects.toThrow('Session expired');

    const targetCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/tickets/import/preview`);
    expect(targetCalls).toHaveLength(1); // ingen omkörning när refresh misslyckas
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(loc.href).toBe('/login');
  });

  it('proaktiv refresh: nära-utgången token förnyas INNAN anropet', async () => {
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 10)); // inom 30s-marginalen
    let firstCallHeaders: Record<string, string> | undefined;
    fetchMock.mockImplementation(
      targetDispatch(
        `${BASE}/tickets/import/preview`,
        'csrf-1',
        (call, opts) => {
          firstCallHeaders = (opts.headers ?? {}) as Record<string, string>;
          return fakeResponse({ json: () => Promise.resolve({ preview: [] }) });
        },
        () => fakeResponse({ json: () => Promise.resolve({ accessToken: 'proaktivt-token' }) }),
      ),
    );

    const api = await freshApi();
    await api.importTicketsPreview(new File(['a'], 'x.csv'));

    // Endast ETT anrop mot målendpointen — token förnyades före, ingen 401-retry
    const targetCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/tickets/import/preview`);
    expect(targetCalls).toHaveLength(1);
    expect(firstCallHeaders?.['Authorization']).toBe('Bearer proaktivt-token');
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
  });

  it('401 på BÅDE originalanropet och den omkörda requesten → EXAKT en refresh, EXAKT två anrop mot endpointen, ingen oändlig loop — och en FÄRSK FormData-instans per försök', async () => {
    // Regressionslås för !isRetry-spärren i postFile(): utan den skulle den
    // omkörda requestens 401 trigga ÄNNU en refresh, och lyckas den (till
    // skillnad från vår andra refresh nedan) rekurserar postFile i all
    // evighet. Genom att låta den ANDRA refreshen misslyckas kan vi bevisa
    // spärren utan att behöva köra ett oändligt/timeout-test: med spärren
    // (korrekt kod) görs bara EN refresh totalt och requesten kastar
    // originalfelet; utan spärren (muterad kod) görs en andra, misslyckad
    // refresh som i stället triggar sessionExpired() ("Session expired").
    const loc = stubLocation();
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
    localStorage.setItem('user', JSON.stringify({ id: 'u1' }));
    let refreshCalls = 0;
    let targetCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/csrf-token`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ csrfToken: 'csrf-1' }) }));
      }
      if (url === `${BASE}/auth/refresh`) {
        refreshCalls++;
        if (refreshCalls === 1) {
          return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: 'nytt-token' }) }));
        }
        return Promise.resolve(fakeResponse({ ok: false, status: 401 })); // andra refreshen ska aldrig behöva ske
      }
      if (url === `${BASE}/tickets/import/preview`) {
        targetCalls++;
        return Promise.resolve(fakeResponse({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Fortfarande obehörig' }) }));
      }
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    const file = new File(['a,b,c'], 'x.csv', { type: 'text/csv' });
    await expect(api.importTicketsPreview(file)).rejects.toThrow('Fortfarande obehörig');

    expect(targetCalls).toBe(2); // original + exakt EN omkörning
    expect(refreshCalls).toBe(1); // spärren stoppar en andra refresh på den redan omkörda requesten
    // sessionExpired() ska INTE ha triggats — bara en trasig andra refresh (om spärren saknas) gör det
    expect(localStorage.getItem('auth_token')).not.toBeNull();
    expect(loc.href).not.toBe('/login');

    // Ny FormData per försök: bodyn i original- och omkörningsanropet ska
    // vara OLIKA objektreferenser (inte samma instans återanvänd över två
    // fetch-anrop), och båda ska ändå innehålla filen under fältet "file".
    const targetFetchCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/tickets/import/preview`);
    expect(targetFetchCalls).toHaveLength(2);
    const firstBody = (targetFetchCalls[0][1] as RequestInit).body as FormData;
    const secondBody = (targetFetchCalls[1][1] as RequestInit).body as FormData;
    expect(firstBody).toBeInstanceOf(FormData);
    expect(secondBody).toBeInstanceOf(FormData);
    expect(secondBody).not.toBe(firstBody);
    expect((firstBody.get('file') as File).name).toBe('x.csv');
    expect((secondBody.get('file') as File).name).toBe('x.csv');
  });
});

describe('importContactsPreview', () => {
  it('skickar FormData med filen under nyckeln "file" och CSRF-header mot rätt URL', async () => {
    fetchMock.mockImplementation(
      csrfDispatch('csrf-c1', () => Promise.resolve(fakeResponse({ json: () => Promise.resolve({ preview: [] }) })))
    );

    const api = await freshApi();
    const file = new File(['namn,email'], 'kontakter.csv', { type: 'text/csv' });
    await api.importContactsPreview(file);

    const call = fetchMock.mock.calls.find((c) => urlOfCall(c) === `${BASE}/contacts/import/preview`);
    expect(call).toBeDefined();
    expect(headersOfCall(call)['X-CSRF-Token']).toBe('csrf-c1');
    expect(headersOfCall(call)['Content-Type']).toBeUndefined(); // browsern sätter multipart-boundary
    const body = (call as [string, RequestInit])[1].body as FormData;
    expect((body.get('file') as File).name).toBe('kontakter.csv');
  });

  it('kastar serverns felmeddelande vid icke-ok svar', async () => {
    fetchMock.mockImplementation(
      csrfDispatch('csrf-1', () =>
        Promise.resolve(fakeResponse({ ok: false, status: 422, json: () => Promise.resolve({ error: 'Dubblett' }) }))
      )
    );

    const api = await freshApi();
    await expect(api.importContactsPreview(new File(['x'], 'dup.csv'))).rejects.toThrow('Dubblett');
  });

  it('401 → EN /auth/refresh → EN omkörning som lyckas, med nya token i Authorization', async () => {
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
    let retryHeaders: Record<string, string> | undefined;
    fetchMock.mockImplementation(
      targetDispatch(
        `${BASE}/contacts/import/preview`,
        'csrf-1',
        (call, opts) => {
          if (call === 1) return fakeResponse({ ok: false, status: 401 });
          retryHeaders = (opts.headers ?? {}) as Record<string, string>;
          return fakeResponse({ json: () => Promise.resolve({ preview: ['kontakt'] }) });
        },
        () => fakeResponse({ json: () => Promise.resolve({ accessToken: 'nytt-token' }) }),
      ),
    );

    const api = await freshApi();
    const result = await api.importContactsPreview(new File(['a'], 'k.csv'));

    expect(result).toEqual({ preview: ['kontakt'] });
    expect(retryHeaders?.['Authorization']).toBe('Bearer nytt-token');
    const targetCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/contacts/import/preview`);
    expect(targetCalls).toHaveLength(2);
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
  });

  it('401, refresh misslyckas → session expired: token rensad, redirect till /login, kastar', async () => {
    const loc = stubLocation();
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
    localStorage.setItem('user', JSON.stringify({ id: 'u1' }));
    fetchMock.mockImplementation(
      targetDispatch(
        `${BASE}/contacts/import/preview`,
        'csrf-1',
        () => fakeResponse({ ok: false, status: 401 }),
        () => fakeResponse({ ok: false, status: 401 }),
      ),
    );

    const api = await freshApi();
    await expect(api.importContactsPreview(new File(['a'], 'k.csv'))).rejects.toThrow('Session expired');

    const targetCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/contacts/import/preview`);
    expect(targetCalls).toHaveLength(1);
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(loc.href).toBe('/login');
  });

  it('proaktiv refresh: nära-utgången token förnyas INNAN anropet', async () => {
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 10));
    let firstCallHeaders: Record<string, string> | undefined;
    fetchMock.mockImplementation(
      targetDispatch(
        `${BASE}/contacts/import/preview`,
        'csrf-1',
        (call, opts) => {
          firstCallHeaders = (opts.headers ?? {}) as Record<string, string>;
          return fakeResponse({ json: () => Promise.resolve({ preview: [] }) });
        },
        () => fakeResponse({ json: () => Promise.resolve({ accessToken: 'proaktivt-token' }) }),
      ),
    );

    const api = await freshApi();
    await api.importContactsPreview(new File(['a'], 'k.csv'));

    const targetCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/contacts/import/preview`);
    expect(targetCalls).toHaveLength(1);
    expect(firstCallHeaders?.['Authorization']).toBe('Bearer proaktivt-token');
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
  });
});

describe('uploadKbImage', () => {
  it('skickar FormData med bilden under nyckeln "image", CSRF-header, mot /kb/upload-image', async () => {
    fetchMock.mockImplementation(
      csrfDispatch('csrf-img', () => Promise.resolve(fakeResponse({ json: () => Promise.resolve({ url: '/files/abc.png' }) })))
    );

    const api = await freshApi();
    const file = new File(['binärdata'], 'skärmdump.png', { type: 'image/png' });
    const result = await api.uploadKbImage(file);

    expect(result).toEqual({ url: '/files/abc.png' });
    const call = fetchMock.mock.calls.find((c) => urlOfCall(c) === `${BASE}/kb/upload-image`);
    expect(call).toBeDefined();
    expect((call as [string, RequestInit])[1].method).toBe('POST');
    expect(headersOfCall(call)['X-CSRF-Token']).toBe('csrf-img');
    expect(headersOfCall(call)['Content-Type']).toBeUndefined(); // browsern sätter multipart-boundary
    const body = (call as [string, RequestInit])[1].body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('image') as File).name).toBe('skärmdump.png');
    expect(body.get('file')).toBeNull(); // annan nyckel än import-metoderna
  });

  it('kastar "Upload failed" när felsvaret saknar en error-nyckel och JSON', async () => {
    fetchMock.mockImplementation(
      csrfDispatch('csrf-1', () =>
        Promise.resolve(fakeResponse({ ok: false, status: 500, json: () => Promise.reject(new Error('no json')) }))
      )
    );

    const api = await freshApi();
    await expect(api.uploadKbImage(new File(['x'], 'x.png'))).rejects.toThrow('Upload failed');
  });

  it('401 → EN /auth/refresh → EN omkörning som lyckas, med nya token i Authorization', async () => {
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
    let retryHeaders: Record<string, string> | undefined;
    fetchMock.mockImplementation(
      targetDispatch(
        `${BASE}/kb/upload-image`,
        'csrf-1',
        (call, opts) => {
          if (call === 1) return fakeResponse({ ok: false, status: 401 });
          retryHeaders = (opts.headers ?? {}) as Record<string, string>;
          return fakeResponse({ json: () => Promise.resolve({ url: '/files/retry.png' }) });
        },
        () => fakeResponse({ json: () => Promise.resolve({ accessToken: 'nytt-token' }) }),
      ),
    );

    const api = await freshApi();
    const result = await api.uploadKbImage(new File(['a'], 'bild.png'));

    expect(result).toEqual({ url: '/files/retry.png' });
    expect(retryHeaders?.['Authorization']).toBe('Bearer nytt-token');
    const targetCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/kb/upload-image`);
    expect(targetCalls).toHaveLength(2);
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
  });

  it('401, refresh misslyckas → session expired: token rensad, redirect till /login, kastar', async () => {
    const loc = stubLocation();
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
    localStorage.setItem('user', JSON.stringify({ id: 'u1' }));
    fetchMock.mockImplementation(
      targetDispatch(
        `${BASE}/kb/upload-image`,
        'csrf-1',
        () => fakeResponse({ ok: false, status: 401 }),
        () => fakeResponse({ ok: false, status: 401 }),
      ),
    );

    const api = await freshApi();
    await expect(api.uploadKbImage(new File(['a'], 'bild.png'))).rejects.toThrow('Session expired');

    const targetCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/kb/upload-image`);
    expect(targetCalls).toHaveLength(1);
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(loc.href).toBe('/login');
  });

  it('proaktiv refresh: nära-utgången token förnyas INNAN anropet', async () => {
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 10));
    let firstCallHeaders: Record<string, string> | undefined;
    fetchMock.mockImplementation(
      targetDispatch(
        `${BASE}/kb/upload-image`,
        'csrf-1',
        (call, opts) => {
          firstCallHeaders = (opts.headers ?? {}) as Record<string, string>;
          return fakeResponse({ json: () => Promise.resolve({ url: '/files/proaktiv.png' }) });
        },
        () => fakeResponse({ json: () => Promise.resolve({ accessToken: 'proaktivt-token' }) }),
      ),
    );

    const api = await freshApi();
    await api.uploadKbImage(new File(['a'], 'bild.png'));

    const targetCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/kb/upload-image`);
    expect(targetCalls).toHaveLength(1);
    expect(firstCallHeaders?.['Authorization']).toBe('Bearer proaktivt-token');
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
  });

  it('401 på BÅDE originalanropet och den omkörda requesten → EXAKT en refresh, EXAKT två anrop mot endpointen, ingen oändlig loop — och en FÄRSK FormData-instans per försök', async () => {
    // Se motsvarande test i importTicketsPreview för fullständig motivering:
    // !isRetry-spärren i postFile() förhindrar en andra refresh på den redan
    // omkörda requesten. Utan den skulle en andra (här: misslyckad) refresh
    // triggas och sessionExpired() ta över — vilket den INTE ska göra här.
    const loc = stubLocation();
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
    localStorage.setItem('user', JSON.stringify({ id: 'u1' }));
    let refreshCalls = 0;
    let targetCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/csrf-token`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ csrfToken: 'csrf-1' }) }));
      }
      if (url === `${BASE}/auth/refresh`) {
        refreshCalls++;
        if (refreshCalls === 1) {
          return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: 'nytt-token' }) }));
        }
        return Promise.resolve(fakeResponse({ ok: false, status: 401 })); // andra refreshen ska aldrig behöva ske
      }
      if (url === `${BASE}/kb/upload-image`) {
        targetCalls++;
        return Promise.resolve(fakeResponse({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Fortfarande obehörig' }) }));
      }
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    const file = new File(['binärdata'], 'bild.png', { type: 'image/png' });
    await expect(api.uploadKbImage(file)).rejects.toThrow('Fortfarande obehörig');

    expect(targetCalls).toBe(2); // original + exakt EN omkörning
    expect(refreshCalls).toBe(1); // spärren stoppar en andra refresh på den redan omkörda requesten
    expect(localStorage.getItem('auth_token')).not.toBeNull(); // sessionExpired() ska INTE ha triggats
    expect(loc.href).not.toBe('/login');

    // Ny FormData per försök: olika objektreferenser, båda med filen under "image".
    const targetFetchCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/kb/upload-image`);
    expect(targetFetchCalls).toHaveLength(2);
    const firstBody = (targetFetchCalls[0][1] as RequestInit).body as FormData;
    const secondBody = (targetFetchCalls[1][1] as RequestInit).body as FormData;
    expect(firstBody).toBeInstanceOf(FormData);
    expect(secondBody).toBeInstanceOf(FormData);
    expect(secondBody).not.toBe(firstBody);
    expect((firstBody.get('image') as File).name).toBe('bild.png');
    expect((secondBody.get('image') as File).name).toBe('bild.png');
  });
});

// ---------------------------------------------------------------------------
// 3. downloadBackup — egen dupplicerad proaktiv-refresh + 401-retry
// ---------------------------------------------------------------------------

describe('downloadBackup', () => {
  it('laddar ner backupen direkt när token är giltig (ingen refresh)', async () => {
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
    const blob = new Blob(['backup-data']);
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/backup`) return Promise.resolve(fakeResponse({ blob: () => Promise.resolve(blob) }));
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    const result = await api.downloadBackup();

    expect(result).toBe(blob);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(urlOfCall(call)).toBe(`${BASE}/backup`);
    expect((call[1] as RequestInit).credentials).toBe('include');
  });

  it('proaktiv refresh: utgången token förnyas INNAN /backup-anropet, som sedan använder det nya tokenet', async () => {
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) - 100)); // redan utgången
    let backupHeaders: Record<string, string> | undefined;
    fetchMock.mockImplementation((url: string, opts: RequestInit) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: 'nytt-token' }) }));
      }
      if (url === `${BASE}/backup`) {
        backupHeaders = (opts.headers ?? {}) as Record<string, string>;
        return Promise.resolve(fakeResponse({}));
      }
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    await api.downloadBackup();

    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);
    expect(backupHeaders?.['Authorization']).toBe('Bearer nytt-token');
  });

  it('401 på /backup → EN /auth/refresh → EN omkörning av /backup som lyckas', async () => {
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600)); // giltig, ingen proaktiv refresh
    let backupCalls = 0;
    const blob = new Blob(['backup-efter-retry']);
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: 'fräscht-token' }) }));
      }
      if (url === `${BASE}/backup`) {
        backupCalls++;
        if (backupCalls === 1) return Promise.resolve(fakeResponse({ ok: false, status: 401 }));
        return Promise.resolve(fakeResponse({ blob: () => Promise.resolve(blob) }));
      }
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    const result = await api.downloadBackup();

    expect(result).toBe(blob);
    expect(backupCalls).toBe(2); // original + exakt en omkörning, ingen loop
    expect(fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`)).toHaveLength(1);
  });

  it('401 på /backup, refresh misslyckas → session expired, auth rensad, redirect /login', async () => {
    const loc = stubLocation();
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
    localStorage.setItem('user', JSON.stringify({ id: 'u1' }));
    let backupCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ ok: false, status: 401 }));
      }
      if (url === `${BASE}/backup`) {
        backupCalls++;
        return Promise.resolve(fakeResponse({ ok: false, status: 401 }));
      }
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    await expect(api.downloadBackup()).rejects.toThrow('Session expired');

    expect(backupCalls).toBe(1); // ingen omkörning när refresh misslyckas
    expect(fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`)).toHaveLength(1);
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(loc.href).toBe('/login');
  });

  it('401 på /backup, refresh lyckas men omkörningen är fortfarande icke-ok → "Backup failed"', async () => {
    localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
    let backupCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: 'nytt-token' }) }));
      }
      if (url === `${BASE}/backup`) {
        backupCalls++;
        if (backupCalls === 1) return Promise.resolve(fakeResponse({ ok: false, status: 401 }));
        return Promise.resolve(fakeResponse({ ok: false, status: 500 })); // omkörningen misslyckas också
      }
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    await expect(api.downloadBackup()).rejects.toThrow('Backup failed');
    expect(backupCalls).toBe(2);
  });
});
