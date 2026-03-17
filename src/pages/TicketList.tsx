import { useState, useMemo, useCallback, useEffect } from 'react';
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Plus, Download, Upload, LayoutGrid, Columns } from 'lucide-react';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useCategories } from '@/hooks/useCategories';
import { Layout } from '@/components/Layout';
import { TicketTable } from '@/components/TicketTable';
import { KanbanView } from '@/components/KanbanView';
import { SearchBar } from '@/components/SearchBar';
import { PaginationControls } from '@/components/PaginationControls';
import { ImportDialog } from '@/components/ImportDialog';
import { TagFilter } from '@/components/TagFilter';
import { CategoryFilter } from '@/components/CategoryFilter';
import { TagMultiSelect } from '@/components/TagMultiSelect';
import { StatusMultiSelect } from '@/components/StatusMultiSelect';
import { FilterViewSelector } from '@/components/FilterViewSelector';
import { FilterViewManager } from '@/components/FilterViewManager';
import { Skeleton } from '@/components/ui/skeleton';
import { useFilterViews } from '@/hooks/useFilterViews';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TicketStatus, TicketPriority } from '@/types/ticket';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const statusLabels: Record<TicketStatus, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

const TicketList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Read state from URL
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('limit')) || 50;
  const search = searchParams.get('search') || '';
  const statusParam = searchParams.get('status') || '';
  const selectedStatuses: TicketStatus[] = statusParam ? statusParam.split(',').filter(s => s) as TicketStatus[] : [];
  const priorityFilter = (searchParams.get('priority') || 'all') as TicketPriority | 'all';
  const categoryFilter = searchParams.get('category') || 'all';
  const tagsFilter = searchParams.get('tags') || '';
  const selectedTagIds = tagsFilter ? tagsFilter.split(',').filter(id => id.trim()) : [];
  const sortKey = (searchParams.get('sortBy') || 'createdAt') as 'createdAt' | 'status' | 'priority' | 'category' | 'tags';
  const sortDirection = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';
  const [compactView, setCompactView] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [manageViewsOpen, setManageViewsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>(() => {
    const saved = localStorage.getItem('ticket_view_mode');
    return (saved as 'table' | 'kanban') || 'table';
  });

  // Filter views
  const {
    views,
    activeView,
    createView,
    deleteView,
    applyView,
    setActiveView,
    getCurrentFiltersAsView,
  } = useFilterViews();

  // Save view preference to localStorage
  useEffect(() => {
    localStorage.setItem('ticket_view_mode', viewMode);
  }, [viewMode]);

  // Fetch with pagination
  const { tickets, pagination, isLoading, updateTicket, refetch } = useTickets({
    page,
    limit: pageSize,
    status: selectedStatuses.length > 0 ? selectedStatuses.join(',') : 'all',
    priority: priorityFilter,
    category: categoryFilter,
    search,
    tags: tagsFilter,
    sortBy: sortKey,
    sortDir: sortDirection,
  });

  const { users } = useUsers();
  const { categories } = useCategories();

  // Update URL params
  const updateFilters = useCallback((updates: Record<string, any>) => {
    const newParams = new URLSearchParams(searchParams);

    Object.entries(updates).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // Handle arrays (status, tags)
        if (value.length > 0) {
          newParams.set(key, value.join(','));
        } else {
          newParams.delete(key);
        }
      } else if (value && value !== 'all') {
        newParams.set(key, String(value));
      } else {
        newParams.delete(key);
      }
    });

    // Reset to page 1 on filter/sort changes
    if (Object.keys(updates).some(k => k !== 'page' && k !== 'limit')) {
      newParams.set('page', '1');
      // Deactivate active view when filters are changed manually
      setActiveView(null);
    }

    setSearchParams(newParams);
  }, [searchParams, setSearchParams, setActiveView]);

  // Event handlers
  const handleSearchChange = useCallback((newSearch: string) => {
    updateFilters({ search: newSearch });
  }, [updateFilters]);

  const handlePageChange = useCallback((newPage: number) => {
    updateFilters({ page: newPage });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [updateFilters]);

  const handlePageSizeChange = useCallback((newSize: number) => {
    updateFilters({ limit: newSize, page: 1 });
  }, [updateFilters]);

  const handleSortChange = useCallback((key: 'status' | 'priority' | 'category') => {
    if (sortKey === key) {
      const newDir = sortDirection === 'asc' ? 'desc' : 'asc';
      updateFilters({ sortDir: newDir });
    } else {
      updateFilters({ sortBy: key, sortDir: 'asc' });
    }
  }, [sortKey, sortDirection, updateFilters]);

  const handleStatusChange = useCallback(async (ticketId: string, status: TicketStatus) => {
    try {
      await updateTicket(ticketId, { status });
      toast.success(`Status uppdaterad till ${statusLabels[status]}`);
    } catch {
      toast.error('Kunde inte uppdatera status');
    }
  }, [updateTicket]);

  const handleRemoveTagFilter = useCallback((tagId: string) => {
    const newTagIds = selectedTagIds.filter(id => id !== tagId);
    updateFilters({ tags: newTagIds.length > 0 ? newTagIds.join(',') : undefined });
  }, [selectedTagIds, updateFilters]);

  const handleClearAllTags = useCallback(() => {
    updateFilters({ tags: undefined });
  }, [updateFilters]);

  const handleTagSelectionChange = useCallback((tagIds: string[]) => {
    updateFilters({ tags: tagIds.length > 0 ? tagIds.join(',') : undefined });
  }, [updateFilters]);

  const handleRemoveCategoryFilter = useCallback(() => {
    updateFilters({ category: 'all' });
  }, [updateFilters]);

  const handleTicketClick = useCallback((ticketId: string) => {
    const currentPath = location.pathname + location.search;
    navigate(`/tickets/${ticketId}`, {
      state: { from: currentPath }
    });
  }, [location.pathname, location.search, navigate]);

  const handleExport = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedStatuses.length > 0) params.append('status', selectedStatuses.join(','));
      if (priorityFilter && priorityFilter !== 'all') params.append('priority', priorityFilter);
      if (categoryFilter && categoryFilter !== 'all') params.append('category', categoryFilter);
      if (search) params.append('search', search);
      if (tagsFilter) params.append('tags', tagsFilter);
      const queryString = params.toString() ? `?${params.toString()}` : '';

      await api.exportTickets(queryString);
      toast.success('CSV-export lyckades!');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Misslyckades att exportera ärenden');
    }
  }, [selectedStatuses, priorityFilter, categoryFilter, search, tagsFilter]);

  const priorityQuickFilters: { value: TicketPriority; label: string }[] = [
    { value: 'high', label: 'Hög' },
    { value: 'critical', label: 'Kritisk' },
  ];

  return (
    <Layout>
      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={refetch}
      />
      <FilterViewManager
        open={manageViewsOpen}
        onOpenChange={setManageViewsOpen}
        views={views}
        currentFilters={getCurrentFiltersAsView()}
        onCreateView={createView}
        onDeleteView={deleteView}
      />
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Alla Ärenden1</h1>
            {pagination && (
              <p className="text-muted-foreground mt-1">
                Visar {((pagination.page - 1) * pagination.limit) + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)} av {pagination.total} ärenden
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={viewMode === 'table' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode(viewMode === 'table' ? 'kanban' : 'table')}
              className="h-8 gap-2"
            >
              {viewMode === 'table' ? (
                <>
                  <LayoutGrid className="w-4 h-4" />
                  Kanban
                </>
              ) : (
                <>
                  <Columns className="w-4 h-4" />
                  Tabell
                </>
              )}
            </Button>
            {viewMode === 'table' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompactView((prev) => !prev)}
                className="h-8"
              >
                {compactView ? 'Standardvy' : 'Kompakt vy'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleExport}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              Exportera
            </Button>
            <Button
              variant="outline"
              onClick={() => setImportDialogOpen(true)}
              className="gap-2"
            >
              <Upload className="w-4 h-4" />
              Importera
            </Button>
            <Link to="/tickets/new">
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Nytt ärende
              </Button>
            </Link>
          </div>
        </div>

        {/* Filter Views */}
        <div className="flex items-center gap-2">
          <FilterViewSelector
            views={views}
            activeViewId={activeView?.id || null}
            onSelectView={(viewId) => {
              const view = views.find((v) => v.id === viewId);
              if (view) {
                applyView(view);
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setManageViewsOpen(true)}
            className="h-10"
          >
            Hantera vyer
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <SearchBar
              value={search}
              onChange={handleSearchChange}
              placeholder="Sök ärenden..."
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {viewMode === 'table' && (
              <StatusMultiSelect
                selectedStatuses={selectedStatuses}
                onChange={(statuses) => updateFilters({ status: statuses })}
              />
            )}
            <Select value={priorityFilter} onValueChange={(v) => updateFilters({ priority: v })}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Prioritet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla prioriteter</SelectItem>
                <SelectItem value="low">Låg</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">Hög</SelectItem>
                <SelectItem value="critical">Kritisk</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={(v) => updateFilters({ category: v })}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla kategorier</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TagMultiSelect
              selectedTagIds={selectedTagIds}
              onChange={handleTagSelectionChange}
            />
          </div>
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Snabbfilter:</span>
          {priorityQuickFilters.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={priorityFilter === item.value ? 'secondary' : 'outline'}
              onClick={() => updateFilters({ priority: priorityFilter === item.value ? 'all' : item.value })}
              className="h-7 px-3 text-xs"
            >
              {item.label}
            </Button>
          ))}
        </div>

        {/* Active Category Filter */}
        <CategoryFilter
          selectedCategoryId={categoryFilter}
          onRemoveCategory={handleRemoveCategoryFilter}
        />

        {/* Active Tag Filters */}
        <TagFilter
          selectedTagIds={selectedTagIds}
          onRemoveTag={handleRemoveTagFilter}
          onClearAll={handleClearAllTags}
        />

        {/* Loading state */}
        {isLoading && tickets.length === 0 ? (
          <div className="space-y-2">
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
              {viewMode === 'table' ? (
                <>
                  <TicketTable
                    tickets={tickets}
                    users={users}
                    onStatusChange={handleStatusChange}
                    onTicketClick={handleTicketClick}
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSortChange={handleSortChange}
                    compact={compactView}
                  />

                  {/* Pagination controls - Table only */}
                  {pagination && pagination.totalPages > 1 && (
                    <PaginationControls
                      currentPage={pagination.page}
                      totalPages={pagination.totalPages}
                      pageSize={pageSize}
                      onPageChange={handlePageChange}
                      onPageSizeChange={handlePageSizeChange}
                    />
                  )}
                </>
              ) : (
                <KanbanView
                  tickets={tickets}
                  users={users}
                  onStatusChange={handleStatusChange}
                  onTicketClick={handleTicketClick}
                />
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

export default TicketList;
