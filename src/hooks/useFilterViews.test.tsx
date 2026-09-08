// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router';
import { useFilterViews } from './useFilterViews';
import type { FilterView } from '@/types/filterView';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(url: string) {
  return renderHook(() => ({ ...useFilterViews(), params: useSearchParams()[0] }), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>,
  });
}
describe('Ärendevyer efter borttagna taggar', () => {
  it('normaliserar en gammal tagg-URL och applicerar standardvyn i samma uppdatering', async () => {
    const { result } = setup('/tickets?tags=old&tagMode=and&sortBy=tags');
    await waitFor(() => expect(result.current.params.get('status')).toBe('open,in-progress,waiting'));
    expect(result.current.params.has('tags')).toBe(false);
    expect(result.current.params.has('tagMode')).toBe(false);
    expect(result.current.params.has('sortBy')).toBe(false);
  });
  it('bevarar uttrycklig kategori och sökning när gamla taggparametrar tas bort', async () => {
    const { result } = setup('/tickets?category=network&search=wifi&tags=old&tagMode=and');
    await waitFor(() => expect(result.current.params.has('tags')).toBe(false));
    expect(result.current.params.get('category')).toBe('network');
    expect(result.current.params.get('search')).toBe('wifi');
    expect(result.current.params.has('status')).toBe(false);
  });
  it('rensar gamla sparade vyer utan att förlora kategorier eller metadata', async () => {
    const oldView = {
      id: 'custom', name: 'Nätverk', isDefault: true, filters: { category: 'network', tags: ['old'], tagMode: 'and' },
      viewPreferences: { sortBy: 'tags', compactView: true }, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };
    localStorage.setItem('filter-views', JSON.stringify({ customViews: [oldView], defaultViewId: 'custom' }));
    const { result } = setup('/tickets');
    await waitFor(() => expect(result.current.params.get('category')).toBe('network'));
    const saved = result.current.views.find(view => view.id === 'custom')!;
    expect(saved.filters).toEqual({ category: 'network' });
    expect(saved.viewPreferences).toEqual({ compactView: true });
    expect(saved.name).toBe('Nätverk');
    expect(JSON.parse(localStorage.getItem('filter-views')!).customViews[0].filters).toEqual({ category: 'network' });
    act(() => result.current.applyView(oldView as FilterView, 'archive'));
    expect(result.current.params.has('tags')).toBe(false);
    expect(result.current.params.has('tagMode')).toBe(false);
  });
});
