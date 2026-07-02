import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CustomFieldInput } from '@/lib/api';
import { Ticket } from '@/types/ticket';
import {
  buildAddTicketMutationOptions,
  buildUpdateTicketMutationOptions,
  buildDeleteTicketMutationOptions,
} from '@/hooks/useTickets';

// M9: ticket mutations (add/update/delete) for consumers like TicketDetail and
// TicketForm that never need the ticket LIST. Previously those pages called
// the full useTickets() just to reach addTicket/updateTicket/deleteTicket,
// which also mounted useTickets()'s own unfiltered list useQuery — silently
// triggering the backend's legacy `SELECT ... LIMIT 1000` branch on every
// page open. This hook reuses the exact same mutation logic (via the builders
// exported from useTickets.ts) without that list query.
export const useTicketMutations = () => {
  const queryClient = useQueryClient();

  const addTicketMutation = useMutation(buildAddTicketMutationOptions(queryClient));
  const updateTicketMutation = useMutation(buildUpdateTicketMutationOptions(queryClient));
  const deleteTicketMutation = useMutation(buildDeleteTicketMutationOptions(queryClient));

  const addTicket = useCallback(
    async (ticket: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'> & { assigned_to?: string; company_id?: string }, customFields?: CustomFieldInput[]) => {
      // Let the mutation handle errors (it shows toast on error)
      return await addTicketMutation.mutateAsync({ ...ticket, customFields });
    },
    [addTicketMutation]
  );

  const updateTicket = useCallback(
    async (id: string, updates: Partial<Ticket>, customFields?: CustomFieldInput[]) => {
      await updateTicketMutation.mutateAsync({ id, updates, customFields });
    },
    [updateTicketMutation]
  );

  const deleteTicket = useCallback(
    async (id: string) => {
      await deleteTicketMutation.mutateAsync(id);
    },
    [deleteTicketMutation]
  );

  return {
    addTicket,
    updateTicket,
    deleteTicket,
    isAdding: addTicketMutation.isPending,
    isUpdating: updateTicketMutation.isPending,
    isDeleting: deleteTicketMutation.isPending,
  };
};
