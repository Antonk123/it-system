import { useQuery } from '@tanstack/react-query';
import { api, StatusFlowRow } from '@/lib/api';

export const statusFlowKeys = {
  all: ['reports', 'status-flow'] as const,
};

// Server-side 12-month per-status flow (replaces client-side aggregation that
// silently undercounted past the 1000-row ticket cap).
export const useStatusFlow = () => {
  return useQuery<StatusFlowRow[]>({
    queryKey: statusFlowKeys.all,
    queryFn: () => api.getStatusFlow(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};
