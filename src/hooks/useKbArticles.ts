import { useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { kbArticleKeys } from '@/hooks/useKbArticle';

export interface KbArticlesParams {
  search?: string;
  category_id?: string;
  article_type?: string;
  tag?: string;
  stale?: boolean;
  status?: 'draft' | 'published' | 'all';
}

export const KB_PAGE_SIZE = 24;

export const kbArticlesKeys = {
  all: ['kb-articles'] as const,
  list: (params: KbArticlesParams) => [...kbArticlesKeys.all, params] as const,
};

export const ticketKbLinksKeys = {
  all: ['ticket-kb-links'] as const,
  ticket: (ticketId: string) => [...ticketKbLinksKeys.all, ticketId] as const,
};

export const kbSearchKeys = {
  all: ['kb-search'] as const,
  term: (term: string) => [...kbSearchKeys.all, term] as const,
};

/**
 * Fetches KB article summaries (preview instead of full content) one page at a
 * time via react-query. Params are used as the query key — changing any param
 * starts a fresh list. Call `fetchNextPage` to append the next page.
 * Pass `enabled: false` to skip the fetch (e.g. when the picker is hidden).
 */
export const useKbArticles = (params: KbArticlesParams = {}, enabled = true) => {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: kbArticlesKeys.list(params),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.getKbArticlesPage({ ...params, page: pageParam, limit: KB_PAGE_SIZE }),
    getNextPageParam: ({ pagination }) =>
      pagination.page * pagination.limit < pagination.total ? pagination.page + 1 : undefined,
    enabled,
    staleTime: 1000 * 30, // 30s — articles change more often than categories
  });

  const articles = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data]);
  const total = data?.pages[0]?.pagination.total ?? 0;

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: kbArticlesKeys.all });
    queryClient.invalidateQueries({ queryKey: kbArticleKeys.all });
  };

  return { articles, total, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage };
};
