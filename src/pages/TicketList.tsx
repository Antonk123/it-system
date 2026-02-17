import { useState, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Download, Upload } from 'lucide-react';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useCategories } from '@/hooks/useCategories';
import { Layout } from '@/components/Layout';
import { TicketTable } from '@/components/TicketTable';
import { SearchBar } from '@/components/SearchBar';
import { PaginationControls } from '@/components/PaginationControls';
import { ImportDialog } from '@/components/ImportDialog';
import { Skeleton } from '@/components/ui/skeleton';
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

  // Read state from URL
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('limit')) || 50;
  const search = searchParams.get('search') || '';
  const statusFilter = (searchParams.get('status') || 'all') as TicketStatus | 'all';
  const priorityFilter = (searchParams.get('priority') || 'all') as TicketPriority | 'all';
  const categoryFilter = searchParams.get('category') || 'all';
  const sortKey = (searchParams.get('sortBy') || 'createdAt') as 'createdAt' | 'status' | 'priority' | 'category';
  const sortDirection = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';
  const [compactView, setCompactView] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Fetch with pagination
  const { tickets, pagination, isLoading, updateTicket, refetch } = useTickets({
    page,
    limit: pageSize,
    status: statusFilter,
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

  const handleSortChange = (key: 'status' | 'priority' | 'category') => {
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
      // Build query string with current filters (but no pagination)
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter);
      if (priorityFilter && priorityFilter !== 'all') params.append('priority', priorityFilter);
      if (categoryFilter && categoryFilter !== 'all') params.append('category', categoryFilter);
      if (search) params.append('search', search);
      const queryString = params.toString() ? `?${params.toString()}` : '';

      await api.exportTickets(queryString);
      toast.success('CSV-export lyckades!');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Misslyckades att exportera ärenden');
    }
  };

  const statusQuickFilters: { value: TicketStatus; label: string }[] = [
    { value: 'open', label: 'Öppen' },
    { value: 'in-progress', label: 'Pågående' },
    { value: 'waiting', label: 'Väntar' },
    { value: 'resolved', label: 'Löst' },
  ];

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
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Alla ärenden</h1>
            {pagination && (
              <p className="text-muted-foreground mt-1">
                Visar {((pagination.page - 1) * pagination.limit) + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)} av {pagination.total} ärenden
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
            <Select value={statusFilter} onValueChange={(v) => updateFilters({ status: v })}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla statusar</SelectItem>
                <SelectItem value="open">Öppen</SelectItem>
                <SelectItem value="in-progress">Pågående</SelectItem>
                <SelectItem value="waiting">Väntar</SelectItem>
                <SelectItem value="resolved">Löst</SelectItem>
              </SelectContent>
            </Select>
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
          </div>
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Snabbfilter:</span>
          {statusQuickFilters.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={statusFilter === item.value ? 'secondary' : 'outline'}
              onClick={() => updateFilters({ status: statusFilter === item.value ? 'all' : item.value })}
              className="h-7 px-3 text-xs"
            >
              {item.label}
            </Button>
          ))}
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
        ) : (
          <>
            <div className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
              <TicketTable
                tickets={tickets}
                users={users}
                onStatusChange={handleStatusChange}
                onCategoryChange={handleCategoryChange}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSortChange={handleSortChange}
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
    </Layout>
  );
};

export default TicketList;
