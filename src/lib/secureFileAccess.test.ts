/**
 * Tester för secureFileAccess.ts
 *
 * Filen använder browser-API:er (fetch, localStorage, URL.createObjectURL/revokeObjectURL,
 * document.createElement). Vi mockar dessa med vi.fn() och vi.stubGlobal.
 *
 * OBS: URL-konstruktorn lämnas orörd (vi stub:ar bara createObjectURL/revokeObjectURL
 * som statiska metoder). document-anrop (createElement, body) stub:as där de behövs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hjälpare
// ---------------------------------------------------------------------------

function makeFetchMock(options: { ok: boolean; status?: number; blob?: Blob }) {
  const blob = options.blob ?? new Blob(['innehåll'], { type: 'text/plain' });
  return vi.fn().mockResolvedValue({
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 403),
    statusText: options.ok ? 'OK' : 'Forbidden',
    blob: () => Promise.resolve(blob),
    json: () => Promise.resolve({ accessToken: 'nytt-token' }),
  });
}

// ---------------------------------------------------------------------------
// Setup — mocka browser-globals PER TEST (vi.resetModules i afterEach)
// ---------------------------------------------------------------------------

let urlCounter = 0;
const createObjectURLMock = vi.fn(() => `blob:mock-${++urlCounter}`);
const revokeObjectURLMock = vi.fn();

beforeEach(() => {
  urlCounter = 0;

  // localStorage
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  });

  // Mocka createObjectURL / revokeObjectURL som statiska metoder på URL-klassen
  // (undvik att ersätta hela URL-objektet så att new URL(...) fortfarande fungerar)
  URL.createObjectURL = createObjectURLMock;
  URL.revokeObjectURL = revokeObjectURLMock;

  vi.clearAllMocks();
  urlCounter = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// revokeBlobUrl
// ---------------------------------------------------------------------------

describe('revokeBlobUrl', () => {
  it('anropar URL.revokeObjectURL och tar bort cachen när fileId finns i cache', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ ok: true }));

    const { getAuthenticatedFileUrl, revokeBlobUrl } = await import('./secureFileAccess');

    const blobUrl = await getAuthenticatedFileUrl('fil-001');
    expect(typeof blobUrl).toBe('string');
    expect(blobUrl).toMatch(/^blob:/);

    revokeObjectURLMock.mockClear();
    revokeBlobUrl('fil-001');
    expect(revokeObjectURLMock).toHaveBeenCalledWith(blobUrl);

    // Andra anrop med samma id ska inte anropa revokeObjectURL igen (cache borttagen)
    revokeObjectURLMock.mockClear();
    revokeBlobUrl('fil-001');
    expect(revokeObjectURLMock).not.toHaveBeenCalled();
  });

  it('gör ingenting (kastar inte) om fileId inte finns i cache', async () => {
    const { revokeBlobUrl } = await import('./secureFileAccess');
    expect(() => revokeBlobUrl('okänt-id')).not.toThrow();
    expect(revokeObjectURLMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getAuthenticatedFileUrl
// ---------------------------------------------------------------------------

describe('getAuthenticatedFileUrl', () => {
  it('returnerar blob-URL för lyckad fetch', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ ok: true }));
    const { getAuthenticatedFileUrl } = await import('./secureFileAccess');

    const url = await getAuthenticatedFileUrl('fil-lyckad');
    expect(url).toMatch(/^blob:/);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it('returnerar cachad URL vid andra anropet (fetch kallas bara en gång)', async () => {
    const fetchMock = makeFetchMock({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { getAuthenticatedFileUrl } = await import('./secureFileAccess');

    const url1 = await getAuthenticatedFileUrl('fil-cache');
    const url2 = await getAuthenticatedFileUrl('fil-cache');

    expect(url1).toBe(url2);
    // fetch ska bara ha kallats en gång (cache-träff vid andra anropet)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skickar Authorization-header när token finns i localStorage', async () => {
    localStorage.setItem('auth_token', 'mitt-jwt-token');
    const fetchMock = makeFetchMock({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { getAuthenticatedFileUrl } = await import('./secureFileAccess');

    await getAuthenticatedFileUrl('fil-auth');

    const anrop = fetchMock.mock.calls[0];
    expect(anrop[1]?.headers?.['Authorization']).toBe('Bearer mitt-jwt-token');
  });

  it('kastar Error när servern svarar med icke-ok status', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ ok: false, status: 404 }));
    const { getAuthenticatedFileUrl } = await import('./secureFileAccess');

    await expect(getAuthenticatedFileUrl('fil-404')).rejects.toThrow('Failed to fetch file');
  });

  it('försöker refresh-token vid 401 och lyckas sedan', async () => {
    let anropNummer = 0;
    const fetchMock = vi.fn().mockImplementation((_url: string) => {
      anropNummer++;
      if (anropNummer === 1) {
        // Första anropet — 401
        return Promise.resolve({
          ok: false, status: 401, statusText: 'Unauthorized',
          blob: () => Promise.resolve(new Blob()),
          json: () => Promise.resolve({}),
        });
      }
      if (anropNummer === 2) {
        // Refresh-anropet — lyckas
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          blob: () => Promise.resolve(new Blob()),
          json: () => Promise.resolve({ accessToken: 'nytt-token' }),
        });
      }
      // Retry-anropet med nytt token
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        blob: () => Promise.resolve(new Blob(['data'], { type: 'text/plain' })),
        json: () => Promise.resolve({}),
      });
    });

    vi.stubGlobal('fetch', fetchMock);
    const { getAuthenticatedFileUrl } = await import('./secureFileAccess');

    const url = await getAuthenticatedFileUrl('fil-refresh');
    expect(url).toMatch(/^blob:/);
    // fetch ska ha kallats 3 gånger: original + refresh + retry
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem('auth_token')).toBe('nytt-token');
  });

  it('kastar Error när refresh-token misslyckas och original är 401', async () => {
    let anropNummer = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      anropNummer++;
      if (anropNummer === 1) {
        return Promise.resolve({
          ok: false, status: 401, statusText: 'Unauthorized',
          blob: () => Promise.resolve(new Blob()),
          json: () => Promise.resolve({}),
        });
      }
      // Refresh misslyckas också
      return Promise.resolve({
        ok: false, status: 401, statusText: 'Unauthorized',
        blob: () => Promise.resolve(new Blob()),
        json: () => Promise.resolve({}),
      });
    });

    vi.stubGlobal('fetch', fetchMock);
    const { getAuthenticatedFileUrl } = await import('./secureFileAccess');

    await expect(getAuthenticatedFileUrl('fil-refresh-fail')).rejects.toThrow('Failed to fetch file');
  });
});

// ---------------------------------------------------------------------------
// downloadAuthenticatedFile
// ---------------------------------------------------------------------------

describe('downloadAuthenticatedFile', () => {
  it('skapar länk-element, klickar och återkallar blob-URL', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ ok: true }));

    const clickMock = vi.fn();
    const appendChildMock = vi.fn();
    const removeChildMock = vi.fn();
    const linkEl = { href: '', download: '', click: clickMock };

    vi.stubGlobal('document', {
      createElement: vi.fn(() => linkEl),
      body: { appendChild: appendChildMock, removeChild: removeChildMock },
    });

    const { downloadAuthenticatedFile } = await import('./secureFileAccess');
    await downloadAuthenticatedFile('fil-dl', 'rapport.pdf');

    expect(document.createElement).toHaveBeenCalledWith('a');
    expect(linkEl.download).toBe('rapport.pdf');
    expect(clickMock).toHaveBeenCalledTimes(1);
    expect(removeChildMock).toHaveBeenCalledWith(linkEl);
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it('kastar Error när nedladdnings-fetch misslyckas', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ ok: false, status: 500 }));
    vi.stubGlobal('document', {
      createElement: vi.fn(),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    const { downloadAuthenticatedFile } = await import('./secureFileAccess');
    await expect(downloadAuthenticatedFile('fil-err', 'fil.pdf')).rejects.toThrow('Failed to download file');
  });

  it('hämtar alltid filen från servern — ignorerar blob-cachen', async () => {
    const fetchMock = makeFetchMock({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ href: '', download: '', click: vi.fn() })),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    const { getAuthenticatedFileUrl, downloadAuthenticatedFile } = await import('./secureFileAccess');
    await getAuthenticatedFileUrl('fil-frisk');

    // Nollställ räknaren
    fetchMock.mockClear();

    // Download ska alltid göra ett nytt fetch-anrop (ignorerar cachen)
    await downloadAuthenticatedFile('fil-frisk', 'cached.pdf');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
