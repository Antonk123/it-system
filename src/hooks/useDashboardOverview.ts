import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { TicketPriority } from '@/types/ticket';

export interface AgingTicket {
  id: string;
  title: string;
  priority: TicketPriority;
  status: string;
  requester_name: string | null;
  age_days: number;
}

export interface TodayCounts {
  created_today: number;
  resolved_today: number;
  closed_today: number;
}

export interface DashboardOverview {
  agingTickets: AgingTicket[];
  todayCounts: TodayCounts;
  criticalCount: number;
}

export const dashboardOverviewKeys = {
  all: ['dashboard', 'overview'] as const,
};

export const useDashboardOverview = () => {
  return useQuery<DashboardOverview>({
    queryKey: dashboardOverviewKeys.all,
    queryFn: () => api.request<DashboardOverview>('/tickets/dashboard-overview'),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};
