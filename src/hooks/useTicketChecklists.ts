import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { checklistItemSchema, getValidationError } from '@/lib/validations';
import { ticketKeys } from '@/hooks/useTickets';
import { invalidateTicketDerived } from '@/hooks/invalidateTicketDerived';
import { toast } from 'sonner';

export interface ChecklistItem {
  id: string;
  ticket_id: string;
  label: string;
  completed: boolean;
  position: number;
  parent_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

// Query-key factory — invalidate the SPECIFIC ticket(id) key to avoid matching
// unrelated checklist queries or relying on stale closure-captured IDs.
export const checklistKeys = {
  all: ['checklists'] as const,
  ticket: (id: string) => ['checklists', id] as const,
};

// Förloppskolumnen i ärendetabellen. Ligger under ticketKeys.all så att
// invalidateTicketDerived() uppdaterar den när en checklista ändras.
export const checklistProgressKeys = {
  ids: (ticketIds: string[]) => [...ticketKeys.all, 'checklist-progress', ticketIds] as const,
};

export const useChecklistProgress = (ticketIds: string[], enabled = true) => {
  const { data } = useQuery({
    queryKey: checklistProgressKeys.ids(ticketIds),
    queryFn: ({ signal }) => api.getChecklistProgress(ticketIds, signal),
    enabled: enabled && ticketIds.length > 0,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
  return data;
};

export const useTicketChecklists = (ticketId?: string) => {
  const queryClient = useQueryClient();
  const queryKey = checklistKeys.ticket(ticketId ?? '');

  const { data: items = [], isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await api.getChecklists(ticketId!);
      return data as ChecklistItem[];
    },
    enabled: Boolean(ticketId),
  });

  // setItems — direct cache override (used by applyChecklistTemplate consumer)
  const setItems = useCallback((newItems: ChecklistItem[]) => {
    queryClient.setQueryData(checklistKeys.ticket(ticketId ?? ''), newItems);
  }, [queryClient, ticketId]);

  const addItemMutation = useMutation({
    mutationFn: async ({
      targetTicketId, label, options,
    }: { targetTicketId: string; label: string; options?: { parent_id?: string | null; due_date?: string | null } }) => {
      const data = await api.createChecklistItem(targetTicketId, label, options);
      return data as ChecklistItem;
    },
    onSuccess: (_data, { targetTicketId }) => {
      queryClient.invalidateQueries({ queryKey: checklistKeys.ticket(targetTicketId) });
      // L23: keep the ticket list's checklist filter (?checklist=none/complete/…)
      // and progress column correct.
      void invalidateTicketDerived(queryClient, targetTicketId);
    },
    onError: () => {
      toast.error('Kunde inte lägga till checklistpunkt');
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({
      id, updates,
    }: { id: string; updates: Partial<Pick<ChecklistItem, 'label' | 'completed' | 'due_date' | 'parent_id'>> }) => {
      await api.updateChecklistItem(id, updates);
      return { id, updates };
    },
    onSuccess: () => {
      // Scope invalidation to the active ticket's checklist (avoids matching
      // unrelated checklist queries / stale closure keys).
      queryClient.invalidateQueries({ queryKey });
      // Refresh ticket list and progress column so the checklist filter
      // (?checklist=none/complete/…) stays correct on every update.
      void invalidateTicketDerived(queryClient, ticketId);
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error updating checklist item:', error);
      toast.error('Kunde inte uppdatera checklistpunkt');
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.deleteChecklistItem(id);
      return id;
    },
    onSuccess: () => {
      // Scope to the active ticket's checklist; also refresh ticket list so the
      // checklist filter (?checklist=none/complete/…) reflects the removed item.
      queryClient.invalidateQueries({ queryKey });
      void invalidateTicketDerived(queryClient, ticketId);
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error deleting checklist item:', error);
      toast.error('Kunde inte ta bort checklistpunkt');
    },
  });

  const bulkAddMutation = useMutation({
    mutationFn: async ({ targetTicketId, labels }: { targetTicketId: string; labels: string[] }) => {
      return await api.bulkCreateChecklistItems(targetTicketId, labels) as ChecklistItem[];
    },
    onSuccess: (_data, { targetTicketId }) => {
      queryClient.invalidateQueries({ queryKey: checklistKeys.ticket(targetTicketId) });
      // L23: keep the ticket list's checklist filter and progress column correct.
      void invalidateTicketDerived(queryClient, targetTicketId);
    },
    onError: () => {
      toast.error('Kunde inte lägga till checklistpunkter');
    },
  });

  const addChecklistItem = useCallback(async (
    targetTicketId: string,
    label: string,
    options?: { parent_id?: string | null; due_date?: string | null }
  ) => {
    const validation = checklistItemSchema.safeParse({ label });
    if (!validation.success) { toast.error(getValidationError(validation.error) || 'Ogiltig checklistpunkt'); return null; }
    try {
      return await addItemMutation.mutateAsync({ targetTicketId, label: validation.data.label, options });
    } catch {
      return null;
    }
  }, [addItemMutation]);

  const updateChecklistItem = useCallback(async (
    id: string,
    updates: Partial<Pick<ChecklistItem, 'label' | 'completed' | 'due_date' | 'parent_id'>>
  ) => {
    try {
      await updateItemMutation.mutateAsync({ id, updates });
    } catch {
      // errors handled in mutation onError
    }
  }, [updateItemMutation]);

  const deleteChecklistItem = useCallback(async (id: string) => {
    try {
      await deleteItemMutation.mutateAsync(id);
    } catch {
      // errors handled in mutation onError
    }
  }, [deleteItemMutation]);

  const bulkAddChecklistItems = useCallback(async (targetTicketId: string, labels: string[]): Promise<ChecklistItem[]> => {
    if (labels.length === 0) return [];
    try {
      return await bulkAddMutation.mutateAsync({ targetTicketId, labels });
    } catch {
      return [];
    }
  }, [bulkAddMutation]);

  return { items, isLoading, isError, addChecklistItem, updateChecklistItem, deleteChecklistItem, bulkAddChecklistItems, setItems };
};
