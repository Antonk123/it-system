import { useQuery } from '@tanstack/react-query';
import { api, PaginatedResponse, TicketRow } from '@/lib/api';
import { Ticket, TicketStatus, TicketPriority } from '@/types/ticket';
import { parseServerDate } from '@/lib/date';

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

      const mapped: Ticket[] = rows.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status as TicketStatus,
        priority: t.priority as TicketPriority,
        category: t.category_id || undefined,
        requesterId: t.requester_id || '',
        createdAt: parseServerDate(t.created_at),
        updatedAt: parseServerDate(t.updated_at),
        resolvedAt: t.resolved_at ? parseServerDate(t.resolved_at) : undefined,
        closedAt: t.closed_at ? parseServerDate(t.closed_at) : undefined,
        notes: t.notes || undefined,
        solution: t.solution || undefined,
        templateId: t.template_id || undefined,
        assignedTo: t.assigned_to ?? undefined,
        assignedToName: t.assigned_to_name ?? undefined,
        companyId: t.company_id ?? undefined,
        companyName: t.company_name ?? undefined,
      }));
      return mapped;
    },
  });
};
