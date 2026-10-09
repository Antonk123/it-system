import { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus, Pencil, Trash2, Users as UsersIcon, Download, Upload, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useUsers, useContactsPage, CONTACTS_PAGE_SIZE } from '@/hooks/useUsers';
import { requesterOpenCountsKeys } from '@/hooks/invalidateTicketDerived';
import { useDebounce } from '@/hooks/useDebounce';
import { useCompanies } from '@/hooks/useCompanies';
import { SearchBar } from '@/components/SearchBar';
import { EmptyState } from '@/components/EmptyState';
import { UserTicketHistory } from '@/components/UserTicketHistory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { User } from '@/types/ticket';

const UserList = () => {
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const debouncedSearch = useDebounce(search, 300);
  // Sök och sidor hanteras av servern. Företagsfiltret finns inte i servern,
  // så när det är aktivt filtreras hela kontaktlistan (max 500) här i stället.
  const filteringByCompany = companyFilter !== 'all';
  const {
    users: allUsers, isLoading: allLoading, isError: allError, addUser, updateUser, deleteUser, refetch,
  } = useUsers({ enabled: filteringByCompany || searchParams.has('highlight') });
  const pageResult = useContactsPage(currentPage, debouncedSearch, !filteringByCompany);
  const { companies } = useCompanies();
  // Serverside-aggregat istället för att ladda hela ticket-listan client-side.
  const { data: openTicketsByUser = {} } = useQuery({
    queryKey: requesterOpenCountsKeys.all,
    queryFn: () => api.getRequesterOpenCounts(),
    staleTime: 60_000,
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', department: '', company_id: '' });
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isSavingUser, setIsSavingUser] = useState(false);

  useEffect(() => {
    const companyId = searchParams.get('newContact');
    if (!companyId || !companies.some(company => company.id === companyId)) return;
    setEditingUser(null);
    setFormData({ name: '', email: '', department: '', company_id: companyId });
    setIsDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('newContact');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, companies]);

  // Import state
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-open user sheet if highlight param exists
  useEffect(() => {
    const highlightId = searchParams.get('highlight');
    if (highlightId && allUsers.length > 0) {
      const user = allUsers.find(u => u.id === highlightId);
      if (user) {
        setSelectedUser(user);
        // Clear highlight param to avoid re-opening on refresh
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('highlight');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, allUsers, setSearchParams]);

  const normalizeSearch = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const companyMatches = allUsers.filter(user => {
    if (companyFilter === 'none') { if (user.company_id) return false; }
    else if (user.company_id !== companyFilter) return false;
    const searchValue = normalizeSearch(search);
    if (searchValue === '') return true;
    return normalizeSearch(user.name).includes(searchValue) ||
      normalizeSearch(user.email).includes(searchValue) ||
      normalizeSearch(user.department || '').includes(searchValue);
  });

  const total = filteringByCompany ? companyMatches.length : pageResult.total;
  const usersLoading = filteringByCompany ? allLoading : pageResult.isLoading;
  const isError = filteringByCompany ? allError : pageResult.isError;
  const pageStart = (currentPage - 1) * CONTACTS_PAGE_SIZE;
  const paginatedUsers = filteringByCompany
    ? companyMatches.slice(pageStart, pageStart + CONTACTS_PAGE_SIZE)
    : pageResult.users;
  const totalPages = Math.ceil(total / CONTACTS_PAGE_SIZE);
  const endIndex = pageStart + paginatedUsers.length;

  // Sidan kan ha blivit för hög efter en borttagning.
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const handleCompanyFilterChange = (value: string) => {
    setCompanyFilter(value);
    setCurrentPage(1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingUser) return;
    setIsSavingUser(true);
    try {
      if (editingUser) {
        await updateUser(editingUser.id, formData);
        toast.success('Kontakt uppdaterad');
      } else {
        // addUser swallows errors and returns null
        const created = await addUser(formData);
        if (!created) {
          return;
        }
        toast.success('Kontakt tillagd');
      }
      setFormData({ name: '', email: '', department: '', company_id: '' });
      setEditingUser(null);
      setIsDialogOpen(false);
    } catch {
      // useUsers visar serverns meddelande (t.ex. dubblett-e-post); dialogen står kvar för rättning.
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({ name: user.name, email: user.email, department: user.department || '', company_id: (user as any).company_id || '' });
    setIsDialogOpen(true);
  };

  const handleDialogClose = () => {
    setFormData({ name: '', email: '', department: '', company_id: '' });
    setEditingUser(null);
    setIsDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteUser(id);
      toast.success('Kontakt borttagen');
    } catch {
      // useUsers visar felet som toast.
    }
  };

  const handleExport = async () => {
    try {
      await api.exportContacts();
      toast.success('Kontakter exporterade till Excel');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Export failed:', error);
      toast.error('Misslyckades att exportera kontakter');
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      toast.error('Endast CSV-filer är tillåtna');
      return;
    }

    setIsImporting(true);

    try {
      const preview = await api.importContactsPreview(file);
      setImportPreview(preview);
      setIsImportDialogOpen(true);
    } catch (error: any) {
      if (import.meta.env.DEV) console.error('Preview failed:', error);
      toast.error(error.message || 'Misslyckades att förhandsgranska import');
    } finally {
      setIsImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;

    const validContacts = importPreview.results
      .filter((r: any) => r.valid)
      .map((r: any) => r.contact);

    if (validContacts.length === 0) {
      toast.error('Inga giltiga kontakter att importera');
      return;
    }

    setIsImporting(true);
    try {
      const result = await api.importContactsConfirm(validContacts);
      toast.success(`${result.created} kontakter importerade!`);
      if (result.failed > 0) {
        toast.warning(`${result.failed} kontakter misslyckades`);
      }
      setIsImportDialogOpen(false);
      setImportPreview(null);
      refetch();
    } catch (error: any) {
      if (import.meta.env.DEV) console.error('Import failed:', error);
      toast.error(error.message || 'Misslyckades att importera kontakter');
    } finally {
      setIsImporting(false);
    }
  };

  const handleCloseImportDialog = () => {
    setIsImportDialogOpen(false);
    setImportPreview(null);
  };

  return (
    <div className="space-y-6">
<nav aria-label="Kontakter och företag" className="flex gap-4 border-b pb-3"><Link className="inline-flex min-h-11 items-center hover:underline" to="/users" aria-current="page">Kontakter</Link><Link className="inline-flex min-h-11 items-center hover:underline" to="/companies">Företag</Link></nav>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Kontakter</h1>
          <p className="text-muted-foreground mt-1">
            {total} {total === 1 ? 'kontakt' : 'kontakter'} {search || filteringByCompany ? 'matchar' : 'i systemet'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            Exportera Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleImportClick}
            disabled={isImporting}
            className="gap-2"
          >
            {isImporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            Importera CSV
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              // Blockera Esc/click-outside mid-save så formstate inte rivs medan
              // async-anropet fortfarande är in-flight. Användaren får trycka Avbryt
              // efter att spinnarna tagit slut.
              if (!open && isSavingUser) return;
              if (!open) handleDialogClose();
            }}
          >
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => setIsDialogOpen(true)}>
                <Plus className="w-4 h-4" />
                Lägg till kontakt
              </Button>
            </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingUser ? 'Redigera kontakt' : 'Lägg till ny kontakt'}</DialogTitle>
              <DialogDescription>Skapa eller uppdatera en kontakt i systemet.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Namn *</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  autoCapitalize="words"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Johan Andersson"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-post *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="johan@foretag.se"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Företag</Label>
                <Select value={formData.company_id || 'none'} onValueChange={(v) => setFormData({ ...formData, company_id: v === 'none' ? '' : v })}>
                  <SelectTrigger aria-label="Företag">
                    <SelectValue placeholder="Inget företag" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Inget företag</SelectItem>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Avdelning</Label>
                <Input
                  id="department"
                  autoCapitalize="words"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  placeholder="T.ex. Tillverkning - Norsjö"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={handleDialogClose} disabled={isSavingUser}>
                  Avbryt
                </Button>
                <Button type="submit" disabled={isSavingUser}>
                  {isSavingUser && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {editingUser ? 'Spara ändringar' : 'Lägg till kontakt'}
                </Button>
              </div>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-3 max-w-2xl">
        <div className="flex-1 min-w-0">
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Sök kontakter..."
          />
        </div>
        <Select value={companyFilter} onValueChange={handleCompanyFilterChange}>
          <SelectTrigger aria-label="Filtrera på företag" className="w-[220px] shrink-0">
            <SelectValue placeholder="Alla företag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla företag</SelectItem>
            <SelectItem value="none">Utan företag</SelectItem>
            {companies.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {usersLoading ? (
        <div className="border rounded-lg bg-card max-h-[calc(100dvh-16rem)] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b bg-muted">
                <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground">Namn</th>
                <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">E-post</th>
                <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Företag</th>
                <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Avdelning</th>
                <th scope="col" className="text-right px-4 py-3 font-medium text-muted-foreground tabular-nums">Öppna ärenden</th>
                <th scope="col" className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                  <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-40" /></td>
                  <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-28" /></td>
                  <td className="px-4 py-3 hidden lg:table-cell"><Skeleton className="h-4 w-24" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-8 ml-auto" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-8 w-16 ml-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : isError ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-destructive text-sm">Kunde inte hämta kontakter</p>
          <Button variant="outline" size="sm" onClick={refetch}>Försök igen</Button>
        </div>
      ) : total === 0 ? (
        search === '' && companyFilter === 'all' ? (
          <EmptyState
            icon={<UsersIcon />}
            title="Inga kontakter ännu"
            description="Lägg till kontakter som beställare av ärenden"
          />
        ) : (
          <EmptyState
            icon={<UsersIcon />}
            title="Inga kontakter matchar filtret"
            hasFilters
            onClearFilters={() => {
              handleSearchChange('');
              handleCompanyFilterChange('all');
            }}
          />
        )
      ) : (
        <>
        <div className="border rounded-lg bg-card max-h-[calc(100dvh-16rem)] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b bg-muted">
                <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground">Namn</th>
                <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">E-post</th>
                <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Företag</th>
                <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Avdelning</th>
                <th scope="col" className="text-right px-4 py-3 font-medium text-muted-foreground tabular-nums">Öppna ärenden</th>
                <th scope="col" className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paginatedUsers.map(user => (
                <tr
                  key={user.id}
                  className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => setSelectedUser(user)}
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    <button
                      type="button"
                      className="text-left rounded-sm hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(e) => { e.stopPropagation(); setSelectedUser(user); }}
                    >
                      {user.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{user.email}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {(user as any).company_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                    {user.department || '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <div className="flex justify-end">
                      {openTicketsByUser[user.id] > 0 ? (
                        <Badge variant="secondary">{openTicketsByUser[user.id]}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </div>
                  </td>
                  <td
                    className="px-4 py-3"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 md:h-8 md:w-8"
                        onClick={() => handleEdit(user)}
                        aria-label="Redigera kontakt"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8 text-destructive" aria-label="Ta bort kontakt">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Ta bort kontakt</AlertDialogTitle>
                            <AlertDialogDescription>
                              Är du säker på att du vill ta bort {user.name}? Denna åtgärd kan inte ångras.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Avbryt</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(user.id)}>
                              Ta bort
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-sm text-muted-foreground">
              Visar {pageStart + 1}-{endIndex} av {total} kontakter
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                Föregående
              </Button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
                  // Show first page, last page, current page, and pages around current
                  const showPage =
                    page === 1 ||
                    page === totalPages ||
                    (page >= currentPage - 1 && page <= currentPage + 1);

                  const showEllipsis =
                    (page === 2 && currentPage > 3) ||
                    (page === totalPages - 1 && currentPage < totalPages - 2);

                  if (showEllipsis) {
                    return <span key={page} className="px-2 text-muted-foreground">...</span>;
                  }

                  if (!showPage) return null;

                  return (
                    <Button
                      key={page}
                      variant={currentPage === page ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCurrentPage(page)}
                      className="w-9 h-9 p-0"
                    >
                      {page}
                    </Button>
                  );
                })}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="gap-1"
              >
                Nästa
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
        </>
      )}

      {/* Ticket History Sheet */}
      <Sheet open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedUser?.name}s ärenden</SheetTitle>
            <SheetDescription>Ärenden som kontakten har skapat.</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            {selectedUser && <UserTicketHistory userId={selectedUser.id} />}
          </div>
        </SheetContent>
      </Sheet>

      {/* Import Preview Dialog */}
      <Dialog open={isImportDialogOpen} onOpenChange={handleCloseImportDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importera kontakter från CSV</DialogTitle>
            <DialogDescription>
              Granska förhandsvisningen innan du bekräftar importen
            </DialogDescription>
          </DialogHeader>

          {importPreview && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="border rounded-lg p-3 bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <UsersIcon className="w-4 h-4" />
                    <span className="text-sm">Totalt</span>
                  </div>
                  <p className="text-2xl font-bold font-mono tabular-nums">{importPreview.total}</p>
                </div>
                <div className="border rounded-lg p-3 bg-success/10">
                  <div className="flex items-center gap-2 text-success-text mb-1">
                    <Plus className="w-4 h-4" />
                    <span className="text-sm">Giltiga</span>
                  </div>
                  <p className="text-2xl font-bold text-success-text font-mono tabular-nums">{importPreview.valid}</p>
                </div>
                <div className="border rounded-lg p-3 bg-destructive/10">
                  <div className="flex items-center gap-2 text-destructive mb-1">
                    <Trash2 className="w-4 h-4" />
                    <span className="text-sm">Ogiltiga</span>
                  </div>
                  <p className="text-2xl font-bold text-destructive font-mono tabular-nums">{importPreview.invalid}</p>
                </div>
              </div>

              {importPreview.results.filter((r: any) => !r.valid).length > 0 && (
                <div className="border rounded-lg p-4 bg-destructive/10">
                  <h4 className="font-semibold mb-2 text-destructive">
                    Valideringsfel ({importPreview.results.filter((r: any) => !r.valid).length} st)
                  </h4>
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {importPreview.results
                      .filter((r: any) => !r.valid)
                      .slice(0, 10)
                      .map((result: any, idx: number) => (
                        <div key={idx} className="text-sm border-b border-destructive/20 pb-2 last:border-0">
                          <p className="font-medium text-destructive">
                            {result.contact.name || result.contact.email || '(Tom rad)'}
                          </p>
                          {result.contact.email && (
                            <p className="text-xs text-destructive mt-1">
                              {result.contact.email}
                            </p>
                          )}
                          <ul className="list-disc list-inside text-destructive mt-1">
                            {result.errors.map((error: string, i: number) => (
                              <li key={i}>{error}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </div>
                  {importPreview.results.filter((r: any) => !r.valid).length > 10 && (
                    <p className="text-sm text-destructive mt-2">
                      ... och {importPreview.results.filter((r: any) => !r.valid).length - 10} till
                    </p>
                  )}
                </div>
              )}

              {importPreview.results.filter((r: any) => r.valid).length > 0 && (
                <div className="border rounded-lg p-4 bg-success/10">
                  <h4 className="font-semibold mb-2 text-success-text">
                    Giltiga kontakter ({importPreview.results.filter((r: any) => r.valid).length} st)
                  </h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {importPreview.results
                      .filter((r: any) => r.valid)
                      .slice(0, 5)
                      .map((result: any, idx: number) => (
                        <div key={idx} className="text-sm">
                          <p className="font-medium text-success-text">
                            {result.contact.name}
                          </p>
                          <p className="text-xs text-success-text">
                            {result.contact.email}
                            {result.contact.company && ` | ${result.contact.company}`}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleCloseImportDialog}>
                  Avbryt
                </Button>
                <Button
                  onClick={handleConfirmImport}
                  disabled={importPreview.valid === 0 || isImporting}
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Importerar...
                    </>
                  ) : (
                    `Importera ${importPreview.valid} kontakter`
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserList;
