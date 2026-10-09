import type { QueryClient } from '@tanstack/react-query';
import { ticketKeys } from '@/hooks/useTickets';
import { statusCountsKeys } from '@/hooks/useStatusCounts';
import { dashboardOverviewKeys } from '@/hooks/useDashboardOverview';
import { activeQueueKeys } from '@/hooks/useActiveQueue';
import { activityFeedKeys } from '@/hooks/useActivityFeed';
import { reportsKeys } from '@/hooks/useReportsSummary';
import { ticketHistoryKeys } from '@/hooks/useTicketHistory';

export const requesterOpenCountsKeys = {
  all: ['requester-open-counts'] as const,
};

/**
 * Ogiltigförklarar allt som härleds från ärendedata: listor, detaljer, kön,
 * statusräknare, dashboard, aktivitetsflöde, rapporter och "öppna ärenden per
 * beställare". Anropas efter varje mutation som ändrar ett ärende eller dess
 * checklista/påminnelser, så att ingen vy visar föråldrade siffror.
 */
export function invalidateTicketDerived(queryClient: QueryClient, ticketId?: string): Promise<unknown> {
  const keys: (readonly unknown[])[] = [
    ticketKeys.all,
    statusCountsKeys.all,
    dashboardOverviewKeys.all,
    activeQueueKeys.all,
    activityFeedKeys.all,
    reportsKeys.all,
    requesterOpenCountsKeys.all,
  ];
  if (ticketId) keys.push(ticketHistoryKeys.ticket(ticketId));
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
