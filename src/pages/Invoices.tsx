import { useState } from 'react';
import { Receipt, FileText, Send, CheckCircle, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { useCompanies } from '@/hooks/useCompanies';
import { useInvoices, useInvoiceDetail } from '@/hooks/useBilling';
import { api, InvoicePreview, InvoiceRow } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { toast } from 'sonner';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  sent: 'Skickad',
  paid: 'Betald',
  cancelled: 'Makulerad',
};

const STATUS_VARIANTS: Record<string, 'secondary' | 'default' | 'destructive' | 'outline'> = {
  draft: 'secondary',
  sent: 'default',
  paid: 'outline',
  cancelled: 'destructive',
};

function formatAmount(amount: number, currency: string) {
  return `${amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

// Invoice detail dialog
function InvoiceDetailDialog({ invoiceId, open, onClose, onStatusChange, onDelete }: {
  invoiceId: string;
  open: boolean;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => Promise<any>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const { invoice, isLoading } = useInvoiceDetail(invoiceId);
  // Förhindra dubbeltryck under pågående statusuppdatering
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const handleDelete = async () => {
    const ok = await onDelete(invoiceId);
    if (ok) onClose();
  };

  const handleStatusChange = async (id: string, status: string) => {
    setIsUpdatingStatus(true);
    try {
      await onStatusChange(id, status);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Faktura
          </DialogTitle>
        </DialogHeader>

        {isLoading || !invoice ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Företag</p>
                <p className="font-medium">{invoice.company_name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge variant={STATUS_VARIANTS[invoice.status] ?? 'secondary'}>
                  {STATUS_LABELS[invoice.status] ?? invoice.status}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Period</p>
                <p className="font-medium">{formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Skapad</p>
                <p className="font-medium">{formatDate(invoice.created_at)}</p>
              </div>
            </div>

            {/* Lines table */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Beskrivning</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Timmar</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Pris/h</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Belopp</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoice.lines.map((line, i) => (
                    <tr key={line.id ?? i}>
                      <td className="px-3 py-2">
                        {line.ticket_title ? (
                          <span className="text-foreground">{line.ticket_title}</span>
                        ) : (
                          <span className="text-muted-foreground italic">{line.description}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.hours.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.rate}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{line.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/30 font-semibold">
                  <tr>
                    <td className="px-3 py-2">Totalt</td>
                    <td className="px-3 py-2 text-right tabular-nums">{invoice.total_hours.toFixed(2)}</td>
                    <td />
                    <td className="px-3 py-2 text-right tabular-nums">{formatAmount(invoice.total_amount, invoice.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Actions */}
            <div className="flex gap-2 flex-wrap pt-1">
              {invoice.status === 'draft' && (
                <Button size="sm" onClick={() => handleStatusChange(invoice.id, 'sent')} disabled={isUpdatingStatus} className="gap-2">
                  <Send className="h-3.5 w-3.5" /> Markera skickad
                </Button>
              )}
              {invoice.status === 'sent' && (
                <Button size="sm" variant="outline" onClick={() => handleStatusChange(invoice.id, 'paid')} disabled={isUpdatingStatus} className="gap-2">
                  <CheckCircle className="h-3.5 w-3.5" /> Markera betald
                </Button>
              )}
              {(invoice.status === 'draft' || invoice.status === 'sent') && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="destructive" className="gap-2">
                      <Trash2 className="h-3.5 w-3.5" /> Ta bort
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Ta bort faktura?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Åtgärden kan inte ångras.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Avbryt</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete}>Ta bort</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Main page
const Invoices = () => {
  const { companies } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Filter invoices by selected company (or all)
  const { invoices, isLoading, createInvoice, updateStatus, deleteInvoice } = useInvoices();

  const filteredInvoices = selectedCompanyId
    ? invoices.filter(inv => inv.company_id === selectedCompanyId)
    : invoices;

  const handlePreview = async () => {
    if (!selectedCompanyId || !periodStart || !periodEnd) {
      toast.error('Välj företag och period');
      return;
    }
    setPreviewing(true);
    setPreview(null);
    try {
      const result = await api.previewInvoice(selectedCompanyId, periodStart, periodEnd);
      setPreview(result);
    } catch (e: any) {
      toast.error(e.message || 'Kunde inte förhandsgranska');
    } finally {
      setPreviewing(false);
    }
  };

  const handleCreate = async () => {
    if (!preview) return;
    setCreating(true);
    try {
      await createInvoice({
        company_id: preview.company_id,
        period_start: preview.period_start,
        period_end: preview.period_end,
        lines: preview.lines,
        total_hours: preview.total_hours,
        total_amount: preview.total_amount,
        currency: preview.currency,
      });
      setPreview(null);
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    await updateStatus(id, status);
    setSelectedInvoiceId(null);
  };

  const handleDelete = async (id: string) => {
    return await deleteInvoice(id);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Receipt className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Fakturering</h1>
        </div>

        {/* Generate invoice card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generera faktura</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="invoice-company" className="text-xs text-muted-foreground">Företag</Label>
                <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                  <SelectTrigger id="invoice-company">
                    <SelectValue placeholder="Välj företag..." />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-period-start" className="text-xs text-muted-foreground">Från datum</Label>
                <Input id="invoice-period-start" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-period-end" className="text-xs text-muted-foreground">Till datum</Label>
                <Input id="invoice-period-end" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            <Button onClick={handlePreview} disabled={previewing || !selectedCompanyId || !periodStart || !periodEnd}>
              {previewing ? 'Hämtar...' : 'Förhandsgranska'}
            </Button>

            {/* Preview */}
            {previewing && (
              <div className="space-y-2 pt-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}
            {preview && (
              <div className="space-y-3 pt-2">
                <p className="text-sm text-muted-foreground">
                  Timpris: {preview.rate_per_hour} {preview.currency}/h &mdash; {preview.lines.length} poster
                </p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ärende</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Timmar</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Belopp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.lines.map((line, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">{line.ticket_title ?? line.description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{line.hours.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{line.amount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 font-semibold">
                      <tr>
                        <td className="px-3 py-2">Totalt</td>
                        <td className="px-3 py-2 text-right tabular-nums">{preview.total_hours.toFixed(2)} h</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatAmount(preview.total_amount, preview.currency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <Button onClick={handleCreate} disabled={creating} className="gap-2">
                  <FileText className="h-4 w-4" />
                  {creating ? 'Skapar...' : 'Skapa faktura'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invoice list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Fakturor</span>
              <Select value={selectedCompanyId || '__all__'} onValueChange={v => setSelectedCompanyId(v === '__all__' ? '' : v)}>
                <SelectTrigger className="w-48 h-8 text-sm">
                  <SelectValue placeholder="Alla företag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Alla företag</SelectItem>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : filteredInvoices.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Inga fakturor hittades.</p>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th scope="col" className="text-left px-3 py-2 font-medium text-muted-foreground">Företag</th>
                      <th scope="col" className="text-left px-3 py-2 font-medium text-muted-foreground">Period</th>
                      <th scope="col" className="text-right px-3 py-2 font-medium text-muted-foreground">Timmar</th>
                      <th scope="col" className="text-right px-3 py-2 font-medium text-muted-foreground">Belopp</th>
                      <th scope="col" className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredInvoices.map((inv: InvoiceRow) => (
                      <tr
                        key={inv.id}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedInvoiceId(inv.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedInvoiceId(inv.id);
                          }
                        }}
                      >
                        <td className="px-3 py-2 font-medium">{inv.company_name ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{inv.total_hours.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {formatAmount(inv.total_amount, inv.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={STATUS_VARIANTS[inv.status] ?? 'secondary'}>
                            {STATUS_LABELS[inv.status] ?? inv.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invoice detail dialog */}
      {selectedInvoiceId && (
        <InvoiceDetailDialog
          invoiceId={selectedInvoiceId}
          open={!!selectedInvoiceId}
          onClose={() => setSelectedInvoiceId(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
        />
      )}
    </Layout>
  );
};

export default Invoices;
