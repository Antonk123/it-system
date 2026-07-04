import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

// Ensure localStorage is available
if (typeof localStorage === 'undefined') {
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
  })();

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
  });
}

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

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
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
