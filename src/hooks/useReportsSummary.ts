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
  trend: { month: string; created: number; closed: number }[];
  avgResolutionDays: number;
  agingTickets: number;
}

export const reportsSummaryKeys = {
  all: ['reports', 'summary'] as const,
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
