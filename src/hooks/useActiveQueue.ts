import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Ticket, TicketStatus, TicketPriority } from '@/types/ticket';

interface PaginatedResponse<T> {
  data: T[];
  pagination: unknown;
}

interface TicketRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category_id: string | null;
  requester_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  notes: string | null;
  solution: string | null;
  template_id: string | null;
  tags?: unknown[];
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  sla_response_deadline?: string | null;
  sla_resolution_deadline?: string | null;
  sla_paused_at?: string | null;
  sla_paused_duration?: number | null;
  sla_response_met?: 0 | 1 | null;
  sla_resolution_met?: 0 | 1 | null;
}

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
        createdAt: new Date(t.created_at),
        updatedAt: new Date(t.updated_at),
        resolvedAt: t.resolved_at ? new Date(t.resolved_at) : undefined,
        closedAt: t.closed_at ? new Date(t.closed_at) : undefined,
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
