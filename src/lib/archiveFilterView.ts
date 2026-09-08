import type { FilterView } from '@/types/filterView';

/** Archive always queries closed tickets by closed_at, regardless of URL values. */
export function archiveFilterViewMatches(view: FilterView | null, params: URLSearchParams): boolean {
  if (!view) return false;
  const filters = view.filters;
  if (filters.status?.length && filters.status.some(status => status !== 'closed')) return false;

  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  if ((filters.dateFrom || '') !== dateFrom || (filters.dateTo || '') !== dateTo) return false;
  if ((dateFrom || dateTo) && (filters.dateField || 'created_at') !== 'closed_at') return false;

  if ((filters.priority || 'all') !== (params.get('priority') || 'all')) return false;
  if ((filters.category || 'all') !== (params.get('category') || 'all')) return false;
  if ((filters.search || '') !== (params.get('search') || '')) return false;
  if ((filters.checklist || '') !== (params.get('checklist') || '')) return false;
  if ((filters.tagMode || 'or') !== (params.get('tagMode') || 'or')) return false;

  const selectedTags = (params.get('tags') || '').split(',').filter(Boolean);
  const viewTags = filters.tags || [];
  return selectedTags.length === viewTags.length && selectedTags.every(tag => viewTags.includes(tag));
}
