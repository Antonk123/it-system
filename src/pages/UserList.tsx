import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Users as UsersIcon, Download, Upload, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useUsers } from '@/hooks/useUsers';
import { useCompanies } from '@/hooks/useCompanies';
import { Layout } from '@/components/Layout';
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
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { User } from '@/types/ticket';

const UserList = () => {
  const { users, isLoading: usersLoading, isError, addUser, updateUser, deleteUser, refetch } = useUsers();
  const { companies } = useCompanies();
  // Serverside-aggregat istället för att ladda hela ticket-listan client-side.
  const { data: openTicketsByUser = {} } = useQuery({
    queryKey: ['requester-open-counts'],
    queryFn: () => api.getRequesterOpenCounts(),
    staleTime: 60_000,
  });
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', department: '', company_id: '' });
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const ITEMS_PER_PAGE = 10;

  // Import state
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-open user sheet if highlight param exists
  useEffect(() => {
    const highlightId = searchParams.get('highlight');
    if (highlightId && users.length > 0) {
      const user = users.find(u => u.id === highlightId);
      if (user) {
        setSelectedUser(user);
        // Clear highlight param to avoid re-opening on refresh
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('highlight');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, users, setSearchParams]);

  const normalizeSearch = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const filteredUsers = users.filter(user => {
    if (companyFilter !== 'all') {
      const uid = (user as any).company_id;
      if (companyFilter === 'none') { if (uid) return false; }
      else if (uid !== companyFilter) return false;
    }
    const searchValue = normalizeSearch(search);
    if (searchValue === '') return true;
    return normalizeSearch(user.name).includes(searchValue) ||
      normalizeSearch(user.email).includes(searchValue) ||
      normalizeSearch(user.department || '').includes(searchValue);
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [search, companyFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingUser) return;
    setIsSavingUser(true);
    try {
      if (editingUser) {
        // updateUser throws via mutateAsync on failure
        await updateUser(editingUser.id, formData);
        toast.success('Användare uppdaterad');
      } else {
        // addUser swallows errors and returns null; hook shows toast.error
        const created = await addUser(formData);
        if (!created) {
          return;
        }
        toast.success('Användare tillagd');
      }
      setFormData({ name: '', email: '', department: '', company_id: '' });
      setEditingUser(null);
      setIsDialogOpen(false);
    } catch (error: any) {
      toast.error(error?.message || 'Kunde inte spara användare');
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

  const handleExport = async () => {
    try {
      await api.exportContacts();
      toast.success('Användare exporterade till Excel');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Export failed:', error);
      toast.error('Misslyckades att exportera användare');
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

    setImportFile(file);
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
      toast.error('Inga giltiga användare att importera');
      return;
    }

    setIsImporting(true);
    try {
      const result = await api.importContactsConfirm(validContacts);
      toast.success(`${result.created} användare importerade!`);
      if (result.failed > 0) {
        toast.warning(`${result.failed} användare misslyckades`);
      }
      setIsImportDialogOpen(false);
      setImportFile(null);
      setImportPreview(null);
      refetch();
    } catch (error: any) {
      if (import.meta.env.DEV) console.error('Import failed:', error);
      toast.error(error.message || 'Misslyckades att importera användare');
    } finally {
      setIsImporting(false);
    }
  };

  const handleCloseImportDialog = () => {
    setIsImportDialogOpen(false);
    setImportFile(null);
    setImportPreview(null);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Användare</h1>
            <p className="text-muted-foreground mt-1">
              {users.length} användare i systemet
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
                  Lägg till användare
                </Button>
              </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingUser ? 'Redigera användare' : 'Lägg till ny användare'}</DialogTitle>
                <DialogDescription>Skapa eller uppdatera en användare i systemet.</DialogDescription>
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
                    <SelectTrigger>
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
                    {editingUser ? 'Spara ändringar' : 'Lägg till användare'}
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
              onChange={setSearch}
              placeholder="Sök användare..."
            />
          </div>
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-[220px] shrink-0">
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
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
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
            <p className="text-destructive text-sm">Kunde inte hämta användare</p>
            <Button variant="outline" size="sm" onClick={refetch}>Försök igen</Button>
          </div>
        ) : filteredUsers.length === 0 ? (
          search === '' && companyFilter === 'all' ? (
            <EmptyState
              icon={<UsersIcon />}
              title="Inga användare ännu"
              description="Lägg till användare för att tilldela dem ärenden"
            />
          ) : (
            <EmptyState
              icon={<UsersIcon />}
              title="Inga användare matchar filtret"
              hasFilters
              onClearFilters={() => {
                setSearch('');
                setCompanyFilter('all');
              }}
            />
          )
        ) : (
          <>
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
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
                          className="h-8 w-8"
                          onClick={() => handleEdit(user)}
                          aria-label="Redigera användare"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Ta bort användare">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Ta bort användare</AlertDialogTitle>
                              <AlertDialogDescription>
                                Är du säker på att du vill ta bort {user.name}? Denna åtgärd kan inte ångras.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Avbryt</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteUser(user.id)}>
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
                Visar {startIndex + 1}-{Math.min(endIndex, filteredUsers.length)} av {filteredUsers.length} användare
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
              <DialogTitle>Importera användare från CSV</DialogTitle>
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
                    <div className="flex items-center gap-2 text-success mb-1">
                      <Plus className="w-4 h-4" />
                      <span className="text-sm">Giltiga</span>
                    </div>
                    <p className="text-2xl font-bold text-success font-mono tabular-nums">{importPreview.valid}</p>
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
                    <h4 className="font-semibold mb-2 text-success">
                      Giltiga användare ({importPreview.results.filter((r: any) => r.valid).length} st)
                    </h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {importPreview.results
                        .filter((r: any) => r.valid)
                        .slice(0, 5)
                        .map((result: any, idx: number) => (
                          <div key={idx} className="text-sm">
                            <p className="font-medium text-success">
                              {result.contact.name}
                            </p>
                            <p className="text-xs text-success">
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
                      `Importera ${importPreview.valid} användare`
                    )}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default UserList;
