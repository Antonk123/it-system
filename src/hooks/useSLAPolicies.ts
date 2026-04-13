import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, SLAPolicyRow } from '@/lib/api';
import { toast } from 'sonner';

export const slaKeys = {
  all: ['sla'] as const,
  lists: () => [...slaKeys.all, 'list'] as const,
  list: (companyId?: string) => [...slaKeys.lists(), companyId] as const,
};

export const useSLAPolicies = (companyId?: string) => {
  const queryClient = useQueryClient();

  const { data: policies = [], isLoading } = useQuery({
    queryKey: slaKeys.list(companyId),
    queryFn: () => api.getSLAPolicies(companyId),
    staleTime: 1000 * 60 * 5,
  });

  const upsertMutation = useMutation({
    mutationFn: async ({ companyId, policies }: { companyId: string | null; policies: Array<{ priority: string; response_time_minutes: number; resolution_time_minutes: number }> }) => {
      return api.upsertSLAPolicies(companyId, policies);
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(slaKeys.list(variables.companyId || 'default'), data);
      queryClient.invalidateQueries({ queryKey: slaKeys.all });
      toast.success('SLA-policy sparad');
    },
    onError: () => toast.error('Kunde inte spara SLA-policy'),
  });

  const upsertPolicies = useCallback(
    async (companyId: string | null, policies: Array<{ priority: string; response_time_minutes: number; resolution_time_minutes: number }>) => {
      try { return await upsertMutation.mutateAsync({ companyId, policies }); }
      catch { return null; }
    },
    [upsertMutation]
  );

  return { policies, isLoading, upsertPolicies };
};
