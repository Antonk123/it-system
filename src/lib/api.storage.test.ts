// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let store: Map<string, string>;
let blocked: { read: boolean; write: boolean; remove: boolean };
let serverToken: string | null;
let calls: { path: string; authorization: string | undefined }[];
let storageListenerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  storageListenerSpy = vi.spyOn(window, 'addEventListener');
  store = new Map();
  blocked = { read: false, write: false, remove: false };
  serverToken = 'login-token';
  calls = [];
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => { if (blocked.read) throw new Error('Storage blocked'); return store.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (blocked.write) throw new Error('Storage full'); store.set(key, value); },
    removeItem: (key: string) => { if (blocked.remove) throw new Error('Storage blocked'); store.delete(key); },
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    const path = url.replace(/^\/api/, '');
    const authorization = (options.headers as Record<string, string>)?.Authorization;
    calls.push({ path, authorization });
    if (path === '/csrf-token') return Response.json({ csrfToken: 'fixture-csrf' });
    if (path === '/auth/login') return Response.json({ token: serverToken, user: { id: 'staff' } });
    if (path === '/auth/refresh') {
      if (!serverToken) return Response.json({ error: 'Signed out' }, { status: 401 });
      serverToken = 'refreshed-token';
      return Response.json({ accessToken: serverToken });
    }
    if (path === '/auth/logout') { serverToken = null; return Response.json({ message: 'Signed out' }); }
    if (path === '/auth/me') return authorization === `Bearer ${serverToken}`
      ? Response.json({ user: { id: 'staff' } })
      : Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (path === '/probe') return Response.json({ authorization: authorization ?? null });
    throw new Error(`Unexpected fixture request: ${path}`);
  }));
});

afterEach(() => {
  for (const [type, listener] of storageListenerSpy.mock.calls) {
    if (type === 'storage') window.removeEventListener('storage', listener as EventListener);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});
const freshApi = async () => (await import('./api')).api;
const probe = (api: Awaited<ReturnType<typeof freshApi>>) => api.request<{ authorization: string | null }>('/probe', { skipAuthRefresh: true });

describe('authentication with unavailable browser persistence', () => {
  it('uses a successful login for authenticated requests when reads and writes throw', async () => {
    blocked = { read: true, write: true, remove: true };
    const api = await freshApi();
    await api.login('staff@example.test', 'fixture-password');
    expect(await api.getMe()).toEqual({ user: { id: 'staff' } });
    expect(calls.filter(call => call.path === '/auth/me')).toEqual([{ path: '/auth/me', authorization: 'Bearer login-token' }]);
    expect(calls.some(call => call.path === '/auth/refresh')).toBe(false);
  });

  it('uses the refreshed token on the original request retry when storage throws', async () => {
    blocked = { read: true, write: true, remove: true };
    const api = await freshApi();
    expect(await api.getMe()).toEqual({ user: { id: 'staff' } });
    expect(calls.map(call => [call.path, call.authorization])).toEqual([
      ['/auth/me', undefined], ['/auth/refresh', undefined], ['/auth/me', 'Bearer refreshed-token'],
    ]);
  });

  it('retains the new token when a readable storage cannot replace an older token, then resumes normal cross-tab reads after recovery', async () => {
    store.set('auth_token', 'stale-persisted-token');
    blocked.write = true;
    const api = await freshApi();
    api.setToken('new-memory-token');
    expect(await probe(api)).toEqual({ authorization: 'Bearer new-memory-token' });
    expect(store.get('auth_token')).toBe('stale-persisted-token');
    blocked.write = false;
    expect(await probe(api)).toEqual({ authorization: 'Bearer new-memory-token' });
    expect(store.get('auth_token')).toBe('new-memory-token');
    store.delete('auth_token');
    expect(await probe(api)).toEqual({ authorization: null });
    store.set('auth_token', 'another-tab-token');
    expect(await probe(api)).toEqual({ authorization: 'Bearer another-tab-token' });
  });

  it.each(['auth_token', null])('honors a later cross-tab logout (%s) before retrying a failed token write', async key => {
    store.set('auth_token', 'persisted-token');
    blocked.write = true;
    const api = await freshApi();
    api.setToken('pending-memory-token');
    if (key === null) store.clear();
    else store.delete(key);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: null }));
    blocked.write = false;
    expect(await probe(api)).toEqual({ authorization: null });
    expect(store.has('auth_token')).toBe(false);
  });

  it('adopts a newer cross-tab token before retrying a failed token write', async () => {
    store.set('auth_token', 'persisted-token');
    blocked.write = true;
    const api = await freshApi();
    api.setToken('pending-memory-token');
    store.set('auth_token', 'external-token');
    window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token', newValue: 'external-token' }));
    blocked.write = false;
    blocked.read = true; // The event must also update the in-memory fallback.
    expect(await probe(api)).toEqual({ authorization: 'Bearer external-token' });
    expect(store.get('auth_token')).toBe('external-token');
  });

  it('adopts a cross-tab login after a failed local logout removal', async () => {
    const api = await freshApi();
    api.setToken('persisted-token');
    blocked.remove = true;
    api.clearToken();
    store.set('auth_token', 'external-login-token');
    window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token', newValue: 'external-login-token' }));
    blocked.remove = false;
    expect(await probe(api)).toEqual({ authorization: 'Bearer external-login-token' });
    expect(store.get('auth_token')).toBe('external-login-token');
  });

  it('listens once only while persistence is pending and ignores unrelated storage events', async () => {
    const removeListener = vi.spyOn(window, 'removeEventListener');
    blocked.write = true;
    const api = await freshApi();
    api.setToken('pending-token');
    api.setToken('newer-pending-token');
    expect(storageListenerSpy.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token', newValue: null, storageArea: sessionStorage }));
    expect(await probe(api)).toEqual({ authorization: 'Bearer newer-pending-token' });
    blocked.write = false;
    expect(await probe(api)).toEqual({ authorization: 'Bearer newer-pending-token' });
    expect(removeListener).toHaveBeenCalledWith('storage', expect.any(Function));
  });

  it('does not resurrect a stored token after clearToken fails to remove it', async () => {
    const api = await freshApi();
    api.setToken('stored-token');
    blocked.remove = true;
    api.clearToken();
    expect(await probe(api)).toEqual({ authorization: null });
    expect(store.get('auth_token')).toBe('stored-token');
    blocked.remove = false;
    expect(await probe(api)).toEqual({ authorization: null });
    expect(store.has('auth_token')).toBe(false);
  });

  it('logout clears the in-memory token even when all storage operations throw', async () => {
    blocked = { read: true, write: true, remove: true };
    const api = await freshApi();
    await api.login('staff@example.test', 'fixture-password');
    expect(await probe(api)).toEqual({ authorization: 'Bearer login-token' });
    await api.logout();
    expect(await probe(api)).toEqual({ authorization: null });
    expect(serverToken).toBeNull();
  });

  it('also works when accessing the localStorage property itself throws', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage denied'); } });
    const api = await freshApi();
    await api.login('staff@example.test', 'fixture-password');
    expect(await api.getMe()).toEqual({ user: { id: 'staff' } });
  });
});
