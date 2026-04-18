import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ActivityEvent {
  id: string;
  ticket_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  ticket_title: string | null;
  user_name: string | null;
}

export const activityFeedKeys = {
  all: ['activity-feed'] as const,
};

export const useActivityFeed = (limit = 15) => {
  return useQuery<ActivityEvent[]>({
    queryKey: [...activityFeedKeys.all, limit],
    queryFn: () => api.request<ActivityEvent[]>(`/tickets/activity-feed?limit=${limit}`),
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
  });
};
