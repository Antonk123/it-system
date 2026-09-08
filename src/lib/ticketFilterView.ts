import type { FilterView } from '@/types/filterView';

/** Retired ticket-tag filters must not survive old URLs or saved presets. */
export function normalizeTicketFilterParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('tags');
  next.delete('tagMode');
  if (next.get('sortBy') === 'tags') next.delete('sortBy');
  return next;
}

export function normalizeTicketFilterView(view: FilterView): FilterView {
  const filters = { ...view.filters } as FilterView['filters'] & { tags?: unknown; tagMode?: unknown };
  delete filters.tags;
  delete filters.tagMode;
  const viewPreferences = { ...view.viewPreferences };
  if (viewPreferences.sortBy === 'tags') delete viewPreferences.sortBy;
  return { ...view, filters, viewPreferences };
}
