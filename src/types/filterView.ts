export interface FilterView {
  id: string;
  name: string;
  isDefault: boolean;
  filters: {
    status?: string[];
    priority?: string;
    category?: string;
    tags?: string[];
    search?: string;
    // Extended filter fields (Phase 04)
    tagMode?: 'or' | 'and';
    checklist?: string;
    dateFrom?: string;
    dateTo?: string;
    dateField?: 'created_at' | 'updated_at' | 'closed_at';
  };
  viewPreferences?: {
    viewMode?: 'table' | 'kanban';
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
    compactView?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface FilterViewsState {
  views: FilterView[];
  activeViewId: string | null;
}
