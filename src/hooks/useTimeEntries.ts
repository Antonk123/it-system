import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const timeEntryKeys = {
  all: ['time-entries'] as const,
  ticket: (ticketId: string) => ['time-entries', ticketId] as const,
};

export function useTimeEntries(ticketId: string) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: timeEntryKeys.ticket(ticketId),
    queryFn: () => api.getTimeEntries(ticketId),
  });

  const addEntry = useMutation({
    mutationFn: (payload: { duration_minutes: number; note?: string }) =>
      api.createTimeEntry(ticketId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeEntryKeys.ticket(ticketId) });
      toast.success('Tid loggad');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Kunde inte logga tid');
    },
  });

  const deleteEntry = useMutation({
    mutationFn: (entryId: string) => api.deleteTimeEntry(ticketId, entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timeEntryKeys.ticket(ticketId) });
      toast.success('Tidpost borttagen');
    },
    onError: () => {
      toast.error('Kunde inte ta bort tidpost');
    },
  });

  return {
    entries: data?.entries ?? [],
    totalMinutes: data?.total_minutes ?? 0,
    isLoading,
    addEntry: addEntry.mutate,
    deleteEntry: deleteEntry.mutate,
    isAdding: addEntry.isPending,
    isDeleting: deleteEntry.isPending,
  };
}
