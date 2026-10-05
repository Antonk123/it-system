import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { getTicketScope } from '@/lib/ticketNavigation';
import type { TicketPriority } from '@/types/ticket';

type FilterUpdates = Record<string, string | number | string[]>;
type SortKey = 'createdAt' | 'status' | 'priority' | 'category';

/** Shared URL state and navigation for active and completed ticket lists. */
export function useTicketListNavigation(defaultPageSize: number) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { statuses, mine } = getTicketScope(location.pathname, searchParams);
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('limit')) || defaultPageSize;
  const sortKey = (searchParams.get('sortBy') === 'tags' ? 'createdAt' : searchParams.get('sortBy') || 'createdAt') as SortKey;
  const sortDirection = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';
  const dateField = (statuses.every(status => status === 'resolved' || status === 'closed')
    ? 'updated_at' : searchParams.get('dateField') || 'created_at') as 'created_at' | 'updated_at' | 'closed_at';
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => { setSelectedIds([]); }, [location.pathname, location.search]);

  const updateFilters = useCallback((updates: FilterUpdates) => {
    const params = new URLSearchParams(searchParams);
    params.delete('tags');
    params.delete('tagMode');
    for (const [key, value] of Object.entries(updates)) {
      const normalized = Array.isArray(value) ? value.join(',') : value;
      if (normalized && normalized !== 'all') params.set(key, String(normalized));
      else params.delete(key);
    }
    if (Object.keys(updates).some(key => key !== 'page' && key !== 'limit')) params.set('page', '1');
    setSelectedIds([]);
    if (location.pathname === '/my-tickets' && updates.mine === '') {
      navigate(`/tickets?${params.toString()}`);
    } else {
      setSearchParams(params);
    }
  }, [searchParams, setSearchParams, location.pathname, navigate]);

  const handlePageChange = useCallback((newPage: number) => {
    updateFilters({ page: newPage });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [updateFilters]);

  const handlePageSizeChange = useCallback((newSize: number) => {
    updateFilters({ limit: newSize, page: 1 });
  }, [updateFilters]);

  const handleSortChange = useCallback((key: SortKey) => {
    updateFilters(sortKey === key
      ? { sortDir: sortDirection === 'asc' ? 'desc' : 'asc' }
      : { sortBy: key, sortDir: 'asc' });
  }, [sortKey, sortDirection, updateFilters]);

  const handleTicketClick = useCallback((ticketId: string) => {
    navigate(`/tickets/${ticketId}`, { state: { from: location.pathname + location.search } });
  }, [location.pathname, location.search, navigate]);

  return {
    searchParams, setSearchParams, statuses, mine, page, pageSize, sortKey, sortDirection, dateField,
    search: searchParams.get('search') || '',
    priorityFilter: (searchParams.get('priority') || 'all') as TicketPriority | 'all',
    categoryFilter: searchParams.get('category') || 'all',
    companyFilter: searchParams.get('company_id') || 'all',
    dateFrom: searchParams.get('dateFrom') || '',
    dateTo: searchParams.get('dateTo') || '',
    checklistFilter: searchParams.get('checklist') || '',
    selectedIds, setSelectedIds, updateFilters, handlePageChange, handlePageSizeChange, handleSortChange, handleTicketClick,
  };
}
