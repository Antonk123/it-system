import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, Search, Trash2, Loader2, MoreHorizontal } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { useCompanies, companyKeys } from '@/hooks/useCompanies';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';

const CompanyList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { companies, isLoading, isError, createCompany, deleteCompany } = useCompanies();
  const refetch = () => queryClient.invalidateQueries({ queryKey: companyKeys.list() });

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({
    name: '',
    org_number: '',
    email: '',
    phone: '',
    address: '',
  });

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  const hasFilters = search.trim() !== '';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;
    setIsCreating(true);
    try {
      // createCompany swallows errors and returns null; success/error toasts shown by hook
      const result = await createCompany(form);
      if (result) {
        setForm({ name: '', org_number: '', email: '', phone: '', address: '' });
        setCreateOpen(false);
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Företag
            </h1>
            <p className="text-muted-foreground mt-1">
              {companies.length} företag i systemet
            </p>
          </div>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Skapa företag
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Skapa nytt företag</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Namn *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Acme AB"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org_number">Org.nummer</Label>
                  <Input
                    id="org_number"
                    value={form.org_number}
                    onChange={e => setForm({ ...form, org_number: e.target.value })}
                    placeholder="556000-0000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">E-post</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="info@acme.se"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefon</Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="08-123 456"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Adress</Label>
                  <Input
                    id="address"
                    value={form.address}
                    onChange={e => setForm({ ...form, address: e.target.value })}
                    placeholder="Storgatan 1, 111 22 Stockholm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={isCreating}>
                    Avbryt
                  </Button>
                  <Button type="submit" disabled={isCreating || !form.name.trim()}>
                    {isCreating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Skapa företag
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Sök företag..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground">Namn</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Org.nummer</th>
                  <th scope="col" className="text-right tabular-nums px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Kontakter</th>
                  <th scope="col" className="text-right tabular-nums px-4 py-3 font-medium text-muted-foreground">Öppna ärenden</th>
                  <th scope="col" className="text-right tabular-nums px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Totalt</th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-4 py-3 hidden lg:table-cell"><Skeleton className="h-4 w-8" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-12" /></td>
                    <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-4 w-8" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-8" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : isError ? (
          <div className="text-center py-12 space-y-2">
            <p className="text-destructive text-sm">Kunde inte hämta företag</p>
            <Button variant="outline" size="sm" onClick={refetch}>Försök igen</Button>
          </div>
        ) : filtered.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={<Building2 />}
              title="Inga företag matchar sökningen"
              hasFilters
              onClearFilters={() => setSearch('')}
            />
          ) : (
            <EmptyState
              icon={<Building2 />}
              title="Inga företag ännu"
              description="Skapa ditt första företag för att börja gruppera kontakter och ärenden."
              action={
                <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
                  <Plus className="w-4 h-4" />
                  Skapa företag
                </Button>
              }
            />
          )
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground">Namn</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Org.nummer</th>
                  <th scope="col" className="text-right tabular-nums px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Kontakter</th>
                  <th scope="col" className="text-right tabular-nums px-4 py-3 font-medium text-muted-foreground">Öppna ärenden</th>
                  <th scope="col" className="text-right tabular-nums px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Totalt</th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(company => (
                  <tr
                    key={company.id}
                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                    onClick={() => navigate(`/companies/${company.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      <button
                        type="button"
                        className="text-left rounded-sm hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(e) => { e.stopPropagation(); navigate(`/companies/${company.id}`); }}
                      >
                        {company.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                      {company.org_number || '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums hidden lg:table-cell">
                      {(company as any).contact_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <div className="flex justify-end">
                        {(company as any).open_ticket_count > 0 ? (
                          <Badge variant="secondary">{(company as any).open_ticket_count}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">
                      {(company as any).total_ticket_count ?? 0}
                    </td>
                    <td
                      className="px-4 py-3"
                      onClick={e => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            aria-label={`Åtgärder för ${company.name}`}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteTarget({ id: company.id, name: company.name })}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Ta bort
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Centralized delete confirmation (triggered from row dropdown) */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort företag</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort <strong>{deleteTarget?.name}</strong>? Denna åtgärd kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteCompany(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
};

export default CompanyList;
