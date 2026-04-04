import { useState, useCallback, useEffect } from 'react';
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Plus, Download, Upload, LayoutGrid, Columns } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { Layout } from '@/components/Layout';
import { TicketTable } from '@/components/TicketTable';
import { KanbanView } from '@/components/KanbanView';
import { PaginationControls } from '@/components/PaginationControls';
import { ImportDialog } from '@/components/ImportDialog';
import { FilterViewManager } from '@/components/FilterViewManager';
import { UnifiedFilterBar } from '@/components/UnifiedFilterBar';
import { Skeleton } from '@/components/ui/skeleton';
import { useFilterViews } from '@/hooks/useFilterViews';
import { Button } from '@/components/ui/button';
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
  const tagMode = (searchParams.get('tagMode') || 'or') as 'or' | 'and';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const dateField = (searchParams.get('dateField') || 'created_at') as 'created_at' | 'updated_at' | 'closed_at';
  const checklistFilter = searchParams.get('checklist') || '';
  const sortKey = (searchParams.get('sortBy') || 'createdAt') as 'createdAt' | 'status' | 'priority' | 'category' | 'tags';
  const sortDirection = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';
  const [compactView, setCompactView] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [manageViewsOpen, setManageViewsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>(() => {
    const saved = localStorage.getItem('ticket_view_mode');
    return (saved as 'table' | 'kanban') || 'table';
  });

  const isMobile = useIsMobile();

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { tickets, pagination, isLoading, updateTicket, bulkUpdateTickets, refetch } = useTickets({
    page,
    limit: pageSize,
    status: selectedStatuses.length > 0 ? selectedStatuses.join(',') : 'all',
    priority: priorityFilter,
    category: categoryFilter,
    search,
    tags: tagsFilter,
    tagMode,
    dateFrom,
    dateTo,
    dateField,
    checklist: checklistFilter,
    sortBy: sortKey,
    sortDir: sortDirection,
  });

  const { users } = useUsers();

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

  const handleTicketClick = useCallback((ticketId: string) => {
    const currentPath = location.pathname + location.search;
    navigate(`/tickets/${ticketId}`, {
      state: { from: currentPath }
    });
  }, [location.pathname, location.search, navigate]);

  const handleBulkAction = useCallback(async (ids: string[], updates: { status?: TicketStatus; priority?: string; category_id?: string | null }) => {
    try {
      const result = await bulkUpdateTickets(ids, updates);
      toast.success(`${result?.updated ?? ids.length} ärenden uppdaterade`);
    } catch {
      toast.error('Kunde inte uppdatera ärenden');
    }
  }, [bulkUpdateTickets]);

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
            <h1 className="text-xl font-bold text-foreground">Alla ärenden</h1>
            {pagination && pagination.total > 0 && (
              <p className="text-muted-foreground mt-1">
                Visar {((pagination.page - 1) * pagination.limit) + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)} av {pagination.total} ärenden
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="hidden md:flex items-center gap-2">
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
            </div>
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

        {/* Unified Filter Bar (single row, replaces all legacy filter sections) */}
        <UnifiedFilterBar
          search={search}
          selectedStatuses={selectedStatuses}
          priorityFilter={priorityFilter}
          categoryFilter={categoryFilter}
          selectedTagIds={selectedTagIds}
          tagMode={tagMode}
          checklistFilter={checklistFilter}
          dateFrom={dateFrom}
          dateTo={dateTo}
          dateField={dateField}
          views={views}
          activeViewId={activeView?.id ?? null}
          onSelectView={(view) => applyView(view, 'ticketlist')}
          onManageViews={() => setManageViewsOpen(true)}
          onChange={updateFilters}
          onClearAll={() => updateFilters({
            search: '', status: [], priority: 'all', category: 'all',
            tags: [], tagMode: 'or', checklist: '', dateFrom: '', dateTo: '', dateField: 'created_at'
          })}
          searchPlaceholder="Sök ärenden..."
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
              {(isMobile ? 'table' : viewMode) === 'table' ? (
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
                    selectedIds={selectedIds}
                    onSelectionChange={setSelectedIds}
                    onBulkAction={handleBulkAction}
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
