// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import type { ReactNode } from 'react';
import { useTicketListNavigation } from './useTicketListNavigation';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderAt(path: string, defaultSize: number) {
  return renderHook(() => ({
    ...useTicketListNavigation(defaultSize), location: useLocation(), navigate: useNavigate(),
  }), { wrapper: ({ children }: { children: ReactNode }) =>
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter> });
}

describe('shared ticket list navigation', () => {
  it.each([['/tickets', 50, 'created_at'], ['/archive', 10, 'updated_at']] as const)(
    'preserves defaults and handles filters, sorting, pagination and return navigation for %s', (path, size, dateField) => {
      const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      const { result } = renderAt(`${path}?search=wifi&page=4&tags=old&tagMode=and`, size);
      expect(result.current.pageSize).toBe(size);
      expect(result.current.dateField).toBe(dateField);
      act(() => result.current.setSelectedIds(['ticket-1']));
      act(() => result.current.updateFilters({ company_id: 'c1', priority: 'all', category: [] }));
      expect(Object.fromEntries(result.current.searchParams)).toEqual({ search: 'wifi', page: '1', company_id: 'c1' });
      expect(result.current.selectedIds).toEqual([]);
      act(() => result.current.handleSortChange('priority'));
      expect(result.current.sortDirection).toBe('asc');
      act(() => result.current.handleSortChange('priority'));
      expect(result.current.sortDirection).toBe('desc');
      act(() => result.current.handlePageChange(3));
      expect(result.current.page).toBe(3);
      expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
      act(() => result.current.handlePageSizeChange(25));
      expect([result.current.page, result.current.pageSize]).toEqual([1, 25]);
      const from = result.current.location.pathname + result.current.location.search;
      act(() => result.current.handleTicketClick('ticket-1'));
      expect(result.current.location.pathname).toBe('/tickets/ticket-1');
      expect(result.current.location.state).toEqual({ from });
      act(() => result.current.navigate(-1));
      expect(result.current.location.pathname + result.current.location.search).toBe(from);
    },
  );

  it('turns off mine on the legacy route and clears selection on browser navigation', () => {
    const { result } = renderAt('/my-tickets?search=wifi&page=5', 50);
    expect(result.current.mine).toBe(true);
    act(() => result.current.updateFilters({ mine: '' }));
    expect(result.current.location.pathname).toBe('/tickets');
    expect(result.current.mine).toBe(false);
    expect(result.current.search).toBe('wifi');
    act(() => result.current.setSelectedIds(['ticket-1']));
    act(() => result.current.navigate(-1));
    expect(result.current.mine).toBe(true);
    expect(result.current.selectedIds).toEqual([]);
  });
});
