import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DeflectionStats {
  shown: number;
  solved: number;
  rejected: number;
  no_solution: number;
  total: number;
  deflectionRate: number;
}

export const deflectionStatsKeys = {
  all: ['deflection', 'stats'] as const,
};

export const useDeflectionStats = () => {
  return useQuery<DeflectionStats>({
    queryKey: deflectionStatsKeys.all,
    queryFn: () => api.request<DeflectionStats>('/public/ai-suggest/stats'),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};
