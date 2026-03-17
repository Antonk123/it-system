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
