import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ReportsSummary {
  totals: {
    open: number;
    inProgress: number;
    waiting: number;
    resolved: number;
    closed: number;
    total: number;
  };
  byCategory: { category: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  trend: { month: string; created: number; closed: number }[];
  avgResolutionDays: number;
  agingTickets: number;
}

// Alla rapportfrågor ligger under ['reports', ...] — ett prefix räcker för att
// ogiltigförklara dem när ärenden ändras.
export const reportsKeys = {
  all: ['reports'] as const,
  kpiTicketsTotal: (year?: string, month?: string) =>
    [...reportsKeys.all, 'kpi-tickets', 'total', year, month] as const,
  kpiTicketsAging: () => [...reportsKeys.all, 'kpi-tickets', 'aging'] as const,
  requesterAnalytics: (year?: string, month?: string) =>
    [...reportsKeys.all, 'requester-analytics', year, month] as const,
};

export const reportsSummaryKeys = {
  all: [...reportsKeys.all, 'summary'] as const,
  filtered: (year?: string, month?: string) =>
    [...reportsSummaryKeys.all, { year, month }] as const,
};

export const useReportsSummary = (year?: string, month?: string) => {
  const params = new URLSearchParams();
  if (year && year !== 'all') params.append('year', year);
  if (month && month !== 'all') params.append('month', month);
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery<ReportsSummary>({
    queryKey: reportsSummaryKeys.filtered(year, month),
    queryFn: () => api.request<ReportsSummary>(`/reports/summary${qs}`),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};
