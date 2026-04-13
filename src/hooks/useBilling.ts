import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, BillingRateRow, InvoiceRow, InvoiceDetail, InvoicePreview } from '@/lib/api';
import { toast } from 'sonner';

export const billingKeys = {
  all: ['billing'] as const,
  rates: () => [...billingKeys.all, 'rates'] as const,
  rate: (companyId: string) => [...billingKeys.rates(), companyId] as const,
  invoices: () => [...billingKeys.all, 'invoices'] as const,
  invoiceList: (companyId?: string) => [...billingKeys.invoices(), 'list', companyId] as const,
  invoice: (id: string) => [...billingKeys.invoices(), id] as const,
};

export const useBillingRate = (companyId: string) => {
  const queryClient = useQueryClient();

  const { data: rate, isLoading } = useQuery({
    queryKey: billingKeys.rate(companyId),
    queryFn: () => api.getBillingRate(companyId),
    staleTime: 1000 * 60 * 5,
    enabled: !!companyId,
  });

  const upsertMutation = useMutation({
    mutationFn: ({ ratePerHour, currency }: { ratePerHour: number; currency?: string }) =>
      api.upsertBillingRate(companyId, ratePerHour, currency),
    onSuccess: (data) => {
      queryClient.setQueryData(billingKeys.rate(companyId), data);
      toast.success('Timpris sparat');
    },
    onError: () => toast.error('Kunde inte spara timpris'),
  });

  const upsertRate = useCallback(
    async (ratePerHour: number, currency?: string) => {
      try { return await upsertMutation.mutateAsync({ ratePerHour, currency }); }
      catch { return null; }
    },
    [upsertMutation]
  );

  return { rate, isLoading, upsertRate };
};

export const useInvoices = (companyId?: string) => {
  const queryClient = useQueryClient();

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: billingKeys.invoiceList(companyId),
    queryFn: () => api.getInvoices(companyId),
    staleTime: 1000 * 60 * 2,
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createInvoice>[0]) => api.createInvoice(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
      toast.success('Faktura skapad');
    },
    onError: () => toast.error('Kunde inte skapa faktura'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.updateInvoiceStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
      toast.success('Fakturastatus uppdaterad');
    },
    onError: () => toast.error('Kunde inte uppdatera status'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteInvoice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
      toast.success('Faktura borttagen');
    },
    onError: () => toast.error('Kunde inte ta bort faktura'),
  });

  return {
    invoices,
    isLoading,
    createInvoice: useCallback(async (data: Parameters<typeof api.createInvoice>[0]) => {
      try { return await createMutation.mutateAsync(data); } catch { return null; }
    }, [createMutation]),
    updateStatus: useCallback(async (id: string, status: string) => {
      try { return await statusMutation.mutateAsync({ id, status }); } catch { return null; }
    }, [statusMutation]),
    deleteInvoice: useCallback(async (id: string) => {
      try { await deleteMutation.mutateAsync(id); return true; } catch { return false; }
    }, [deleteMutation]),
  };
};

export const useInvoiceDetail = (id: string) => {
  const { data, isLoading } = useQuery({
    queryKey: billingKeys.invoice(id),
    queryFn: () => api.getInvoice(id),
    enabled: !!id,
  });
  return { invoice: data, isLoading };
};
