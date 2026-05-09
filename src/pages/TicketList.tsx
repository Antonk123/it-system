import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Plus, Download, Upload, LayoutGrid, Columns, Building2, Search } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useCompanies } from '@/hooks/useCompanies';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { TicketStatus, TicketPriority } from '@/types/ticket';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const listContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};
const listItem = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
};

const statusLabels: Record<TicketStatus, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

const priorityVariant = (priority: string): 'default' | 'destructive' | 'secondary' | 'outline' => {
  switch (priority) {
    case 'critical': return 'destructive';
    case 'high': return 'destructive';
    case 'medium': return 'default';
    default: return 'secondary';
  }
};

const TicketList = () => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Read state from URL
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('limit')) || 50;
  const search = searchParams.get('search') || '';
  const statusParam = searchParams.get('status') || '';
  const selectedStatuses = useMemo<TicketStatus[]>(
    () => (statusParam ? statusParam.split(',').filter(s => s) as TicketStatus[] : []),
    [statusParam]
  );
  const priorityFilter = (searchParams.get('priority') || 'all') as TicketPriority | 'all';
  const categoryFilter = searchParams.get('category') || 'all';
  const tagsFilter = searchParams.get('tags') || '';
  const selectedTagIds = useMemo(
    () => (tagsFilter ? tagsFilter.split(',').filter(id => id.trim()) : []),
    [tagsFilter]
  );
  const tagMode = (searchParams.get('tagMode') || 'or') as 'or' | 'and';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const dateField = (searchParams.get('dateField') || 'created_at') as 'created_at' | 'updated_at' | 'closed_at';
  const checklistFilter = searchParams.get('checklist') || '';
  const companyFilter = searchParams.get('company_id') || 'all';
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
    updateView,
    deleteView,
    setDefaultView,
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
    company_id: companyFilter,
  });

  const { users } = useUsers();
  const { companies } = useCompanies();

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
      toast.success('Excel-export lyckades!');
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
        onUpdateView={updateView}
        onDeleteView={deleteView}
        onSetDefault={setDefaultView}
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

        {/* Mobile simplified filters */}
        <div className="md:hidden space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Sök ärenden..."
              value={search}
              onChange={e => updateFilters({ search: e.target.value })}
              className="pl-9 w-full"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {(['open', 'in-progress', 'waiting'] as TicketStatus[]).map(s => (
              <Badge
                key={s}
                variant={selectedStatuses.includes(s) ? 'default' : 'outline'}
                className="cursor-pointer shrink-0"
                onClick={() => {
                  const next = selectedStatuses.includes(s)
                    ? selectedStatuses.filter(x => x !== s)
                    : [...selectedStatuses, s];
                  updateFilters({ status: next });
                }}
              >
                {statusLabels[s]}
              </Badge>
            ))}
          </div>
        </div>

        {/* Company filter — desktop only */}
        <div className="hidden md:flex items-center gap-2">
          <Select value={companyFilter} onValueChange={v => {
            const newParams = new URLSearchParams(searchParams);
            if (v === 'all') newParams.delete('company_id');
            else newParams.set('company_id', v);
            newParams.set('page', '1');
            setActiveView(null);
            setSearchParams(newParams);
          }}>
            <SelectTrigger className="w-[180px]">
              <Building2 className="mr-2 h-4 w-4 shrink-0" />
              <SelectValue placeholder="Alla företag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla företag</SelectItem>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Unified Filter Bar — desktop only */}
        <div className="hidden md:block">
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
        </div>

        {/* Loading state / content with crossfade */}
        <AnimatePresence mode="wait">
        {isLoading && tickets.length === 0 ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Mobile skeleton */}
            <div className="md:hidden space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-card rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop skeleton */}
            <div className="hidden md:block space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-3">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-12" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={prefersReducedMotion ? false : 'hidden'}
            animate={prefersReducedMotion ? false : 'visible'}
            variants={listContainer}
          >
            <div className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
              {/* Mobile: Card list */}
              <div className="md:hidden space-y-2">
                {tickets.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12">Inga ärenden hittades</p>
                ) : (
                  tickets.map(ticket => (
                    <div
                      key={ticket.id}
                      onClick={() => handleTicketClick(ticket.id)}
                      className="p-3 rounded-lg border bg-card cursor-pointer active:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-medium line-clamp-1 flex-1">{ticket.title}</h3>
                        <Badge variant={priorityVariant(ticket.priority)} className="shrink-0 text-xs">
                          {ticket.priority}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge variant="outline" className="text-xs">{statusLabels[ticket.status] ?? ticket.status}</Badge>
                        {ticket.companyName && (
                          <span className="text-xs text-muted-foreground">{ticket.companyName}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {/* Mobile pagination */}
                {pagination && pagination.totalPages > 1 && (
                  <PaginationControls
                    currentPage={pagination.page}
                    totalPages={pagination.totalPages}
                    pageSize={pageSize}
                    onPageChange={handlePageChange}
                    onPageSizeChange={handlePageSizeChange}
                  />
                )}
              </div>

              {/* Desktop: Table or Kanban */}
              <div className="hidden md:block">
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
                      selectedIds={selectedIds}
                      onSelectionChange={setSelectedIds}
                      onBulkAction={handleBulkAction}
                    />
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
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </Layout>
  );
};

export default TicketList;
