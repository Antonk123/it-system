import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface UpcomingReminder {
  id: string;
  ticket_id: string;
  reminder_time: string;
  message: string | null;
  ticket_title: string;
  ticket_status: string;
  ticket_priority: string;
}

export const upcomingRemindersKeys = {
  all: ['reminders', 'upcoming'] as const,
};

export const useUpcomingReminders = () => {
  return useQuery<UpcomingReminder[]>({
    queryKey: upcomingRemindersKeys.all,
    queryFn: () => api.request<UpcomingReminder[]>('/tickets/upcoming-reminders'),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};
