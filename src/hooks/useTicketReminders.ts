import { useState, useCallback } from 'react';
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
  const [reminders, setReminders] = useState<TicketReminder[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReminders = useCallback(async () => {
    if (!ticketId) return;
    setIsLoading(true);
    try {
      const data = await api.getReminders(ticketId);
      setReminders(data);
    } catch (error) {
      console.error('Error fetching reminders:', error);
      toast.error('Kunde inte hämta påminnelser');
    } finally {
      setIsLoading(false);
    }
  }, [ticketId]);

  const createReminder = useCallback(async (reminderTime: string, message?: string) => {
    try {
      await api.createReminder(ticketId, { reminder_time: reminderTime, message });
      toast.success('Påminnelse skapad');
      await fetchReminders();
    } catch (error) {
      console.error('Error creating reminder:', error);
      toast.error('Kunde inte skapa påminnelse');
    }
  }, [ticketId, fetchReminders]);

  const deleteReminder = useCallback(async (reminderId: string) => {
    try {
      await api.deleteReminder(ticketId, reminderId);
      toast.success('Påminnelse raderad');
      await fetchReminders();
    } catch (error) {
      console.error('Error deleting reminder:', error);
      toast.error('Kunde inte radera påminnelse');
    }
  }, [ticketId, fetchReminders]);

  return {
    reminders,
    isLoading,
    fetchReminders,
    createReminder,
    deleteReminder,
  };
}
