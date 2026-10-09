import { useState, useCallback, useEffect } from 'react';
import { useTickets } from '@/hooks/useTickets';
import { useAuth } from '@/contexts/AuthContext';
import { useCompanies } from '@/hooks/useCompanies';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUsers } from '@/hooks/useUsers';
import { useTicketListNavigation } from '@/hooks/useTicketListNavigation';
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
  const { user } = useAuth();
  const { companies } = useCompanies();
  const {
    searchParams, setSearchParams, statuses, mine, page, pageSize, search, priorityFilter,
    categoryFilter, checklistFilter, dateField, sortKey, sortDirection, dateFrom, dateTo,
    companyFilter, selectedIds, setSelectedIds, updateFilters, handlePageChange,
    handlePageSizeChange, handleSortChange, handleTicketClick,
  } = useTicketListNavigation(10);

  const [compactView, setCompactView] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Both resolved and closed tickets belong to Avslutade.
  const { tickets, pagination, isLoading, isError, bulkUpdateTickets, bulkDeleteTickets, refetch } = useTickets({
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

  // Bulk action handlers
  const handleBulkReopen = useCallback(async () => {
    try {
      const result = await bulkUpdateTickets(selectedIds, { status: 'open' });
      toast.success(`${result?.updated ?? selectedIds.length} ärenden öppnade igen`);
      setSelectedIds([]);
    } catch { /* Mutationen visar felet. */ }
  }, [selectedIds, bulkUpdateTickets, setSelectedIds]);

  const handleBulkChangePriority = useCallback(async (priority: TicketPriority) => {
    try {
      const result = await bulkUpdateTickets(selectedIds, { priority });
      toast.success(`Prioritet ändrad för ${result?.updated ?? selectedIds.length} ärenden`);
      setSelectedIds([]);
    } catch { /* Mutationen visar felet. */ }
  }, [selectedIds, bulkUpdateTickets, setSelectedIds]);

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
      const result = await bulkUpdateTickets(selectedIds, { assigned_to: userId });
      toast.success(`${result?.updated ?? selectedIds.length} ärenden tilldelade`);
      setSelectedIds([]);
    } catch { /* Mutationen visar felet. */ }
  }, [selectedIds, bulkUpdateTickets, setSelectedIds]);

  const handleBulkDelete = useCallback(async () => {
    try {
      const result = await bulkDeleteTickets(selectedIds);
      toast.success(`${result.deleted} ärenden raderade permanent`);
      setSelectedIds([]);
    } catch { /* Mutationen visar felet. */ }
  }, [selectedIds, bulkDeleteTickets, setSelectedIds]);

  return (
    <>
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


        <p className="text-xs text-muted-foreground">Datumfilter avser senast uppdaterat, för både lösta och stängda ärenden.</p>

        {/* Unified Filter Bar — date field locked to updated_at */}
        <UnifiedFilterBar
          companyActive={companyFilter !== 'all'}
          companyControl={        <Select value={companyFilter} onValueChange={(value) => updateFilters({ company_id: value })}>
          <SelectTrigger className="w-[180px]" aria-label="Företag"><SelectValue placeholder="Alla företag" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla företag</SelectItem>
            {companies.map(company => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}
          </SelectContent>
        </Select>}
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
        ) : isError ? (
          <div className="text-center py-12 space-y-2" role="alert">
            <p className="text-destructive text-sm">Kunde inte hämta avslutade ärenden</p>
            <Button variant="outline" size="sm" onClick={refetch}>Försök igen</Button>
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
    </>
  );
};

export default Archive;
