import { useQuery } from '@tanstack/react-query';
import { api, KbArticleRow, LinkedTicketRow, LinkedArticleRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export const kbArticleKeys = {
  all: ['kb-article'] as const,
  detail: (id: string) => [...kbArticleKeys.all, id] as const,
};

export interface KbArticleData {
  article: KbArticleRow;
  shareToken: string | null;
  linkedTickets: LinkedTicketRow[];
  crossRefs: LinkedArticleRow[];
}

/**
 * Fetches a KB article plus its share status, linked tickets, and cross-refs
 * in a single react-query entry (Promise.all internally).
 *
 * Share-status is admin-only on the server (403 for others), so it is only
 * requested for admins — everyone else gets `shareToken: null`.
 *
 * Returns { data, isLoading, isError }.
 * data is undefined while loading or on error.
 */
export const useKbArticle = (id: string | undefined) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data, isLoading, isError } = useQuery<KbArticleData>({
    queryKey: kbArticleKeys.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const [article, shareData, ticketsData] = await Promise.all([
        api.getKbArticle(id!),
        isAdmin ? api.getKbArticleShare(id!) : Promise.resolve({ share_token: null }),
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
