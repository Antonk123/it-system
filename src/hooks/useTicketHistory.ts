import { useQuery } from '@tanstack/react-query';
import { api, TicketHistoryItem } from '@/lib/api';

export const useTicketHistory = (ticketId: string) => {
  const { data: history = [], isLoading } = useQuery<TicketHistoryItem[]>({
    queryKey: ['ticket-history', ticketId],
    queryFn: () => api.getTicketHistory(ticketId),
    enabled: !!ticketId,
  });
  return { history, isLoading };
};
