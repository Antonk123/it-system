import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router';
import { Plus, Download, Upload, LayoutGrid, Columns, Building2, Loader2, Inbox } from 'lucide-react';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useCompanies } from '@/hooks/useCompanies';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Layout } from '@/components/Layout';
import { getTicketScope } from '@/lib/ticketNavigation';
import { TicketViewNavigation } from '@/components/TicketViewNavigation';
import { TicketTable } from '@/components/TicketTable';
import { PaginationControls } from '@/components/PaginationControls';
import { ImportDialog } from '@/components/ImportDialog';
import { UnifiedFilterBar } from '@/components/UnifiedFilterBar';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TicketStatus, TicketPriority } from '@/types/ticket';
import { cn } from '@/lib/utils';
import { STATUS_LABELS } from '@/lib/constants';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { EmptyState } from '@/components/EmptyState';

// KanbanView laddas lazy — drar in dnd-vendor (~48 kB) som inte behövs i tabell-vy
const KanbanView = lazy(() => import('@/components/KanbanView').then(m => ({ default: m.KanbanView })));

const listContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
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
  const { user } = useAuth();
  const { statuses: selectedStatuses, mine } = getTicketScope(location.pathname, searchParams);

  // Read state from URL
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('limit')) || 50;
  const search = searchParams.get('search') || '';
  const priorityFilter = (searchParams.get('priority') || 'all') as TicketPriority | 'all';
  const categoryFilter = searchParams.get('category') || 'all';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const dateField = (selectedStatuses.every(status => status === 'resolved' || status === 'closed') ? 'updated_at' : searchParams.get('dateField') || 'created_at') as 'created_at' | 'updated_at' | 'closed_at';
  const checklistFilter = searchParams.get('checklist') || '';
  const companyFilter = searchParams.get('company_id') || 'all';
  const sortKey = (searchParams.get('sortBy') === 'tags' ? 'createdAt' : searchParams.get('sortBy') || 'createdAt') as 'createdAt' | 'status' | 'priority' | 'category';
  const sortDirection = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';
  const [compactView, setCompactView] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>(() => {
    const saved = localStorage.getItem('ticket_view_mode');
    return (saved as 'table' | 'kanban') || 'table';
  });


  // Save view preference to localStorage
  useEffect(() => {
    localStorage.setItem('ticket_view_mode', viewMode);
  }, [viewMode]);

  // Fetch with pagination
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => { setSelectedIds([]); }, [location.pathname, location.search]);

  const { tickets, pagination, isLoading, isError, updateTicket, bulkUpdateTickets, refetch } = useTickets({
    page,
    limit: pageSize,
    status: selectedStatuses.join(','),
    priority: priorityFilter,
    category: categoryFilter,
    search,
    dateFrom,
    dateTo,
    dateField,
    checklist: checklistFilter,
    sortBy: sortKey,
    sortDir: sortDirection,
    company_id: companyFilter,
    assigned_to: mine && user?.id ? user.id : undefined,
  });

  const { users } = useUsers();
  const { companies } = useCompanies();

  // Update URL params
  const updateFilters = useCallback((updates: Record<string, any>) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('tags');
    newParams.delete('tagMode');

    Object.entries(updates).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // Handle array-valued filters
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
      // Clear bulk selection — selected IDs from a previous filter
      // set could refer to tickets no longer visible
      setSelectedIds([]);
    }

    if (location.pathname === '/my-tickets' && updates.mine === '') {
      navigate(`/tickets?${newParams.toString()}`);
    } else {
      setSearchParams(newParams);
    }
  }, [searchParams, setSearchParams, location.pathname, navigate]);

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
      toast.success(`Status uppdaterad till ${STATUS_LABELS[status]}`);
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
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      if (dateField && dateField !== 'created_at') params.append('dateField', dateField);
      if (checklistFilter && checklistFilter !== 'all') params.append('checklist', checklistFilter);
      if (companyFilter && companyFilter !== 'all') params.append('company_id', companyFilter);
      if (mine && user?.id) params.append('assigned_to', user.id);
      const queryString = params.toString() ? `?${params.toString()}` : '';

      await api.exportTickets(queryString);
      toast.success('Excel-export lyckades!');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Export failed:', error);
      toast.error('Misslyckades att exportera ärenden');
    }
  }, [selectedStatuses, priorityFilter, categoryFilter, search, dateFrom, dateTo, dateField, checklistFilter, companyFilter, mine, user?.id]);

  return (
    <Layout>
      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={refetch}
      />
      <div className="space-y-6">
        <TicketViewNavigation />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Ärenden</h1>
            {pagination && pagination.total > 0 && (
              <p className="text-muted-foreground mt-1">
                Visar {((pagination.page - 1) * pagination.limit) + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)} av {pagination.total} ärenden
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
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

        {/* Company filter */}
        <div className="flex items-center gap-2">
          <Select value={companyFilter} onValueChange={v => {
            const newParams = new URLSearchParams(searchParams);
            if (v === 'all') newParams.delete('company_id');
            else newParams.set('company_id', v);
            newParams.set('page', '1');
            setSelectedIds([]);
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

        {/* Unified Filter Bar */}
        <div>
        <UnifiedFilterBar
          mine={mine}
          onMineChange={(value) => updateFilters({ mine: value ? '1' : '' })}
          search={search}
          priorityFilter={priorityFilter}
          categoryFilter={categoryFilter}
          checklistFilter={checklistFilter}
          dateFrom={dateFrom}
          dateTo={dateTo}
          dateField={dateField}
          hideDateFieldSelector={selectedStatuses.every(status => status === 'resolved' || status === 'closed')}
          onChange={updateFilters}
          onClearAll={() => updateFilters({
            search: '', mine: '', priority: 'all', category: 'all', company_id: 'all',
            checklist: '', dateFrom: '', dateTo: '', dateField: 'created_at'
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
            <div className={cn('relative', isLoading && 'opacity-50 pointer-events-none')}>
              {/* Refetch overlay — rows already shown, a new page/filter is loading */}
              {isLoading && tickets.length > 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center pt-24">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" aria-label="Laddar ärenden" />
                </div>
              )}
              {/* Mobile: Card list */}
              <div className="md:hidden space-y-2">
                {isError ? (
                  <div className="text-center py-12 space-y-2">
                    <p className="text-destructive text-sm">Kunde inte hämta ärenden</p>
                    <Button variant="outline" size="sm" onClick={refetch}>Försök igen</Button>
                  </div>
                ) : tickets.length === 0 ? (
                  <EmptyState
                    icon={<Inbox />}
                    title="Inga ärenden hittades"
                    description="Prova att justera dina filter eller skapa ett nytt ärende."
                  />
                ) : (
                  tickets.map(ticket => (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() => handleTicketClick(ticket.id)}
                      className="w-full text-left p-3 rounded-lg border bg-card active:bg-muted/50 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      aria-label={`Öppna ärende ${ticket.title}, prioritet ${ticket.priority}, status ${STATUS_LABELS[ticket.status] ?? ticket.status}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium line-clamp-1 flex-1">{ticket.title}</span>
                        <Badge variant={priorityVariant(ticket.priority)} className="shrink-0 text-xs">
                          {ticket.priority}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge variant="outline" className="text-xs">{STATUS_LABELS[ticket.status] ?? ticket.status}</Badge>
                        {ticket.companyName && (
                          <span className="text-xs text-muted-foreground">{ticket.companyName}</span>
                        )}
                      </div>
                    </button>
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
                {isError ? (
                  <div className="text-center py-16 space-y-2">
                    <p className="text-destructive text-sm">Kunde inte hämta ärenden</p>
                    <Button variant="outline" size="sm" onClick={refetch}>Försök igen</Button>
                  </div>
                ) : viewMode === 'table' ? (
                  <>
                    <TicketTable
                      tickets={tickets}
                      users={users}
                      onTicketClick={handleTicketClick}
                      sortKey={sortKey}
                      sortDirection={sortDirection}
                      onSortChange={handleSortChange}
                      compact={compactView}
                      selectedIds={selectedIds}
                      onSelectionChange={setSelectedIds}
                      onBulkAction={handleBulkAction}
                      // Only the table view shows the checklist column, so only it
                      // needs the checklist-progress fetch. (Kanban uses KanbanView,
                      // not TicketTable, so there's no false-case here.)
                      checklistVisible={true}
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
                  <Suspense fallback={
                    <div className="flex items-center justify-center py-16">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                    </div>
                  }>
                    <KanbanView
                      tickets={tickets}
                      onStatusChange={handleStatusChange}
                      onTicketClick={handleTicketClick}
                    />
                  </Suspense>
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
