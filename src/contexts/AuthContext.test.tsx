// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: {
    refreshSession: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    clearToken: vi.fn(),
  },
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

const clearAttachmentCache = vi.hoisted(() => vi.fn());
vi.mock('@/lib/secureFileAccess', () => ({ clearSecureAttachmentCache: clearAttachmentCache }));

import { api, ApiError } from '@/lib/api';
import { AuthProvider, useAuth } from './AuthContext';

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const USER = { id: 'u1', email: 'a@x.se', role: 'user' as const };

// jsdom 25 levererar inte alltid localStorage utan storage-konfig → stubba en enkel
// in-memory-variant (samma mönster som api.test.ts / secureFileAccess.test.ts).
function stubLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('completeSsoLogin', () => {
  it('refresh OK → hämtar user, sätter auth-state, returnerar true', async () => {
    (api.refreshSession as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (api.getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'u1', email: 'a@x.se', role: 'user' } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    let ok = false;
    await act(async () => { ok = await result.current.completeSsoLogin(); });
    expect(ok).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('refresh misslyckas (ingen cookie) → false, ingen getMe', async () => {
    (api.refreshSession as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const { result } = renderHook(() => useAuth(), { wrapper });
    let ok = true;
    await act(async () => { ok = await result.current.completeSsoLogin(); });
    expect(ok).toBe(false);
    expect(api.getMe).not.toHaveBeenCalled();
  });
});

describe('start (checkAuth)', () => {
  const mountAuth = async () => {
    const hook = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});
    return hook;
  };

  it('lagrad token → getMe, user sätts, inget refresh-anrop', async () => {
    localStorage.setItem('auth_token', 'token');
    mocked(api.getMe).mockResolvedValue({ user: USER });
    const { result } = await mountAuth();
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(api.refreshSession).not.toHaveBeenCalled();
  });

  it('ingen token → försöker refresh-cookien först, och getMe om den lyckas', async () => {
    mocked(api.refreshSession).mockResolvedValue(true);
    mocked(api.getMe).mockResolvedValue({ user: USER });
    const { result } = await mountAuth();
    expect(api.refreshSession).toHaveBeenCalledTimes(1);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('ingen token och ingen giltig cookie → utloggad utan getMe, laddningen slutar', async () => {
    mocked(api.refreshSession).mockResolvedValue(false);
    const { result } = await mountAuth();
    expect(api.getMe).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('blockerad localStorage → laddningen slutar ändå (ingen evig spinner)', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
      setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
      removeItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    });
    mocked(api.refreshSession).mockResolvedValue(false);
    const { result } = await mountAuth();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it.each([401, 403])('getMe avvisas med %i → token rensas', async (status) => {
    localStorage.setItem('auth_token', 'token');
    mocked(api.getMe).mockRejectedValue(new ApiError('Ogiltig token', status));
    const { result } = await mountAuth();
    expect(api.clearToken).toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it.each([
    ['nätverksfel', new TypeError('Failed to fetch')],
    ['serverfel 503', new ApiError('Nere', 503)],
  ])('getMe misslyckas med %s → token behålls och ett tillfälligt fel visas', async (_label, error) => {
    localStorage.setItem('auth_token', 'token');
    mocked(api.getMe).mockRejectedValue(error);
    const { result } = await mountAuth();
    expect(api.clearToken).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('transient refresh-fel utan token → ingen utloggning, felet visas', async () => {
    mocked(api.refreshSession).mockRejectedValue(new ApiError('Nere', 502));
    const { result } = await mountAuth();
    expect(api.clearToken).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});

describe('refreshUser', () => {
  it('hämtar användaren på nytt (t.ex. efter lösenordsbyte)', async () => {
    localStorage.setItem('auth_token', 'token');
    mocked(api.getMe).mockResolvedValueOnce({ user: { ...USER, mustChangePassword: true } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});
    expect(result.current.user?.mustChangePassword).toBe(true);

    mocked(api.getMe).mockResolvedValueOnce({ user: { ...USER, mustChangePassword: false } });
    await act(async () => { await result.current.refreshUser(); });
    expect(result.current.user?.mustChangePassword).toBe(false);
  });
});

describe('signOut', () => {
  it('loggar ut, tömmer bilage-cachen och nollställer användaren', async () => {
    localStorage.setItem('auth_token', 'token');
    mocked(api.getMe).mockResolvedValue({ user: USER });
    mocked(api.logout).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});
    await act(async () => { await result.current.signOut(); });
    expect(api.logout).toHaveBeenCalled();
    expect(clearAttachmentCache).toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
  });
});

describe('completeSsoLogin vid transient fel', () => {
  it('refresh kastar → false, inget uncaught', async () => {
    mocked(api.refreshSession).mockRejectedValue(new ApiError('Nere', 502));
    const { result } = renderHook(() => useAuth(), { wrapper });
    let ok = true;
    await act(async () => { ok = await result.current.completeSsoLogin(); });
    expect(ok).toBe(false);
  });
});
