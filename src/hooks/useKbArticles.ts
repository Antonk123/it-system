import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, KbArticleRow } from '@/lib/api';

export interface KbArticlesParams {
  search?: string;
  category_id?: string;
  article_type?: string;
  tag?: string;
  stale?: boolean;
}

export const kbArticlesKeys = {
  all: ['kb-articles'] as const,
  list: (params: KbArticlesParams) => [...kbArticlesKeys.all, params] as const,
};

/**
 * Fetches KB articles via react-query.
 * Params are used as the query key — changing any param triggers a fresh fetch.
 * Pass `enabled: false` to skip the fetch (e.g. in create mode where the picker is hidden).
 * Returns { articles, isLoading, refetch }.
 */
export const useKbArticles = (params: KbArticlesParams = {}, enabled = true) => {
  const queryClient = useQueryClient();

  const { data: articles = [], isLoading } = useQuery<KbArticleRow[]>({
    queryKey: kbArticlesKeys.list(params),
    queryFn: () => api.getKbArticles(params),
    enabled,
    staleTime: 1000 * 30, // 30s — articles change more often than categories
  });

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: kbArticlesKeys.all });
  };

  return { articles, isLoading, refetch };
};
