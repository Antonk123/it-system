import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router';
import { useTickets } from '@/hooks/useTickets';
import { useAuth } from '@/contexts/AuthContext';
import { useCompanies } from '@/hooks/useCompanies';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUsers } from '@/hooks/useUsers';
import { Layout } from '@/components/Layout';
import { getTicketScope } from '@/lib/ticketNavigation';
import { TicketViewNavigation } from '@/components/TicketViewNavigation';
import { TicketTable } from '@/components/TicketTable';
import { EmptyState } from '@/components/EmptyState';
import { PaginationControls } from '@/components/PaginationControls';
import { Skeleton } from '@/components/ui/skeleton';
import { Archive as ArchiveIcon, Upload, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TicketPriority } from '@/types/ticket';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ImportDialog } from '@/components/ImportDialog';
import { UnifiedFilterBar } from '@/components/UnifiedFilterBar';
import { BulkActionBar } from '@/components/BulkActionBar';

const Archive = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { companies } = useCompanies();
  const { statuses, mine } = getTicketScope(location.pathname, searchParams);
  const companyFilter = searchParams.get('company_id') || 'all';

  // Read state from URL
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('limit')) || 10;
  const search = searchParams.get('search') || '';
  const categoryFilter = searchParams.get('category') || 'all';
  const priorityFilter = (searchParams.get('priority') || 'all') as TicketPriority | 'all';
  const checklistFilter = searchParams.get('checklist') || '';
  const dateField = 'updated_at' as const; // Includes resolved tickets without closed_at.
  const sortKey = (searchParams.get('sortBy') || 'createdAt') as 'createdAt' | 'priority' | 'category';
  const sortDirection = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';

  const [compactView, setCompactView] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Both resolved and closed tickets belong to Avslutade.
  const { tickets, pagination, isLoading, refetch } = useTickets({
    page,
    limit: pageSize,
    status: statuses.join(','),
    assigned_to: mine && user?.id ? user.id : undefined,
    company_id: companyFilter,
    priority: priorityFilter,
    category: categoryFilter,
    search,
    dateFrom,
    dateTo,
    dateField,
    checklist: checklistFilter,
    sortBy: sortKey,
    sortDir: sortDirection,
  });

  const { users } = useUsers();

  // Reopen makes sense whenever any selected ticket is resolved/closed.
  // Avslutade lists resolved and closed tickets, so a non-empty selection always
  // qualifies — but we compute it from the actual selection for correctness.
  const canReopenSelection = tickets.some(
    (t) => selectedIds.includes(t.id) && (t.status === 'resolved' || t.status === 'closed'),
  );

  // Initialize URL params if missing (required for backend pagination)
  useEffect(() => {
    const currentPage = searchParams.get('page');
    const currentLimit = searchParams.get('limit');

    if (!currentPage || !currentLimit) {
      const newParams = new URLSearchParams(searchParams);
      if (!currentPage) newParams.set('page', '1');
      if (!currentLimit) newParams.set('limit', '10');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Clear selection when filters or page changes
  useEffect(() => {
    setSelectedIds([]);
  }, [location.pathname, location.search]);

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
    }

    setSearchParams(newParams);
  }, [searchParams, setSearchParams ]);

  // Event handlers
  const handlePageChange = (newPage: number) => {
    updateFilters({ page: newPage });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageSizeChange = (newSize: number) => {
    updateFilters({ limit: newSize, page: 1 });
  };

  const handleSortChange = (key: 'priority' | 'category') => {
    if (sortKey === key) {
      const newDir = sortDirection === 'asc' ? 'desc' : 'asc';
      updateFilters({ sortDir: newDir });
    } else {
      updateFilters({ sortBy: key, sortDir: 'asc' });
    }
  };

  const handleTicketClick = useCallback((ticketId: string) => {
    const currentPath = location.pathname + location.search;
    navigate(`/tickets/${ticketId}`, {
      state: { from: currentPath }
    });
  }, [location.pathname, location.search, navigate]);

  // Bulk action handlers
  const handleBulkReopen = useCallback(async () => {
    try {
      const result = await api.bulkUpdateTickets(selectedIds, { status: 'open' });
      toast.success(`${result?.updated ?? selectedIds.length} ärenden öppnade igen`);
      setSelectedIds([]);
      refetch();
    } catch {
      toast.error('Kunde inte öppna ärenden igen');
    }
  }, [selectedIds, refetch]);

  const handleBulkChangePriority = useCallback(async (priority: TicketPriority) => {
    try {
      const result = await api.bulkUpdateTickets(selectedIds, { priority });
      toast.success(`Prioritet ändrad för ${result?.updated ?? selectedIds.length} ärenden`);
      setSelectedIds([]);
      refetch();
    } catch {
      toast.error('Kunde inte ändra prioritet');
    }
  }, [selectedIds, refetch]);

  const handleBulkExportXlsx = useCallback(async () => {
    if (selectedIds.length === 0) return;

    try {
      const params = new URLSearchParams();
      params.set('ids', selectedIds.join(','));

      const queryString = `?${params.toString()}`;
      await api.exportArchive(queryString);
      toast.success(`${selectedIds.length} ärenden exporterade till Excel`);
    } catch {
      toast.error('Kunde inte exportera arkivet');
    }
  }, [selectedIds]);

  const handleExport = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: statuses.join(','), dateField });
      if (priorityFilter !== 'all') params.set('priority', priorityFilter);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      if (companyFilter !== 'all') params.set('company_id', companyFilter);
      if (search) params.set('search', search);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (checklistFilter && checklistFilter !== 'all') params.set('checklist', checklistFilter);
      if (mine && user?.id) params.set('assigned_to', user.id);
      await api.exportTickets(`?${params.toString()}`);
      toast.success('Excel-export lyckades!');
    } catch {
      toast.error('Kunde inte exportera avslutade ärenden');
    }
  }, [statuses, dateField, priorityFilter, categoryFilter, companyFilter, search, dateFrom, dateTo, checklistFilter, mine, user?.id]);

  const handleBulkAssign = useCallback(async (userId: string | null) => {
    if (selectedIds.length === 0) return;
    try {
      const result = await api.bulkUpdateTickets(selectedIds, { assigned_to: userId });
      toast.success(`${result?.updated ?? selectedIds.length} ärenden tilldelade`);
      setSelectedIds([]);
      refetch();
    } catch {
      toast.error('Kunde inte tilldela ärenden');
    }
  }, [selectedIds, refetch]);

  const handleBulkDelete = useCallback(async () => {
    try {
      const result = await api.bulkDeleteTickets(selectedIds);
      toast.success(`${result.deleted} ärenden raderade permanent`);
      setSelectedIds([]);
      refetch();
    } catch {
      toast.error('Kunde inte radera ärenden');
    }
  }, [selectedIds, refetch]);

  return (
    <Layout>
      <div className="space-y-6">
        <TicketViewNavigation />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Ärenden</h1>
            {pagination && pagination.total > 0 && (
              <p className="text-muted-foreground mt-1">
                Visar {((pagination.page - 1) * pagination.limit) + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)} av {pagination.total} avslutade ärenden
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} className="h-8 gap-2">
              <Download className="w-4 h-4" /> Exportera Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCompactView((prev) => !prev)}
              className="h-8"
            >
              {compactView ? 'Standardvy' : 'Kompakt vy'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
              className="h-8 gap-2"
            >
              <Upload className="w-4 h-4" />
              Importera CSV
            </Button>
          </div>
        </div>

        <Select value={companyFilter} onValueChange={(value) => updateFilters({ company_id: value })}>
          <SelectTrigger className="w-[180px]" aria-label="Företag"><SelectValue placeholder="Alla företag" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla företag</SelectItem>
            {companies.map(company => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Datumfilter avser senast uppdaterat, för både lösta och stängda ärenden.</p>

        {/* Unified Filter Bar — date field locked to updated_at */}
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
          hideDateFieldSelector={true}
          onChange={updateFilters}
          onClearAll={() => updateFilters({
            search: '', mine: '', priority: 'all', category: 'all', company_id: 'all',
            checklist: '', dateFrom: '', dateTo: ''
          })}
          searchPlaceholder="Sök avslutade ärenden..."
        />

        {/* Loading state */}
        {isLoading && tickets.length === 0 ? (
          <div className="space-y-2">
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          search === '' && categoryFilter === 'all' && priorityFilter === 'all' && !checklistFilter && !dateFrom && !dateTo && !mine && companyFilter === 'all' ? (
            <EmptyState
              icon={<ArchiveIcon />}
              title="Inga avslutade ärenden ännu"
              description="Lösta och stängda ärenden visas här"
            />
          ) : (
            <EmptyState
              icon={<ArchiveIcon />}
              title="Inga avslutade ärenden matchar filtret"
              hasFilters
              onClearFilters={() => updateFilters({
                search: '', mine: '', priority: 'all', category: 'all', company_id: 'all',
                checklist: '', dateFrom: '', dateTo: ''
              })}
            />
          )
        ) : (
          <>
            <div className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
              <TicketTable
                tickets={tickets}
                users={users}
                onTicketClick={handleTicketClick}
                sortKey={sortKey === 'priority' || sortKey === 'category' ? sortKey : undefined}
                sortDirection={sortDirection}
                onSortChange={handleSortChange}
                enableStatusSort={false}
                compact={compactView}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
              />
            </div>

            {/* Pagination controls */}
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
        )}
      </div>

      {/* Floating bulk action bar */}
      <BulkActionBar
        selectedCount={selectedIds.length}
        canReopen={canReopenSelection}
        canAssign
        onReopen={handleBulkReopen}
        onChangePriority={handleBulkChangePriority}
        onAssign={handleBulkAssign}
        onExportCsv={handleBulkExportXlsx}
        onDeletePermanently={handleBulkDelete}
      />


      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={() => {
          setImportOpen(false);
          refetch();
        }}
      />
    </Layout>
  );
};

export default Archive;
