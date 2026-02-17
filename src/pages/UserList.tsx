import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { Plus, Pencil, Trash2, Users as UsersIcon, Ticket, Download, Upload, Loader2 } from 'lucide-react';
import { useUsers } from '@/hooks/useUsers';
import { useTickets } from '@/hooks/useTickets';
import { Layout } from '@/components/Layout';
import { SearchBar } from '@/components/SearchBar';
import { UserTicketHistory } from '@/components/UserTicketHistory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { User } from '@/types/ticket';

const UserList = () => {
  const { users, addUser, updateUser, deleteUser, refetch } = useUsers();
  const { tickets } = useTickets();
  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', department: '' });
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Import state
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openTicketsByUser = useMemo(() => {
    const counts: Record<string, number> = {};
    tickets.forEach(ticket => {
      if (ticket.requesterId && ticket.status !== 'closed') {
        counts[ticket.requesterId] = (counts[ticket.requesterId] || 0) + 1;
      }
    });
    return counts;
  }, [tickets]);

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
    const searchValue = normalizeSearch(search);
    if (searchValue === '') return true;
    return normalizeSearch(user.name).includes(searchValue) ||
      normalizeSearch(user.email).includes(searchValue) ||
      normalizeSearch(user.department || '').includes(searchValue);
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      updateUser(editingUser.id, formData);
    } else {
      addUser(formData);
    }
    setFormData({ name: '', email: '', department: '' });
    setEditingUser(null);
    setIsDialogOpen(false);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({ name: user.name, email: user.email, department: user.department || '' });
    setIsDialogOpen(true);
  };

  const handleDialogClose = () => {
    setFormData({ name: '', email: '', department: '' });
    setEditingUser(null);
    setIsDialogOpen(false);
  };

  const handleExport = async () => {
    try {
      await api.exportContacts();
      toast.success('Användare exporterade till CSV');
    } catch (error) {
      console.error('Export failed:', error);
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
      console.error('Preview failed:', error);
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
      console.error('Import failed:', error);
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
            <h1 className="text-2xl font-bold text-foreground">Användare</h1>
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
              Exportera CSV
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
            <Dialog open={isDialogOpen} onOpenChange={(open) => !open && handleDialogClose()}>
              <DialogTrigger asChild>
                <Button className="gap-2" onClick={() => setIsDialogOpen(true)}>
                  <Plus className="w-4 h-4" />
                  Lägg till användare
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingUser ? 'Redigera användare' : 'Lägg till ny användare'}</DialogTitle>
                <DialogDescription>Skapa eller uppdatera en användare i systemet.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Namn *</Label>
                  <Input
                    id="name"
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
                  <Label htmlFor="department">Avdelning</Label>
                  <Input
                    id="department"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    placeholder="Försäljning, Teknik, etc."
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={handleDialogClose}>
                    Avbryt
                  </Button>
                  <Button type="submit">
                    {editingUser ? 'Spara ändringar' : 'Lägg till användare'}
                  </Button>
                </div>
              </form>
            </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="max-w-md">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Sök användare..."
          />
        </div>

        {filteredUsers.length === 0 && search === '' ? (
          <div className="text-center py-16 border rounded-lg bg-card">
            <UsersIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Inga användare ännu</p>
            <p className="text-sm text-muted-foreground mt-1">
              Lägg till användare för att tilldela dem ärenden
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUsers.map(user => (
              <Card key={user.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-foreground truncate">{user.name}</h3>
                        {openTicketsByUser[user.id] > 0 && (
                          <Badge variant="secondary" className="shrink-0">
                            {openTicketsByUser[user.id]} öppna
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                      {user.department && (
                        <p className="text-sm text-muted-foreground mt-1">{user.department}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        Tillagd {format(user.createdAt, 'd MMM yyyy', { locale: sv })}
                      </p>
                    </div>
                    <div className="flex gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleEdit(user)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
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
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-3 gap-2"
                    onClick={() => setSelectedUser(user)}
                  >
                    <Ticket className="w-4 h-4" />
                    Visa ärenden
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
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
                    <p className="text-2xl font-bold">{importPreview.total}</p>
                  </div>
                  <div className="border rounded-lg p-3 bg-green-50 dark:bg-green-950/20">
                    <div className="flex items-center gap-2 text-green-600 mb-1">
                      <Plus className="w-4 h-4" />
                      <span className="text-sm">Giltiga</span>
                    </div>
                    <p className="text-2xl font-bold text-green-600">{importPreview.valid}</p>
                  </div>
                  <div className="border rounded-lg p-3 bg-red-50 dark:bg-red-950/20">
                    <div className="flex items-center gap-2 text-red-600 mb-1">
                      <Trash2 className="w-4 h-4" />
                      <span className="text-sm">Ogiltiga</span>
                    </div>
                    <p className="text-2xl font-bold text-red-600">{importPreview.invalid}</p>
                  </div>
                </div>

                {importPreview.results.filter((r: any) => !r.valid).length > 0 && (
                  <div className="border rounded-lg p-4 bg-red-50 dark:bg-red-950/20">
                    <h4 className="font-semibold mb-2 text-red-900 dark:text-red-100">
                      Valideringsfel ({importPreview.results.filter((r: any) => !r.valid).length} st)
                    </h4>
                    <div className="space-y-3 max-h-60 overflow-y-auto">
                      {importPreview.results
                        .filter((r: any) => !r.valid)
                        .slice(0, 10)
                        .map((result: any, idx: number) => (
                          <div key={idx} className="text-sm border-b border-red-200 dark:border-red-800 pb-2 last:border-0">
                            <p className="font-medium text-red-800 dark:text-red-200">
                              {result.contact.name || result.contact.email || '(Tom rad)'}
                            </p>
                            {result.contact.email && (
                              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                {result.contact.email}
                              </p>
                            )}
                            <ul className="list-disc list-inside text-red-700 dark:text-red-300 mt-1">
                              {result.errors.map((error: string, i: number) => (
                                <li key={i}>{error}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                    </div>
                    {importPreview.results.filter((r: any) => !r.valid).length > 10 && (
                      <p className="text-sm text-red-700 dark:text-red-300 mt-2">
                        ... och {importPreview.results.filter((r: any) => !r.valid).length - 10} till
                      </p>
                    )}
                  </div>
                )}

                {importPreview.results.filter((r: any) => r.valid).length > 0 && (
                  <div className="border rounded-lg p-4 bg-green-50 dark:bg-green-950/20">
                    <h4 className="font-semibold mb-2 text-green-900 dark:text-green-100">
                      Giltiga användare ({importPreview.results.filter((r: any) => r.valid).length} st)
                    </h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {importPreview.results
                        .filter((r: any) => r.valid)
                        .slice(0, 5)
                        .map((result: any, idx: number) => (
                          <div key={idx} className="text-sm">
                            <p className="font-medium text-green-800 dark:text-green-200">
                              {result.contact.name}
                            </p>
                            <p className="text-xs text-green-600 dark:text-green-400">
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
