// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Layout pulls in several heavy children (command palette, FAB, tab bar,
// onboarding wizard) with their own data/auth dependencies that are
// irrelevant to this a11y-structure test — stub them out.
vi.mock('@/components/CommandPalette', () => ({
  CommandPalette: () => null,
}));
vi.mock('@/components/QuickCaptureFAB', () => ({
  QuickCaptureFAB: () => null,
}));
vi.mock('@/components/BottomTabBar', () => ({
  BottomTabBar: () => null,
}));
vi.mock('@/components/OnboardingWizard', () => ({
  OnboardingWizard: () => null,
}));
vi.mock('@/components/RouteBreadcrumbs', () => ({
  RouteBreadcrumbs: () => null,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ signOut: vi.fn(), user: { email: 'test@example.com' } }),
}));

import { Layout } from './Layout';

// vitest-jsdom-miljön exponerar ingen fungerande window.localStorage
// (accessorn följer inte med i global-kopieringen, oavsett jsdom-version)
// — Layout läser theme-läget därifrån vid mount, så stubba den.
beforeAll(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
  });
});

afterEach(cleanup);

function renderLayout() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Layout>
          <div>innehåll</div>
        </Layout>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('"Nytt ärende" — a11y-struktur (audit v5 MEDIUM-4/5)', () => {
  it('renderas som en enda länk med accessible name "Nytt ärende"', () => {
    renderLayout();
    const link = screen.getByRole('link', { name: 'Nytt ärende' });
    expect(link.tagName).toBe('A');
  });

  it('innehåller ingen nästlad <button>', () => {
    renderLayout();
    const link = screen.getByRole('link', { name: 'Nytt ärende' });
    expect(link.querySelector('button')).toBeNull();
  });

  it('har href="/tickets/new"', () => {
    renderLayout();
    const link = screen.getByRole('link', { name: 'Nytt ärende' });
    expect(link).toHaveAttribute('href', '/tickets/new');
  });

  it('behåller accessible name i kollapsat läge, där aria-label är enda namnet', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Dölj sidofält' }));
    const link = screen.getByRole('link', { name: 'Nytt ärende' });
    // Texten är unmountad i kollapsat läge — namnet måste komma från aria-label
    expect(link.querySelector('span')).toBeNull();
  });

  it('stänger mobil-drawern när "Nytt ärende" klickas', () => {
    renderLayout();
    // X-knappen i drawern är alltid i DOM (döljs med CSS); overlayn är villkorad
    // på sidebarOpen — så öppen drawer = 2 "Stäng meny", stängd = 1.
    fireEvent.click(screen.getByRole('button', { name: 'Öppna meny' }));
    expect(screen.getAllByRole('button', { name: 'Stäng meny' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('link', { name: 'Nytt ärende' }));
    expect(screen.getAllByRole('button', { name: 'Stäng meny' })).toHaveLength(1);
  });
});
