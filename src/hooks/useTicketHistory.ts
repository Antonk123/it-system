import { useQuery } from '@tanstack/react-query';
import { api, TicketHistoryItem } from '@/lib/api';

export const useTicketHistory = (ticketId: string, enabled = true) => {
  const { data: history = [], isLoading, isError } = useQuery<TicketHistoryItem[]>({
    queryKey: ['ticket-history', ticketId],
    queryFn: () => api.getTicketHistory(ticketId),
    // `enabled` lets callers defer this below-the-fold query so it doesn't
    // compete with the critical ticket + comments fetch on a slow link.
    enabled: !!ticketId && enabled,
  });
  return { history, isLoading, isError };
};
