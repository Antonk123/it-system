import { useState, useEffect, useCallback, useRef } from 'react';
import { FilterView, FilterViewsState } from '@/types/filterView';
import { useSearchParams } from 'react-router-dom';

const STORAGE_KEY = 'filter-views';

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const BUILT_IN_VIEW: FilterView = {
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

function loadState(): FilterViewsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const customViews: FilterView[] = parsed.customViews || [];
      const defaultViewId: string | undefined = parsed.defaultViewId;

      const builtIn = {
        ...BUILT_IN_VIEW,
        ...(parsed.builtInFilters ? { filters: parsed.builtInFilters } : {}),
        isDefault: !defaultViewId || defaultViewId === BUILT_IN_VIEW.id,
      };

      const views = [
        builtIn,
        ...customViews.map((v: FilterView) => ({
          ...v,
          isDefault: v.id === defaultViewId,
        })),
      ];

      return {
        views,
        activeViewId: parsed.activeViewId || null,
      };
    }
  } catch (error) {
    console.error('Failed to load filter views:', error);
  }
  return { views: [BUILT_IN_VIEW], activeViewId: null };
}

function getDefaultView(views: FilterView[]): FilterView {
  return views.find((v) => v.isDefault) || views[0];
}

export function useFilterViews() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<FilterViewsState>(loadState);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const hasUrlFilters = searchParams.get('status') || searchParams.get('priority')
      || searchParams.get('category') || searchParams.get('tags') || searchParams.get('search');

    if (hasUrlFilters) return;

    const viewToApply = state.activeViewId
      ? state.views.find((v) => v.id === state.activeViewId)
      : getDefaultView(state.views);

    if (!viewToApply) return;

    const newParams = new URLSearchParams(searchParams);
    if (viewToApply.filters.status?.length) {
      newParams.set('status', viewToApply.filters.status.join(','));
    }
    if (viewToApply.filters.priority && viewToApply.filters.priority !== 'all') {
      newParams.set('priority', viewToApply.filters.priority);
    }
    if (viewToApply.filters.category && viewToApply.filters.category !== 'all') {
      newParams.set('category', viewToApply.filters.category);
    }
    if (viewToApply.filters.tags?.length) {
      newParams.set('tags', viewToApply.filters.tags.join(','));
    }
    if (viewToApply.filters.search) {
      newParams.set('search', viewToApply.filters.search);
    }
    if (viewToApply.filters.tagMode && viewToApply.filters.tagMode !== 'or') {
      newParams.set('tagMode', viewToApply.filters.tagMode);
    }
    if (viewToApply.filters.checklist) {
      newParams.set('checklist', viewToApply.filters.checklist);
    }
    if (viewToApply.filters.dateFrom) {
      newParams.set('dateFrom', viewToApply.filters.dateFrom);
    }
    if (viewToApply.filters.dateTo) {
      newParams.set('dateTo', viewToApply.filters.dateTo);
    }
    if (viewToApply.filters.dateField && viewToApply.filters.dateField !== 'created_at') {
      newParams.set('dateField', viewToApply.filters.dateField);
    }

    setSearchParams(newParams, { replace: true });
    setState((prev) => ({ ...prev, activeViewId: viewToApply.id }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const defaultView = state.views.find((v) => v.isDefault);
      const builtIn = state.views.find((v) => v.id === BUILT_IN_VIEW.id);
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          customViews: state.views.filter((v) => v.id !== BUILT_IN_VIEW.id),
          builtInFilters: builtIn?.filters,
          activeViewId: state.activeViewId,
          defaultViewId: defaultView?.id || BUILT_IN_VIEW.id,
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
            ? { ...v, ...updates, updatedAt: new Date().toISOString() }
            : v
        ),
      }));
    },
    []
  );

  const deleteView = useCallback((id: string) => {
    setState((prev) => {
      const viewToDelete = prev.views.find((v) => v.id === id);
      if (viewToDelete?.id === BUILT_IN_VIEW.id) return prev;

      const wasDefault = viewToDelete?.isDefault;
      let views = prev.views.filter((v) => v.id !== id);

      if (wasDefault) {
        views = views.map((v) =>
          v.id === BUILT_IN_VIEW.id ? { ...v, isDefault: true } : v
        );
      }

      return {
        views,
        activeViewId: prev.activeViewId === id ? null : prev.activeViewId,
      };
    });
  }, []);

  const setDefaultView = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      views: prev.views.map((v) => ({
        ...v,
        isDefault: v.id === id,
      })),
    }));
  }, []);

  const applyView = useCallback(
    (view: FilterView, context: 'ticketlist' | 'archive' = 'ticketlist') => {
      const newParams = new URLSearchParams(searchParams);

      if (context !== 'archive') {
        if (view.filters.status && view.filters.status.length > 0) {
          newParams.set('status', view.filters.status.join(','));
        } else {
          newParams.delete('status');
        }
      }

      if (view.filters.priority && view.filters.priority !== 'all') {
        newParams.set('priority', view.filters.priority);
      } else {
        newParams.delete('priority');
      }

      if (view.filters.category && view.filters.category !== 'all') {
        newParams.set('category', view.filters.category);
      } else {
        newParams.delete('category');
      }

      if (view.filters.tags && view.filters.tags.length > 0) {
        newParams.set('tags', view.filters.tags.join(','));
      } else {
        newParams.delete('tags');
      }

      if (view.filters.search) {
        newParams.set('search', view.filters.search);
      } else {
        newParams.delete('search');
      }

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
    setDefaultView,
    applyView,
    setActiveView,
    getCurrentFiltersAsView,
  };
}
