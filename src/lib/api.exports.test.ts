// @vitest-environment jsdom
/**
 * Tester för api.ts:s RÅA fetch()-metoder — de som ligger utanför kärn-pipen
 * request()/requestBlob()/uploadFile() och därför dupplicerar delar av dess
 * logik (auth-header, CSRF, 401-hantering) på egen hand:
 *
 *  1. exportTickets/exportArchive/exportContacts — nedladdning via rå fetch:
 *     Content-Disposition-filnamnsparsning + DOM-städning (createObjectURL/
 *     revokeObjectURL, createElement/appendChild/removeChild).
 *  2. importTicketsPreview/importContactsPreview/uploadKbImage — FormData +
 *     CSRF via rå fetch. OBS (känd, rapporterad bugg): dessa tre saknar helt
 *     401-hantering (till skillnad från uploadFile() i kärn-pipen) — vi
 *     testar INTE att avsaknaden är korrekt, bara det som faktiskt ska stämma
 *     (URL, FormData-innehåll, CSRF-header, felpropagering).
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
//    — FormData + CSRF via rå fetch. Ingen 401-hantering (känd bugg, ej testad
//    som "korrekt"; se filkommentaren överst).
// ---------------------------------------------------------------------------

function csrfDispatch(csrfToken: string, otherHandler: (url: string, opts: RequestInit) => unknown) {
  return (url: string, opts: RequestInit) => {
    if (url === `${BASE}/csrf-token`) {
      return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ csrfToken }) }));
    }
    return otherHandler(url, opts);
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
