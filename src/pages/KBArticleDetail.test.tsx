// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import KBArticleDetail from './KBArticleDetail';
import { kbArticleKeys, type KbArticleData } from '@/hooks/useKbArticle';

const mocks = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'user',
  api: {
    getKbArticle: vi.fn(),
    getKbArticleShare: vi.fn(),
    getArticleLinkedTickets: vi.fn(),
    getKbArticleLinks: vi.fn(),
    createKbArticleShare: vi.fn(),
    revokeKbArticleShare: vi.fn(),
    reviewKbArticle: vi.fn(),
    deleteKbArticle: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mocks.api }));
vi.mock('@/components/HtmlRenderer', () => ({ HtmlRenderer: () => null }));
vi.mock('@/components/KBImageLightbox', () => ({ KBImageLightbox: () => null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: mocks.role } }) }));
vi.mock('@/lib/recentlyViewed', () => ({ addRecentlyViewedKB: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const article = {
  id: 'a1', title: 'Skrivare', content: '<p>x</p>', category_id: 'c1', category_name: 'Hårdvara', category_color: null,
  status: 'published', tags: [], created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z', last_reviewed_at: null,
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/kb/a1']}>
        <Routes><Route path="/kb/:id" element={<KBArticleDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'admin';
  mocks.api.getKbArticle.mockResolvedValue(article);
  mocks.api.getKbArticleShare.mockResolvedValue({ share_token: null });
  mocks.api.getArticleLinkedTickets.mockResolvedValue([]);
  mocks.api.getKbArticleLinks.mockResolvedValue([]);
});
afterEach(cleanup);

describe('KBArticleDetail', () => {
  it('uppdaterar delningsstatus i query-cachen när artikeln delas', async () => {
    mocks.api.createKbArticleShare.mockResolvedValue({ share_token: 'tok123' });
    const client = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Dela' }));

    expect(await screen.findByRole('button', { name: 'Delad' })).toBeInTheDocument();
    expect(client.getQueryData<KbArticleData>(kbArticleKeys.detail('a1'))?.shareToken).toBe('tok123');
  });

  it('skriver granskningsdatum till cachen när artikeln markeras som granskad', async () => {
    mocks.api.reviewKbArticle.mockResolvedValue({ last_reviewed_at: '2026-09-08T10:00:00Z' });
    const client = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Markera som granskad/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Granskad/ })).toBeInTheDocument());
    expect(client.getQueryData<KbArticleData>(kbArticleKeys.detail('a1'))?.article.last_reviewed_at).toBe('2026-09-08T10:00:00Z');
  });

  it('hämtar inte delningsstatus och döljer admin-åtgärder för vanliga användare', async () => {
    mocks.role = 'user';
    setup();

    expect(await screen.findByRole('heading', { name: 'Skrivare' })).toBeInTheDocument();
    expect(mocks.api.getKbArticleShare).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Dela' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Redigera/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Markera som granskad/ })).toBeNull();
  });
});
