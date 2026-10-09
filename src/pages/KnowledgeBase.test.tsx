// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import KnowledgeBase from './KnowledgeBase';
import type { KbArticlesParams } from '@/hooks/useKbArticles';

const data = vi.hoisted(() => ({
  calls: vi.fn(),
  role: 'user' as 'user' | 'admin',
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  categories: [{ id: 'phone', name: 'Telefoni', article_count: 1 }, { id: 'office', name: 'Office', article_count: 1 }],
  articles: [
    { id: 'one', title: 'Kom igång med mobilen', preview: 'Mobil & support', category_id: 'phone', category_name: 'Telefoni', article_type: 'how-to', updated_at: '2026-09-08', created_at: '2026-09-08' },
    { id: 'two', title: 'Office på datorn', preview: 'Office <img src=x onerror=alert(1)>', category_id: 'office', category_name: 'Office', article_type: 'solution', updated_at: '2026-09-08', created_at: '2026-09-08' },
  ],
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: data.role } }) }));
vi.mock('@/components/KBImportDialog', () => ({ KBImportDialog: () => null }));
vi.mock('@/components/KBPortalShareDialog', () => ({ KBPortalShareDialog: () => null }));
vi.mock('@/components/KBTagSettings', () => ({ KBTagSettings: () => null }));
vi.mock('@/hooks/useKbCategories', () => ({
  invalidateKbCaches: vi.fn(),
  useKbCategories: () => ({ categories: data.categories, createCategory: vi.fn(), updateCategory: vi.fn(), deleteCategory: vi.fn() }),
}));
vi.mock('@/hooks/useKbArticles', () => ({ useKbArticles: (params: KbArticlesParams) => {
  data.calls(params);
  return { articles: data.articles.filter(article => (!params.category_id || article.category_id === params.category_id)
    && (!params.article_type || article.article_type === params.article_type)
    && (!params.search || article.preview.toLowerCase().includes(params.search.toLowerCase()))),
  total: data.articles.length, hasNextPage: data.hasNextPage, fetchNextPage: data.fetchNextPage, isFetchingNextPage: false,
  isLoading: false, isError: false, refetch: vi.fn() };
} }));
function Location() { const location = useLocation(); return <output aria-label="Adress">{location.pathname}{location.search}</output>; }
function renderAt(path = '/kb') {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><KnowledgeBase /><Location /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  data.calls.mockClear();
  data.fetchNextPage.mockClear();
  data.role = 'user';
  data.hasNextPage = false;
  vi.stubGlobal('matchMedia', () => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Kunskapsbasens listning', () => {
  it('visar alla artiklar från start utan att välja första kategorin och visar kategori på korten', () => {
    renderAt();
    expect(screen.getByRole('heading', { name: 'Alla artiklar' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Kom igång med mobilen' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Office på datorn' })).toBeTruthy();
    expect(screen.getByLabelText('Adress')).toHaveTextContent('/kb');
    expect(data.calls).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: undefined }));
    expect(screen.getByText('Mobil & support')).toBeTruthy();
  });

  it('söker globalt och återgår till vald kategori när sökningen rensas', async () => {
    renderAt('/kb?category=phone');
    fireEvent.change(screen.getByRole('textbox', { name: 'Sök i kunskapsbasen' }), { target: { value: 'Office' } });
    await waitFor(() => expect(data.calls).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Office', category_id: undefined })));
    expect(screen.getByRole('heading', { name: 'Office på datorn' })).toBeTruthy();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rensa sökning' }));
    await waitFor(() => expect(data.calls).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, category_id: 'phone' })));
  });

  it('kategorival rensar global sökning men behåller typfilter och Alla återställer kategorin', async () => {
    renderAt('/kb?search=Office&type=how-to');
    const nav = within(screen.getByRole('navigation', { name: 'Artikelkategorier' }));
    fireEvent.click(nav.getByRole('button', { name: /Telefoni/ }));
    await waitFor(() => expect(data.calls).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, category_id: 'phone', article_type: 'how-to' })));
    expect(nav.getByRole('button', { name: /Telefoni/ })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(nav.getByRole('button', { name: 'Alla artiklar' }));
    expect(data.calls).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: undefined, article_type: 'how-to' }));
  });

  it('rensar resultatfilter från tomläget utan att lämna kategorin', () => {
    renderAt('/kb?category=phone&type=solution');
    fireEvent.click(screen.getByRole('button', { name: 'Rensa filter' }));
    expect(data.calls).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: 'phone', article_type: undefined }));
  });

  it('visar "Visa fler" när fler sidor finns och hämtar nästa sida', () => {
    data.hasNextPage = true;
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: /Visa fler/ }));
    expect(data.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('ger bara admin ett statusfilter och skickar valt status till listan', async () => {
    renderAt('/kb?status=draft');
    expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull();
    expect(data.calls).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined }));
    cleanup();
    data.role = 'admin';
    renderAt('/kb?status=draft');
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy();
    await waitFor(() => expect(data.calls).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'draft' })));
  });
});
