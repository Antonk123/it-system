import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface TicketReminder {
  id: string;
  ticket_id: string;
  user_id: string;
  reminder_time: string;
  message: string | null;
  sent: number;
  created_at: string;
  sent_at: string | null;
  user_name?: string;
  user_email?: string;
}

export function useTicketReminders(ticketId: string) {
  const queryClient = useQueryClient();

  // Hämta påminnelser via react-query — auto-fetch när ticketId finns
  const {
    data: reminders = [],
    isLoading,
    isError,
  } = useQuery<TicketReminder[]>({
    queryKey: ['reminders', ticketId],
    queryFn: () => api.getReminders(ticketId) as Promise<TicketReminder[]>,
    enabled: !!ticketId,
  });

  const remindersKey = ['reminders', ticketId];

  const createMutation = useMutation({
    mutationFn: ({ reminderTime, message }: { reminderTime: string; message?: string }) =>
      api.createReminder(ticketId, { reminder_time: reminderTime, message }),
    onSuccess: () => {
      toast.success('Påminnelse skapad');
      queryClient.invalidateQueries({ queryKey: remindersKey });
    },
    onError: (error: unknown) => {
      if (import.meta.env.DEV) console.error('Error creating reminder:', error);
      toast.error('Kunde inte skapa påminnelse');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (reminderId: string) => api.deleteReminder(ticketId, reminderId),
    onSuccess: () => {
      toast.success('Påminnelse raderad');
      queryClient.invalidateQueries({ queryKey: remindersKey });
    },
    onError: (error: unknown) => {
      if (import.meta.env.DEV) console.error('Error deleting reminder:', error);
      toast.error('Kunde inte radera påminnelse');
    },
  });

  const clearSentMutation = useMutation({
    mutationFn: () => api.clearSentReminders(ticketId),
    onSuccess: (result: { deleted: number }) => {
      toast.success(`${result.deleted} skickade påminnelser rensade`);
      queryClient.invalidateQueries({ queryKey: remindersKey });
    },
    onError: (error: unknown) => {
      if (import.meta.env.DEV) console.error('Error clearing sent reminders:', error);
      toast.error('Kunde inte rensa påminnelser');
    },
  });

  // Behåll Promise<void>-kontraktet som konsumenterna (ReminderDialog/-List) väntar.
  const createReminder = async (reminderTime: string, message?: string): Promise<void> => {
    await createMutation.mutateAsync({ reminderTime, message });
  };

  const deleteReminder = async (reminderId: string): Promise<void> => {
    await deleteMutation.mutateAsync(reminderId);
  };

  const clearSentReminders = async (): Promise<void> => {
    await clearSentMutation.mutateAsync();
  };

  return {
    reminders,
    isLoading,
    isError,
    createReminder,
    deleteReminder,
    clearSentReminders,
  };
}
