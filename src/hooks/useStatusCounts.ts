import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type StatusCounts = Record<string, number>;

export const statusCountsKeys = {
  all: ['status-counts'] as const,
};

export const useStatusCounts = () => {
  return useQuery<StatusCounts>({
    queryKey: statusCountsKeys.all,
    queryFn: () => api.request<StatusCounts>('/tickets/status-counts'),
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
  });
};
