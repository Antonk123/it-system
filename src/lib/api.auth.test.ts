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
 *  5. Refresh-deduplicering (tryRefresh): N samtidiga 401:or delar EN pågående
 *     /auth/refresh — inte N separata anrop. Servern roterar refresh-token atomiskt
 *     (DELETE + INSERT i samma transaktion), så parallella anrop med samma cookie
 *     skulle annars ogiltigförklara varandra (första lyckas, resten får "Invalid
 *     refresh token") → falsk utloggning. Spärren (this.refreshPromise) nollställs
 *     alltid när förnyelsen är klar (finally), så en senare, separat 401-cykel gör
 *     ett nytt, riktigt anrop.
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

// Default pathname="/login" (ingen query) håller de befintliga testerna i
// den här filen (som bara bryr sig om ATT redirecten sker, inte om
// returnTo-detaljer) exakt vid "/login" — sessionExpired() lägger bara på
// ?returnTo= när `here` INTE redan börjar med /login. Se api.test.ts:s
// egen stubLocation för de tester som exercisar returnTo-varianten.
function stubLocation(pathname = '/login', search = '') {
  const loc = { href: '', pathname, search };
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

// ---------------------------------------------------------------------------
// 4. Refresh-deduplicering — N samtidiga 401:or delar EN pågående /auth/refresh
// ---------------------------------------------------------------------------

// Manuellt styrd promise — låter testet bestämma exakt NÄR ett fetch-svar
// blir klart, istället för att förlita sig på setTimeout/väggklocka.
function deferredResponse() {
  let resolve!: (value: ReturnType<typeof fakeResponse>) => void;
  const promise = new Promise<ReturnType<typeof fakeResponse>>((res) => { resolve = res; });
  return { promise, resolve };
}

// Flusha microtask-kön ett antal varv. await-kedjan fetch → response.ok-koll →
// this.tryRefresh() består bara av microtasks (inga timers), så det här är
// deterministiskt — inte tidskänsligt.
async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

const FAR_FUTURE_EXP = () => (Date.now() + 3_600_000) / 1000; // 1h kvar — ingen proaktiv refresh

describe('tryRefresh-deduplicering — samtidiga 401:or delar EN förnyelse', () => {
  it('N samtidiga request()-anrop får 401 → exakt ETT /auth/refresh, alla N retryar och lyckas med ny token', async () => {
    localStorage.setItem('auth_token', makeToken(FAR_FUTURE_EXP()));
    const freshToken = 'delad-fresh-token';
    const N = 4;

    const initial = Array.from({ length: N }, () => deferredResponse());
    const retry = Array.from({ length: N }, () => deferredResponse());
    const refresh = deferredResponse();
    const attempts = new Array(N).fill(0);
    let refreshCalls = 0;

    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        refreshCalls++;
        return refresh.promise;
      }
      const m = /\/thing-(\d+)$/.exec(url);
      const idx = Number(m![1]);
      attempts[idx]++;
      return attempts[idx] === 1 ? initial[idx].promise : retry[idx].promise;
    });

    const api = await freshApi();
    const calls = Array.from({ length: N }, (_, i) => api.request<{ ok: boolean; idx: number }>(`/thing-${i}`));

    await flushMicrotasks();
    initial.forEach((d) => d.resolve(fakeResponse({ ok: false, status: 401 })));
    await flushMicrotasks();

    // Alla N har nu fått 401 och anropat tryRefresh() — men bara ETT har faktiskt nått fetch().
    expect(refreshCalls).toBe(1);

    refresh.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: freshToken }) }));
    await flushMicrotasks();
    retry.forEach((d, i) => d.resolve(fakeResponse({ json: () => Promise.resolve({ ok: true, idx: i }) })));

    const results = await Promise.all(calls);

    expect(refreshCalls).toBe(1); // fortfarande bara ett anrop totalt
    results.forEach((r, i) => expect(r).toEqual({ ok: true, idx: i }));

    // Alla N retry-anrop bar den NYA, delade token
    for (let i = 0; i < N; i++) {
      const retryCall = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/thing-${i}`)[1];
      expect(headersOfCall(retryCall)['Authorization']).toBe(`Bearer ${freshToken}`);
    }
  });

  it('om den delade förnyelsen failar → alla N går session-expired-vägen, fortfarande bara ETT refresh-anrop', async () => {
    localStorage.setItem('auth_token', makeToken(FAR_FUTURE_EXP()));
    const N = 3;

    const initial = Array.from({ length: N }, () => deferredResponse());
    const refresh = deferredResponse();
    const attempts = new Array(N).fill(0);
    let refreshCalls = 0;

    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        refreshCalls++;
        return refresh.promise;
      }
      const m = /\/thing-(\d+)$/.exec(url);
      const idx = Number(m![1]);
      attempts[idx]++;
      return initial[idx].promise; // ingen retry förväntas nå fram
    });

    const api = await freshApi();
    const calls = Array.from({ length: N }, (_, i) => api.request(`/thing-${i}`).catch((e: unknown) => e as Error));

    await flushMicrotasks();
    initial.forEach((d) => d.resolve(fakeResponse({ ok: false, status: 401 })));
    await flushMicrotasks();

    expect(refreshCalls).toBe(1);

    refresh.resolve(fakeResponse({ ok: false, status: 401 })); // den delade förnyelsen failar
    const results = await Promise.all(calls);

    expect(refreshCalls).toBe(1); // fortfarande bara ett — trots N väntande anropare
    results.forEach((r) => {
      expect(r).toBeInstanceOf(Error);
      expect((r as Error).message).toBe('Session expired');
    });
    expect(window.location.href).toBe('/login');
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('en förnyelse som startar EFTER att den förra är helt klar ger ett NYTT anrop — spärren fastnar inte', async () => {
    localStorage.setItem('auth_token', makeToken(FAR_FUTURE_EXP()));
    const firstFreshToken = 'forsta-fresh-token';
    const secondFreshToken = 'andra-fresh-token';

    let thingAttempts = 0;
    let refreshCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        refreshCalls++;
        const token = refreshCalls === 1 ? firstFreshToken : secondFreshToken;
        return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: token }) }));
      }
      thingAttempts++;
      // 1:a och 3:e anropet (varje cykels första försök) nekas, resten lyckas.
      if (thingAttempts === 1 || thingAttempts === 3) {
        return Promise.resolve(fakeResponse({ ok: false, status: 401 }));
      }
      return Promise.resolve(fakeResponse({ json: () => Promise.resolve({ ok: true }) }));
    });

    const api = await freshApi();

    await api.request('/thing');
    expect(refreshCalls).toBe(1);
    expect(localStorage.getItem('auth_token')).toBe(firstFreshToken);

    // Helt separat, senare 401-cykel — den delade förnyelsen ovan är för länge sedan klar
    // (this.refreshPromise nollställdes i finally). Spärren får inte återanvända den.
    await api.request('/thing');
    expect(refreshCalls).toBe(2); // nytt, riktigt anrop
    expect(localStorage.getItem('auth_token')).toBe(secondFreshToken);
  });

  it('request() och requestBlob() samtidigt delar samma refresh-spärr', async () => {
    localStorage.setItem('auth_token', makeToken(FAR_FUTURE_EXP()));
    const freshToken = 'blandad-fresh-token';

    const reqInitial = deferredResponse();
    const reqRetry = deferredResponse();
    const blobInitial = deferredResponse();
    const blobRetry = deferredResponse();
    const refresh = deferredResponse();
    let reqAttempts = 0;
    let blobAttempts = 0;
    let refreshCalls = 0;

    fetchMock.mockImplementation((url: string) => {
      if (url === `${BASE}/auth/refresh`) {
        refreshCalls++;
        return refresh.promise;
      }
      if (url === `${BASE}/mixed-request`) {
        reqAttempts++;
        return reqAttempts === 1 ? reqInitial.promise : reqRetry.promise;
      }
      if (url === `${BASE}/mixed-blob`) {
        blobAttempts++;
        return blobAttempts === 1 ? blobInitial.promise : blobRetry.promise;
      }
      throw new Error(`Oväntad URL i test: ${url}`);
    });

    const api = await freshApi();
    const reqCall = api.request<{ ok: boolean }>('/mixed-request');
    const blobCall = api.requestBlob('/mixed-blob');

    await flushMicrotasks();
    reqInitial.resolve(fakeResponse({ ok: false, status: 401 }));
    blobInitial.resolve(fakeResponse({ ok: false, status: 401 }));
    await flushMicrotasks();

    // Två helt olika ingångar (request/requestBlob), samtidigt — ändå EN delad förnyelse.
    expect(refreshCalls).toBe(1);

    refresh.resolve(fakeResponse({ json: () => Promise.resolve({ accessToken: freshToken }) }));
    await flushMicrotasks();
    reqRetry.resolve(fakeResponse({ json: () => Promise.resolve({ ok: true }) }));
    blobRetry.resolve(fakeResponse({ blob: () => Promise.resolve(new Blob(['data'])) }));

    const [reqResult] = await Promise.all([reqCall, blobCall]);

    expect(refreshCalls).toBe(1);
    expect(reqResult).toEqual({ ok: true });

    const reqRetryCall = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/mixed-request`)[1];
    const blobRetryCall = fetchMock.mock.calls.filter((c) => urlOfCall(c) === `${BASE}/mixed-blob`)[1];
    expect(headersOfCall(reqRetryCall)['Authorization']).toBe(`Bearer ${freshToken}`);
    expect(headersOfCall(blobRetryCall)['Authorization']).toBe(`Bearer ${freshToken}`);
  });
});
