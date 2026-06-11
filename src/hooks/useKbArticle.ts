import { useQuery } from '@tanstack/react-query';
import { api, KbArticleRow, LinkedTicketRow, LinkedArticleRow } from '@/lib/api';

export const kbArticleKeys = {
  all: ['kb-article'] as const,
  detail: (id: string) => [...kbArticleKeys.all, id] as const,
};

interface KbArticleData {
  article: KbArticleRow;
  shareToken: string | null;
  linkedTickets: LinkedTicketRow[];
  crossRefs: LinkedArticleRow[];
}

/**
 * Fetches a KB article plus its share status, linked tickets, and cross-refs
 * in a single react-query entry (Promise.all internally).
 *
 * Returns { data, isLoading, isError }.
 * data is undefined while loading or on error.
 */
export const useKbArticle = (id: string | undefined) => {
  const { data, isLoading, isError } = useQuery<KbArticleData>({
    queryKey: kbArticleKeys.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const [article, shareData, ticketsData] = await Promise.all([
        api.getKbArticle(id!),
        api.getKbArticleShare(id!),
        api.getArticleLinkedTickets(id!),
      ]);
      // Cross-refs are non-critical — don't let them fail the whole query
      let crossRefs: LinkedArticleRow[] = [];
      try {
        crossRefs = await api.getKbArticleLinks(id!);
      } catch {
        // silently fall back to empty list
      }
      return {
        article,
        shareToken: shareData.share_token,
        linkedTickets: ticketsData,
        crossRefs,
      };
    },
    staleTime: 1000 * 60 * 2,
  });

  return { data, isLoading, isError };
};
