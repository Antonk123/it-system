import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { Layout } from '@/components/Layout';
import { TicketTable } from '@/components/TicketTable';
import { PaginationControls } from '@/components/PaginationControls';
import { Skeleton } from '@/components/ui/skeleton';
import { Archive as ArchiveIcon, Upload } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { TicketStatus, TicketPriority } from '@/types/ticket';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ImportDialog } from '@/components/ImportDialog';
import { UnifiedFilterBar } from '@/components/UnifiedFilterBar';
import { BulkActionBar } from '@/components/BulkActionBar';
import { FilterViewManager } from '@/components/FilterViewManager';
import { useFilterViews } from '@/hooks/useFilterViews';

const statusLabels: Record<TicketStatus, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

const Archive = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Read state from URL
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('limit')) || 10;
  const search = searchParams.get('search') || '';
  const categoryFilter = searchParams.get('category') || 'all';
  const priorityFilter = (searchParams.get('priority') || 'all') as TicketPriority | 'all';
  const tagsFilter = searchParams.get('tags') || '';
  const selectedTagIds = tagsFilter ? tagsFilter.split(',').filter(id => id.trim()) : [];
  const tagMode = (searchParams.get('tagMode') || 'or') as 'or' | 'and';
  const checklistFilter = searchParams.get('checklist') || '';
  const dateField = 'closed_at' as const; // Locked per D-06
  const sortKey = (searchParams.get('sortBy') || 'createdAt') as 'createdAt' | 'priority' | 'category';
  const sortDirection = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';

  const [compactView, setCompactView] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ ticketId: string; status: TicketStatus } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [manageViewsOpen, setManageViewsOpen] = useState(false);

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

  // Fetch with pagination - filter for closed tickets
  const { tickets, pagination, isLoading, updateTicket, refetch } = useTickets({
    page,
    limit: pageSize,
    status: 'closed',
    priority: priorityFilter,
    category: categoryFilter,
    search,
    tags: tagsFilter,
    tagMode,
    dateFrom,
    dateTo,
    dateField: 'closed_at',
    checklist: checklistFilter,
    sortBy: sortKey,
    sortDir: sortDirection,
  });

  const { users } = useUsers();

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
  }, [page, priorityFilter, categoryFilter, tagsFilter, search, checklistFilter, dateFrom, dateTo]);

  // Update URL params
  const updateFilters = useCallback((updates: Record<string, any>) => {
    const newParams = new URLSearchParams(searchParams);

    Object.entries(updates).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // Handle arrays (tags)
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

  const handleStatusChange = (ticketId: string, status: TicketStatus) => {
    setPendingStatusChange({ ticketId, status });
  };

  const confirmStatusChange = async () => {
    if (!pendingStatusChange) return;
    try {
      await updateTicket(pendingStatusChange.ticketId, { status: pendingStatusChange.status });
      toast.success(`Status uppdaterad till ${statusLabels[pendingStatusChange.status]}`);
    } catch {
      toast.error('Kunde inte uppdatera status');
    } finally {
      setPendingStatusChange(null);
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
    const selected = tickets.filter(t => selectedIds.includes(t.id));
    if (selected.length === 0) return;

    const XLSX = await import('xlsx');
    const headers = ['ID', 'Titel', 'Prioritet', 'Kategori', 'Taggar', 'Stängd'];
    const rows = selected.map(t => [
      t.id,
      t.title,
      t.priority,
      t.category || '',
      (t.tags || []).map((tag: { name: string }) => tag.name).join('; '),
      t.closedAt || '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Arkiv');
    const xlsxData = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const blob = new Blob([xlsxData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arkiv-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);

    toast.success(`${selected.length} ärenden exporterade till Excel`);
  }, [tickets, selectedIds]);

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Arkiv</h1>
            {pagination && pagination.total > 0 && (
              <p className="text-muted-foreground mt-1">
                Visar {((pagination.page - 1) * pagination.limit) + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)} av {pagination.total} stängda ärenden
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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

        {/* Unified Filter Bar — status hidden, date field locked to closed_at */}
        <UnifiedFilterBar
          search={search}
          selectedStatuses={[]}
          priorityFilter={priorityFilter}
          categoryFilter={categoryFilter}
          selectedTagIds={selectedTagIds}
          tagMode={tagMode}
          checklistFilter={checklistFilter}
          dateFrom={dateFrom}
          dateTo={dateTo}
          dateField={dateField}
          hideStatus={true}
          hideDateFieldSelector={true}
          views={views}
          activeViewId={activeView?.id ?? null}
          onSelectView={(view) => applyView(view, 'archive')}
          onManageViews={() => setManageViewsOpen(true)}
          onChange={updateFilters}
          onClearAll={() => updateFilters({
            search: '', priority: 'all', category: 'all',
            tags: [], tagMode: 'or', checklist: '', dateFrom: '', dateTo: ''
          })}
          searchPlaceholder="Sök arkiverade ärenden..."
        />

        {/* Loading state */}
        {isLoading && tickets.length === 0 ? (
          <div className="space-y-2">
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : tickets.length === 0 && search === '' && categoryFilter === 'all' && priorityFilter === 'all' && !dateFrom && !dateTo ? (
          <div className="text-center py-16 border rounded-lg bg-card">
            <ArchiveIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Inga arkiverade ärenden ännu</p>
            <p className="text-sm text-muted-foreground mt-1">
              Stängda ärenden visas här
            </p>
          </div>
        ) : (
          <>
            <div className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
              <TicketTable
                tickets={tickets}
                users={users}
                onStatusChange={handleStatusChange}
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
        onReopen={handleBulkReopen}
        onChangePriority={handleBulkChangePriority}
        onExportCsv={handleBulkExportXlsx}
        onDeletePermanently={handleBulkDelete}
      />

      {/* Filter view manager dialog */}
      <FilterViewManager
        open={manageViewsOpen}
        onOpenChange={setManageViewsOpen}
        views={views}
        currentFilters={getCurrentFiltersAsView()}
        onCreateView={createView}
        onDeleteView={deleteView}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={() => {
          setImportOpen(false);
          refetch();
        }}
      />
      <AlertDialog open={!!pendingStatusChange} onOpenChange={(open) => { if (!open) setPendingStatusChange(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ändra status</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStatusChange && (
                <>Vill du ändra status till <strong>{statusLabels[pendingStatusChange.status]}</strong>?</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={confirmStatusChange}>Ändra</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
};

export default Archive;
