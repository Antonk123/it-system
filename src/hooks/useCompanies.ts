import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, CompanyRow } from '@/lib/api';
import { companySchema, getValidationError } from '@/lib/validations';
import { userKeys } from '@/hooks/useUsers';
import { ticketKeys } from '@/hooks/useTickets';
import { toast } from 'sonner';

export const companyKeys = {
  all: ['companies'] as const,
  lists: () => [...companyKeys.all, 'list'] as const,
  list: () => [...companyKeys.lists()] as const,
  details: () => [...companyKeys.all, 'detail'] as const,
  detail: (id: string) => [...companyKeys.details(), id] as const,
};

export const useCompanies = () => {
  const queryClient = useQueryClient();

  // Kontakters och ärendens företagsnamn kommer från companies — invalidera
  // beroende cachar när ett företag ändras eller tas bort.
  const invalidateDependents = (id: string) => {
    queryClient.invalidateQueries({ queryKey: userKeys.list() });
    queryClient.invalidateQueries({ queryKey: ticketKeys.all });
    queryClient.invalidateQueries({ queryKey: companyKeys.detail(id) });
  };

  const { data: companies = [], isLoading, isError } = useQuery({
    queryKey: companyKeys.list(),
    queryFn: () => api.getCompanies(),
    staleTime: 1000 * 60 * 5,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<CompanyRow>) => {
      const validation = companySchema.safeParse(data);
      if (!validation.success) {
        throw new Error(getValidationError(validation.error) || 'Invalid company data');
      }
      return api.createCompany(validation.data);
    },
    onSuccess: (newCompany) => {
      queryClient.setQueryData(companyKeys.list(), (old: CompanyRow[] | undefined) => {
        if (!old) return [newCompany];
        return [...old, newCompany].sort((a, b) => a.name.localeCompare(b.name));
      });
      toast.success('Företag skapat');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Kunde inte skapa företag'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<CompanyRow>) => {
      return api.updateCompany(id, data);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(companyKeys.list(), (old: CompanyRow[] | undefined) => {
        if (!old) return old;
        return old.map(c => c.id === updated.id ? { ...c, ...updated } : c);
      });
      invalidateDependents(updated.id);
      toast.success('Företag uppdaterat');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Kunde inte uppdatera företag'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCompany(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData(companyKeys.list(), (old: CompanyRow[] | undefined) => {
        if (!old) return old;
        return old.filter(c => c.id !== id);
      });
      queryClient.removeQueries({ queryKey: companyKeys.detail(id) });
      invalidateDependents(id);
      toast.success('Företag borttaget');
    },
    // Servern svarar 409 med förklaring när företaget har sparad historik.
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Kunde inte ta bort företag'),
  });

  const createCompany = useCallback(
    async (data: Partial<CompanyRow>) => {
      try { return await createMutation.mutateAsync(data); }
      catch { return null; }
    },
    [createMutation]
  );

  const updateCompany = useCallback(
    async (id: string, data: Partial<CompanyRow>) => {
      try { return await updateMutation.mutateAsync({ id, ...data }); }
      catch { return null; }
    },
    [updateMutation]
  );

  const deleteCompany = useCallback(
    async (id: string) => {
      try { await deleteMutation.mutateAsync(id); return true; }
      catch { return false; }
    },
    [deleteMutation]
  );

  return { companies, isLoading, isError, createCompany, updateCompany, deleteCompany };
};

export const useCompanyDetail = (id: string) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: companyKeys.detail(id),
    queryFn: () => api.getCompany(id),
    staleTime: 1000 * 60 * 2,
    enabled: !!id,
  });

  return { company: data, isLoading, isError };
};
