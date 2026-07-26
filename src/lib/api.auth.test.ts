// @vitest-environment jsdom
/**
 * Tester för token-livscykeln i API-klienten (src/lib/api.ts):
 *  1. isTokenExpired() — testas indirekt via getFreshToken()/request(): 30s-marginalen,
 *     saknad `exp`, trasig/odekodbar token.
 *  2. Proaktiv förnyelse (getFreshToken, isRetry=false): en token inom 30s från utgång
 *     ska trigga ett /auth/refresh INNAN själva anropet — och den NYA token ska hamna
 *     i Authorization-headern på det anrop som faktiskt går ut.
 *  3. Retry-spärren (isRetry=true): på retry-varvet (efter ett 401 → refresh → retry)
 *     ska proaktiv-refresh-kollen inte köras igen, även om den nya token också råkar
 *     vara nära utgång — annars dubbla /auth/refresh på samma request-cykel.
 *  4. Samma mekanik gäller alla tre ingångarna: request(), requestBlob(), uploadFile().
 *
 * OBS — känd bugg som INTE ska cementeras här: N parallella 401:or ger N separata
 * /auth/refresh-anrop (ingen deduplicering), vilket kan trigga oväntad utloggning pga
 * atomisk refresh-token-rotation på backend. Inga tester nedan antar eller assertar att
 * detta är korrekt — vi undviker medvetet scenarier med flera samtidiga 401:or.
 *
 * Mönster (fetch-stub, localStorage-stub, färsk modul-instans) kopierat från
 * src/lib/api.test.ts — se den filen för kommentarer kring varför.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = '/api';

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  contentType?: string | null;
  text?: () => Promise<string>;
  blob?: () => Promise<Blob>;
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
    blob: init.blob ?? (() => Promise.resolve(new Blob())),
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

let fetchMock: ReturnType<typeof vi.fn>;

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
  stubLocation();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

async function freshApi() {
  const mod = await import('./api');
  return mod.api;
}

// Bygger en fejk-JWT: header.payload.sig, där payload är { exp } (i sekunder) om givet.
function makeToken(expSeconds?: number): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = expSeconds === undefined ? {} : { exp: expSeconds };
  return `${header}.${btoa(JSON.stringify(payload))}.sig`;
}

const NOW = 1_700_000_000_000; // fast referenspunkt

function freezeTime() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

// ---------------------------------------------------------------------------
// 1. isTokenExpired — 30s-marginalen, saknad exp, trasig token
// ---------------------------------------------------------------------------

describe('isTokenExpired (indirekt via proaktiv förnyelse i request())', () => {
  it('exp precis INNANFÖR 30s-marginalen → proaktiv refresh triggas, ny token används i anropet', async () => {
    freezeTime();
    const oldExpSeconds = (NOW + 29_000) / 1000; // 29s kvar → innanför 30s-marginalen
    localStorage.setItem('auth_token', makeToken(oldExpSeconds));
    const freshToken = 'ny-frasch-token';

    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: freshToken }) }));
      }
      return Promise.resolve(fakeResponse({ json: () => Promise.resolve([]) }));
    });

    const api = await freshApi();
    await api.getTickets();

    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);

    // refresh skedde FÖRE själva /tickets-anropet
    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/auth/refresh`);

    const ticketsCall = fetchMock.mock.calls.find((c) => urlOfCall(c) === `${BASE}/tickets`);
    expect(headersOfCall(ticketsCall)['Authorization']).toBe(`Bearer ${freshToken}`);
  });

  it('exp precis UTANFÖR 30s-marginalen → ingen proaktiv refresh, gamla token används', async () => {
    freezeTime();
    const expSeconds = (NOW + 31_000) / 1000; // 31s kvar → utanför marginalen
    const token = makeToken(expSeconds);
    localStorage.setItem('auth_token', token);

    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));

    const api = await freshApi();
    await api.getTickets();

    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(0);

    const ticketsCall = fetchMock.mock.calls.find((c) => urlOfCall(c) === `${BASE}/tickets`);
    expect(headersOfCall(ticketsCall)['Authorization']).toBe(`Bearer ${token}`);
  });

  it('saknad exp i payload → ingen proaktiv refresh, anropet går igenom med samma token', async () => {
    const token = makeToken(undefined); // payload = {}
    localStorage.setItem('auth_token', token);

    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));

    const api = await freshApi();
    await api.getTickets();

    expect(fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`)).toHaveLength(0);
    const ticketsCall = fetchMock.mock.calls.find((c) => urlOfCall(c) === `${BASE}/tickets`);
    expect(headersOfCall(ticketsCall)['Authorization']).toBe(`Bearer ${token}`);
  });

  it('trasig/odekodbar token → catch → ingen proaktiv refresh, anropet går igenom ändå', async () => {
    // "###" är inte giltig base64 → atob kastar → isTokenExpired() fångar och returnerar false
    const brokenToken = 'header.###.sig';
    localStorage.setItem('auth_token', brokenToken);

    fetchMock.mockResolvedValue(fakeResponse({ json: () => Promise.resolve([]) }));

    const api = await freshApi();
    await expect(api.getTickets()).resolves.toEqual([]);

    expect(fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`)).toHaveLength(0);
    const ticketsCall = fetchMock.mock.calls.find((c) => urlOfCall(c) === `${BASE}/tickets`);
    expect(headersOfCall(ticketsCall)['Authorization']).toBe(`Bearer ${brokenToken}`);
  });
});

// ---------------------------------------------------------------------------
// 2. Proaktiv förnyelse gäller även requestBlob() och uploadFile()
// ---------------------------------------------------------------------------

describe('proaktiv förnyelse i requestBlob() och uploadFile()', () => {
  it('requestBlob(): token nära utgång → refresh FÖRE anropet, ny token i Authorization', async () => {
    freezeTime();
    localStorage.setItem('auth_token', makeToken((NOW + 1_000) / 1000)); // 1s kvar
    const freshToken = 'blob-fräsch-token';

    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: freshToken }) }));
      }
      return Promise.resolve(fakeResponse({ blob: () => Promise.resolve(new Blob(['x'])) }));
    });

    const api = await freshApi();
    await api.requestBlob('/attachments/file/f1');

    expect(fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`)).toHaveLength(1);
    expect(urlOfCall(fetchMock.mock.calls[0])).toBe(`${BASE}/auth/refresh`);

    const blobCall = fetchMock.mock.calls.find((c) => urlOfCall(c) === `${BASE}/attachments/file/f1`);
    expect(headersOfCall(blobCall)['Authorization']).toBe(`Bearer ${freshToken}`);
  });

  it('uploadFile(): token nära utgång → refresh FÖRE uppladdningen, ny token i Authorization', async () => {
    freezeTime();
    localStorage.setItem('auth_token', makeToken((NOW + 1_000) / 1000)); // 1s kvar
    const freshToken = 'upload-fräsch-token';

    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/csrf-token`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ csrfToken: 'csrf-x' }) }));
      }
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: freshToken }) }));
      }
      return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ id: 'bilaga-1' }) }));
    });

    const api = await freshApi();
    const file = new File(['innehåll'], 'a.pdf', { type: 'application/pdf' });
    const result = await api.uploadFile('/tickets/t1/attachments', file);

    expect(result).toEqual({ id: 'bilaga-1' });
    expect(fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`)).toHaveLength(1);

    const uploadCall = fetchMock.mock.calls.find((c) => urlOfCall(c).endsWith('/attachments'));
    expect(headersOfCall(uploadCall)['Authorization']).toBe(`Bearer ${freshToken}`);
  });
});

// ---------------------------------------------------------------------------
// 3. Retry-spärren: isRetry=true kör inte om den proaktiva kollen
// ---------------------------------------------------------------------------

describe('retry-spärr — isRetry=true gör ingen andra proaktiv förnyelse', () => {
  it('request(): 401 → refresh → retry; den nya token är SJÄLV nära utgång men retryn refreshar inte igen', async () => {
    freezeTime();
    // Ursprunglig token: inte nära utgång (ingen proaktiv refresh vid första försöket).
    const originalToken = makeToken((NOW + 60_000) / 1000);
    localStorage.setItem('auth_token', originalToken);

    // Token som refresh ger tillbaka är MEDVETET nära utgång (skulle triggat
    // proaktiv refresh om isRetry-spärren inte fanns).
    const rotatedToken = makeToken((NOW + 1_000) / 1000);

    let ticketsCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: rotatedToken }) }));
      }
      if (url === `${BASE}/tickets`) {
        ticketsCalls++;
        if (ticketsCalls === 1) {
          // Servern nekar trots att token inte var nära utgång (t.ex. återkallad).
          return Promise.resolve(fakeResponse({ ok: false, status: 401, json: () => Promise.resolve({}) }));
        }
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve([{ id: 'retry-ok' }]) }));
      }
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    const result = await api.getTickets();

    expect(result).toEqual([{ id: 'retry-ok' }]);
    expect(ticketsCalls).toBe(2); // original + retry, ingen extra loop

    // Bara ETT /auth/refresh-anrop totalt — retryn (isRetry=true) gjorde INTE
    // en andra proaktiv förnyelse trots att rotatedToken är nära utgång.
    const refreshCalls = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`);
    expect(refreshCalls).toHaveLength(1);

    // Retry-anropet gick ut med den roterade token som den var, ej förnyad igen.
    const retryCall = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/tickets`)[1];
    expect(headersOfCall(retryCall)['Authorization']).toBe(`Bearer ${rotatedToken}`);
  });

  it('requestBlob(): samma retry-spärr — en refresh totalt trots nära-utgång-token på retryn', async () => {
    freezeTime();
    const originalToken = makeToken((NOW + 60_000) / 1000);
    localStorage.setItem('auth_token', originalToken);
    const rotatedToken = makeToken((NOW + 1_000) / 1000);

    let blobCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: rotatedToken }) }));
      }
      if (url === `${BASE}/attachments/file/f1`) {
        blobCalls++;
        if (blobCalls === 1) {
          return Promise.resolve(fakeResponse({ ok: false, status: 401, json: () => Promise.resolve({}) }));
        }
        return Promise.resolve(fakeResponse({ blob: () => Promise.resolve(new Blob(['data'])) }));
      }
      return Promise.resolve(fakeResponse({}));
    });

    const api = await freshApi();
    await api.requestBlob('/attachments/file/f1');

    expect(blobCalls).toBe(2);
    expect(fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`)).toHaveLength(1);

    const retryCall = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/attachments/file/f1`)[1];
    expect(headersOfCall(retryCall)['Authorization']).toBe(`Bearer ${rotatedToken}`);
  });

  it('uploadFile(): retryn (isRetry=true) gör ingen extra proaktiv förnyelse', async () => {
    // OBS: till skillnad från request()/requestBlob() ovan kan vi INTE göra rotatedToken
    // nära utgång här — uploadFile() cachar X-CSRF-Token, och setToken() (som körs inuti
    // tryRefresh()) nollställer alltid den cachen vid en rotation. Retryn måste då hämta en
    // ny CSRF-token via ETT EGET top-level request()-anrop (isRetry=false där, per
    // definition — det är inte samma "retry" som uploadFile-anropet). Om rotatedToken vore
    // nära utgång skulle DEN separata proaktiva kollen (helt korrekt, se sektion 1–2 ovan)
    // trigga en andra refresh — vilket INTE är samma sak som att uploadFile-nivåns egen
    // isRetry-spärr skulle ha släppt igenom en dubbelkoll. Den spärren testas isolerat i
    // request()- och requestBlob()-testerna ovan (GET/blob har ingen CSRF-sidoeffekt).
    // Här verifierar vi istället den realistiska helheten: exakt en refresh i retry-varvet.
    freezeTime();
    const originalToken = makeToken((NOW + 60_000) / 1000);
    localStorage.setItem('auth_token', originalToken);
    const rotatedToken = makeToken((NOW + 60_000) / 1000);

    let uploadCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/csrf-token`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ csrfToken: 'csrf-y' }) }));
      }
      if (url === `${BASE}/auth/refresh`) {
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: rotatedToken }) }));
      }
      uploadCalls++;
      if (uploadCalls === 1) {
        return Promise.resolve(fakeResponse({ ok: false, status: 401, json: () => Promise.resolve({}) }));
      }
      return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ id: 'ok-efter-retry' }) }));
    });

    const api = await freshApi();
    const file = new File(['x'], 'b.pdf', { type: 'application/pdf' });
    const result = await api.uploadFile('/tickets/t1/attachments', file);

    expect(result).toEqual({ id: 'ok-efter-retry' });
    expect(uploadCalls).toBe(2);
    expect(fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/auth/refresh`)).toHaveLength(1);

    const retryCall = fetchMock.mock.calls.filter((c) => urlOfCall(c).endsWith('/attachments'))[1];
    expect(headersOfCall(retryCall)['Authorization']).toBe(`Bearer ${rotatedToken}`);
  });
});
