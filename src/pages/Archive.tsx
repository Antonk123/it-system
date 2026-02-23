import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useCategories } from '@/hooks/useCategories';
import { Layout } from '@/components/Layout';
import { TicketTable } from '@/components/TicketTable';
import { SearchBar } from '@/components/SearchBar';
import { PaginationControls } from '@/components/PaginationControls';
import { Skeleton } from '@/components/ui/skeleton';
import { Archive as ArchiveIcon, Download, Upload } from 'lucide-react';
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
import { ImportDialog } from '@/components/ImportDialog';

const statusLabels: Record<TicketStatus, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

const Archive = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read state from URL
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('limit')) || 25;
  const search = searchParams.get('search') || '';
  const categoryFilter = searchParams.get('category') || 'all';
  const priorityFilter = (searchParams.get('priority') || 'all') as TicketPriority | 'all';
  const sortKey = (searchParams.get('sortBy') || 'createdAt') as 'createdAt' | 'priority' | 'category';
  const sortDirection = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';
  const [compactView, setCompactView] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Fetch with pagination - filter for closed tickets
  const { tickets, pagination, isLoading, updateTicket } = useTickets({
    page,
    limit: pageSize,
    status: 'closed',
    priority: priorityFilter,
    category: categoryFilter,
    search,
    sortBy: sortKey,
    sortDir: sortDirection,
  });

  const { users } = useUsers();
  const { categories } = useCategories();

  // Update URL params
  const updateFilters = useCallback((updates: Record<string, any>) => {
    const newParams = new URLSearchParams(searchParams);

    Object.entries(updates).forEach(([key, value]) => {
      if (value && value !== 'all') {
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
  }, [searchParams, setSearchParams]);

  // Event handlers
  const handleSearchChange = (newSearch: string) => {
    updateFilters({ search: newSearch });
  };

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

  const handleStatusChange = async (ticketId: string, status: TicketStatus) => {
    await updateTicket(ticketId, { status });
    toast.success(`Status uppdaterad till ${statusLabels[status]}`);
  };

  const handleCategoryChange = async (ticketId: string, categoryId: string) => {
    await updateTicket(ticketId, { category: categoryId });
    const categoryLabel = categories.find(c => c.id === categoryId)?.label || categoryId;
    toast.success(`Kategori uppdaterad till ${categoryLabel}`);
  };

  const handleExport = async () => {
    try {
      // Build query string with current filters (always include status=closed for archive)
      const params = new URLSearchParams();
      params.append('status', 'closed');
      if (priorityFilter && priorityFilter !== 'all') params.append('priority', priorityFilter);
      if (categoryFilter && categoryFilter !== 'all') params.append('category', categoryFilter);
      if (search) params.append('search', search);
      const queryString = `?${params.toString()}`;

      await api.exportTickets(queryString);
      toast.success('CSV-export lyckades!');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Misslyckades att exportera arkiverade ärenden');
    }
  };

  const priorityQuickFilters: { value: TicketPriority; label: string }[] = [
    { value: 'high', label: 'Hög' },
    { value: 'critical', label: 'Kritisk' },
  ];

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Arkiv</h1>
            {pagination && (
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="h-8 gap-2"
            >
              <Download className="w-4 h-4" />
              Exportera CSV
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 max-w-md">
            <SearchBar
              value={search}
              onChange={handleSearchChange}
              placeholder="Sök arkiverade ärenden..."
            />
          </div>
          <Select value={categoryFilter} onValueChange={(v) => updateFilters({ category: v })}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Alla kategorier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla kategorier</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

        {/* Loading state */}
        {isLoading && tickets.length === 0 ? (
          <div className="space-y-2">
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : tickets.length === 0 && search === '' && categoryFilter === 'all' && priorityFilter === 'all' ? (
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
                onCategoryChange={handleCategoryChange}
                sortKey={sortKey === 'priority' || sortKey === 'category' ? sortKey : undefined}
                sortDirection={sortDirection}
                onSortChange={handleSortChange}
                enableStatusSort={false}
                compact={compactView}
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
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={() => {
          setImportOpen(false);
        }}
      />
    </Layout>
  );
};

export default Archive;
