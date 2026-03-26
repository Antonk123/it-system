import { useState, useEffect, useCallback, useRef } from 'react';
import { FilterView, FilterViewsState } from '@/types/filterView';
import { useSearchParams } from 'react-router-dom';

const STORAGE_KEY = 'filter-views';

// Simple UUID generator fallback for environments without crypto.randomUUID
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const DEFAULT_VIEW: FilterView = {
  id: 'active-tickets',
  name: 'Aktiva ärenden',
  isDefault: true,
  filters: {
    status: ['open', 'in-progress', 'waiting'],
  },
  viewPreferences: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function useFilterViews() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<FilterViewsState>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge defaults with custom views
        return {
          views: [DEFAULT_VIEW, ...(parsed.customViews || [])],
          activeViewId: parsed.activeViewId || null,
        };
      }
    } catch (error) {
      console.error('Failed to load filter views:', error);
    }
    return { views: [DEFAULT_VIEW], activeViewId: null };
  });

  // On mount: if there's an active view but URL has no filter params, restore the view's filters.
  // This handles the case where the user navigates away and back (URL params are lost).
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (!state.activeViewId) return;
    const view = state.views.find(v => v.id === state.activeViewId);
    if (!view) return;

    if (!searchParams.get('status')) {
      const newParams = new URLSearchParams(searchParams);
      if (view.filters.status?.length) {
        newParams.set('status', view.filters.status.join(','));
      }
      if (view.filters.priority && view.filters.priority !== 'all') {
        newParams.set('priority', view.filters.priority);
      }
      if (view.filters.category && view.filters.category !== 'all') {
        newParams.set('category', view.filters.category);
      }
      if (view.filters.tags?.length) {
        newParams.set('tags', view.filters.tags.join(','));
      }
      if (view.filters.search) {
        newParams.set('search', view.filters.search);
      }
      // Restore extended filter fields (Phase 04)
      if (view.filters.tagMode && view.filters.tagMode !== 'or') {
        newParams.set('tagMode', view.filters.tagMode);
      }
      if (view.filters.checklist) {
        newParams.set('checklist', view.filters.checklist);
      }
      if (view.filters.dateFrom) {
        newParams.set('dateFrom', view.filters.dateFrom);
      }
      if (view.filters.dateTo) {
        newParams.set('dateTo', view.filters.dateTo);
      }
      if (view.filters.dateField && view.filters.dateField !== 'created_at') {
        newParams.set('dateField', view.filters.dateField);
      }
      setSearchParams(newParams, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          customViews: state.views.filter((v) => !v.isDefault),
          activeViewId: state.activeViewId,
        })
      );
    } catch (error) {
      console.error('Failed to save filter views:', error);
    }
  }, [state]);

  const createView = useCallback(
    (viewData: Omit<FilterView, 'id' | 'createdAt' | 'updatedAt'>) => {
      const newView: FilterView = {
        ...viewData,
        id: generateUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setState((prev) => ({
        ...prev,
        views: [...prev.views, newView],
      }));

      return newView.id;
    },
    []
  );

  const updateView = useCallback(
    (id: string, updates: Partial<Omit<FilterView, 'id' | 'createdAt'>>) => {
      setState((prev) => ({
        ...prev,
        views: prev.views.map((v) =>
          v.id === id
            ? {
                ...v,
                ...updates,
                updatedAt: new Date().toISOString(),
              }
            : v
        ),
      }));
    },
    []
  );

  const deleteView = useCallback((id: string) => {
    setState((prev) => {
      const viewToDelete = prev.views.find((v) => v.id === id);
      if (viewToDelete?.isDefault) {
        console.warn('Cannot delete default view');
        return prev;
      }

      return {
        views: prev.views.filter((v) => v.id !== id),
        activeViewId: prev.activeViewId === id ? null : prev.activeViewId,
      };
    });
  }, []);

  const applyView = useCallback(
    (view: FilterView, context: 'ticketlist' | 'archive' = 'ticketlist') => {
      const newParams = new URLSearchParams(searchParams);

      // Apply status filter — skip on Archive (incompatible, per D-09)
      if (context !== 'archive') {
        if (view.filters.status && view.filters.status.length > 0) {
          newParams.set('status', view.filters.status.join(','));
        } else {
          newParams.delete('status');
        }
      }

      // Apply priority filter
      if (view.filters.priority && view.filters.priority !== 'all') {
        newParams.set('priority', view.filters.priority);
      } else {
        newParams.delete('priority');
      }

      // Apply category filter
      if (view.filters.category && view.filters.category !== 'all') {
        newParams.set('category', view.filters.category);
      } else {
        newParams.delete('category');
      }

      // Apply tags filter
      if (view.filters.tags && view.filters.tags.length > 0) {
        newParams.set('tags', view.filters.tags.join(','));
      } else {
        newParams.delete('tags');
      }

      // Apply search
      if (view.filters.search) {
        newParams.set('search', view.filters.search);
      } else {
        newParams.delete('search');
      }

      // Apply extended filter fields (Phase 04)
      if (view.filters.tagMode && view.filters.tagMode !== 'or') {
        newParams.set('tagMode', view.filters.tagMode);
      } else {
        newParams.delete('tagMode');
      }

      if (view.filters.checklist) {
        newParams.set('checklist', view.filters.checklist);
      } else {
        newParams.delete('checklist');
      }

      if (view.filters.dateFrom) {
        newParams.set('dateFrom', view.filters.dateFrom);
      } else {
        newParams.delete('dateFrom');
      }

      if (view.filters.dateTo) {
        newParams.set('dateTo', view.filters.dateTo);
      } else {
        newParams.delete('dateTo');
      }

      if (view.filters.dateField && view.filters.dateField !== 'created_at') {
        newParams.set('dateField', view.filters.dateField);
      } else {
        newParams.delete('dateField');
      }

      // Reset to page 1
      newParams.set('page', '1');

      setSearchParams(newParams);
      setState((prev) => ({ ...prev, activeViewId: view.id }));
    },
    [searchParams, setSearchParams]
  );

  const setActiveView = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, activeViewId: id }));
  }, []);

  const getCurrentFiltersAsView = useCallback(() => {
    const statusParam = searchParams.get('status') || '';
    const selectedStatuses = statusParam
      ? statusParam.split(',').filter((s) => s)
      : [];

    const tagsParam = searchParams.get('tags') || '';
    const selectedTags = tagsParam ? tagsParam.split(',').filter((t) => t) : [];

    // Extended filter fields (Phase 04)
    const tagModeParam = searchParams.get('tagMode');
    const checklistParam = searchParams.get('checklist');
    const dateFromParam = searchParams.get('dateFrom');
    const dateToParam = searchParams.get('dateTo');
    const dateFieldParam = searchParams.get('dateField') as 'created_at' | 'updated_at' | 'closed_at' | null;

    return {
      name: '',
      isDefault: false,
      filters: {
        status: selectedStatuses.length > 0 ? selectedStatuses : undefined,
        priority: searchParams.get('priority') || undefined,
        category: searchParams.get('category') || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        search: searchParams.get('search') || undefined,
        // Extended fields — only include if non-default
        tagMode: (tagModeParam && tagModeParam !== 'or') ? tagModeParam as 'or' | 'and' : undefined,
        checklist: checklistParam || undefined,
        dateFrom: dateFromParam || undefined,
        dateTo: dateToParam || undefined,
        dateField: (dateFieldParam && dateFieldParam !== 'created_at') ? dateFieldParam : undefined,
      },
      viewPreferences: {},
    };
  }, [searchParams]);

  const activeView = state.views.find((v) => v.id === state.activeViewId) || null;

  return {
    views: state.views,
    activeView,
    createView,
    updateView,
    deleteView,
    applyView,
    setActiveView,
    getCurrentFiltersAsView,
  };
}
