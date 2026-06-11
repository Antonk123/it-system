import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, KbCategoryRow } from '@/lib/api';

export const kbCategoryKeys = {
  all: ['kb-categories'] as const,
  list: () => [...kbCategoryKeys.all] as const,
};

/**
 * Fetches KB categories via react-query.
 * Returns { categories, isLoading, refetch }.
 * refetch() invalidates the cache — use after create/update/delete mutations.
 */
export const useKbCategories = () => {
  const queryClient = useQueryClient();

  const { data: categories = [], isLoading } = useQuery<KbCategoryRow[]>({
    queryKey: kbCategoryKeys.list(),
    queryFn: () => api.getKbCategories(),
    staleTime: 1000 * 60 * 5, // KB categories rarely change — 5 min
  });

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: kbCategoryKeys.list() });
  };

  return { categories, isLoading, refetch };
};
