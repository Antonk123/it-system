import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Building2, ArrowLeft, Clock, Ticket, Users, Timer, Pencil, Receipt } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompanyDetail, useCompanies } from '@/hooks/useCompanies';
import { toast } from 'sonner';
import { useBillingRate } from '@/hooks/useBilling';

const CompanyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { company, isLoading, isError } = useCompanyDetail(id!);
  const { updateCompany } = useCompanies();
  const [rateInput, setRateInput] = useState('');
  const { rate, upsertRate } = useBillingRate(id!);

  useEffect(() => {
    if (rate?.rate_per_hour != null) {
      setRateInput(String(rate.rate_per_hour));
    }
  }, [rate]);

  const [editOpen, setEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    org_number: '',
    email: '',
    phone: '',
    address: '',
  });

  const openEdit = () => {
    if (!company) return;
    setForm({
      name: company.name ?? '',
      org_number: company.org_number ?? '',
      email: company.email ?? '',
      phone: company.phone ?? '',
      address: company.address ?? '',
    });
    setEditOpen(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || isSaving) return;
    setIsSaving(true);
    try {
      const result = await updateCompany(id, form);
      if (result) setEditOpen(false);
    } catch (error) {
      toast.error('Kunde inte uppdatera företaget');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-lg" />
        </div>
      </Layout>
    );
  }

  if (isError) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Building2 className="w-12 h-12 text-destructive" />
          <p className="text-muted-foreground">Kunde inte ladda företaget</p>
          <Button variant="outline" onClick={() => navigate('/companies')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Tillbaka till företag
          </Button>
        </div>
      </Layout>
    );
  }

  if (!company) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Building2 className="w-12 h-12 text-muted-foreground" />
          <p className="text-muted-foreground">Företaget hittades inte</p>
          <Button variant="outline" onClick={() => navigate('/companies')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Tillbaka till företag
          </Button>
        </div>
      </Layout>
    );
  }

  const avgResolution = company.stats?.avg_resolution_days != null
    ? `${Number(company.stats.avg_resolution_days).toFixed(1)}d`
    : '—';

  const loggedHours = company.stats?.total_minutes != null
    ? `${(company.stats.total_minutes / 60).toFixed(1)}h`
    : '—';

  return (
    <Layout>
      <div className="space-y-6">
        {/* Back + header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/companies')} aria-label="Tillbaka">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Building2 className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">{company.name}</h1>
          </div>
          <Button variant="outline" className="gap-2 self-start sm:self-auto" onClick={openEdit}>
            <Pencil className="w-4 h-4" />
            Redigera
          </Button>
        </div>

        {/* Metadata */}
        <Card>
          <CardContent className="pt-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground mb-1">Org.nummer</dt>
                <dd className="font-medium">{company.org_number || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-1">E-post</dt>
                <dd className="font-medium">{company.email || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-1">Telefon</dt>
                <dd className="font-medium">{company.phone || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-1">Adress</dt>
                <dd className="font-medium">{company.address || '—'}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Stats cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Ticket className="w-4 h-4" />
                Öppna ärenden
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{company.stats?.open_count ?? 0}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Ticket className="w-4 h-4" />
                Totalt ärenden
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{company.stats?.total ?? 0}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Snitt lösningstid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{avgResolution}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Timer className="w-4 h-4" />
                Loggad tid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{loggedHours}</p>
            </CardContent>
          </Card>
        </div>

        {/* Contacts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-4 h-4" />
              Kontakter
              {company.contacts && company.contacts.length > 0 && (
                <Badge variant="secondary" className="ml-1">{company.contacts.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!company.contacts || company.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Inga kontakter kopplade till detta företag.</p>
            ) : (
              <div className="divide-y">
                {company.contacts.map((contact: any) => (
                  <div key={contact.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="font-medium text-sm text-foreground">{contact.name}</p>
                    <div className="flex flex-wrap gap-3 mt-1">
                      {contact.email && (
                        <span className="text-xs text-muted-foreground">{contact.email}</span>
                      )}
                      {contact.phone && (
                        <span className="text-xs text-muted-foreground">{contact.phone}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Billing rate */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4" /> Timpris
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">kr/timme</Label>
                <Input
                  type="number"
                  value={rateInput}
                  onChange={e => setRateInput(e.target.value)}
                  placeholder="0"
                />
              </div>
              <Button size="sm" onClick={() => upsertRate(Number(rateInput))} disabled={!rateInput}>
                Spara
              </Button>
            </div>
            {rate && (
              <p className="text-xs text-muted-foreground mt-2">
                Nuvarande: {rate.rate_per_hour} {rate.currency}/h
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redigera företag</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Namn *</Label>
              <Input
                id="edit-name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-org">Org.nummer</Label>
              <Input
                id="edit-org"
                value={form.org_number}
                onChange={e => setForm({ ...form, org_number: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">E-post</Label>
              <Input
                id="edit-email"
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Telefon</Label>
              <Input
                id="edit-phone"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-address">Adress</Label>
              <Input
                id="edit-address"
                value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={isSaving}>
                Avbryt
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Sparar...' : 'Spara ändringar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default CompanyDetail;
