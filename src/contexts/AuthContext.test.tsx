// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    refreshSession: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import { AuthProvider, useAuth } from './AuthContext';

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
