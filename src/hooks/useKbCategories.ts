import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, KbCategoryRow } from '@/lib/api';
import { kbArticlesKeys } from '@/hooks/useKbArticles';
import { kbArticleKeys } from '@/hooks/useKbArticle';

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

  const { data: categories = [], isLoading, isError } = useQuery<KbCategoryRow[]>({
    queryKey: kbCategoryKeys.list(),
    queryFn: () => api.getKbCategories(),
    staleTime: 1000 * 60 * 5, // KB categories rarely change — 5 min
  });

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: kbCategoryKeys.list() });
    // KB category mutations live in the KnowledgeBase page and call this refetch
    // after create/update/delete. Also invalidate article list + detail caches so
    // article views reflect renamed/removed categories.
    queryClient.invalidateQueries({ queryKey: kbArticlesKeys.all });
    queryClient.invalidateQueries({ queryKey: kbArticleKeys.all });
  };

  return { categories, isLoading, isError, refetch };
};
