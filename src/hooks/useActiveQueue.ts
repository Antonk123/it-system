import { useQuery } from '@tanstack/react-query';
import { api, PaginatedResponse, TicketRow } from '@/lib/api';
import { Ticket } from '@/types/ticket';
import { mapTicketRow } from '@/lib/mapTicket';

export const activeQueueKeys = {
  all: ['tickets', 'active-queue'] as const,
};

/**
 * Hämtar aktiva ärenden (open/in-progress/waiting) sorterade på prioritet.
 * Avsedd för Dashboard-kön — minimerar payload jämfört med att fetcha alla ärenden.
 */
export const useActiveQueue = (limit = 30) => {
  return useQuery<Ticket[]>({
    queryKey: [...activeQueueKeys.all, limit],
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const query = `?status=open,in-progress,waiting&limit=${limit}&sortBy=priority&sortDir=asc`;
      const response = await api.request<TicketRow[] | PaginatedResponse<TicketRow>>(`/tickets${query}`);
      const rows = Array.isArray(response) ? response : response.data;
      return rows.map(mapTicketRow);
    },
  });
};
