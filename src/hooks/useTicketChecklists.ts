import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ChecklistRow } from '@/lib/api';
import { checklistItemSchema, getValidationError } from '@/lib/validations';
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

export const useTicketChecklists = (initialTicketId?: string) => {
  const queryClient = useQueryClient();
  // Internal query ID — updated when fetchChecklists(id) is called
  const [queryTicketId, setQueryTicketId] = useState<string | undefined>(initialTicketId);
  const queryKey = useMemo(
    () => (queryTicketId ? checklistKeys.ticket(queryTicketId) : checklistKeys.all),
    [queryTicketId],
  );

  const { data: items = [], isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await api.getChecklists(queryTicketId!);
      return data as ChecklistItem[];
    },
    enabled: Boolean(queryTicketId),
  });

  // fetchChecklists(id?) — sets active ticket ID (triggers query) and invalidates cache
  const fetchChecklists = useCallback(async (id?: string) => {
    const targetId = id || queryTicketId;
    if (!targetId) return;
    setQueryTicketId(targetId);
    await queryClient.invalidateQueries({ queryKey: checklistKeys.ticket(targetId) });
  }, [queryClient, queryTicketId]);

  // setItems — direct cache override (used by applyChecklistTemplate consumer)
  const setItems = useCallback((newItems: ChecklistItem[]) => {
    queryClient.setQueryData(queryKey, newItems);
  }, [queryClient, queryKey]);

  const addItemMutation = useMutation({
    mutationFn: async ({
      targetTicketId, label, options,
    }: { targetTicketId: string; label: string; options?: { parent_id?: string | null; due_date?: string | null } }) => {
      const data = await api.createChecklistItem(targetTicketId, label, options);
      return data as ChecklistItem;
    },
    onSuccess: (_data, { targetTicketId }) => {
      queryClient.invalidateQueries({ queryKey: checklistKeys.ticket(targetTicketId) });
    },
    onError: () => {
      toast.error('Failed to add checklist item');
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
      queryClient.invalidateQueries({ queryKey: queryKey });
      // Refresh ticket list so checklist progress column stays in sync —
      // run on every update for consistent behaviour (not only on completed-toggle).
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
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
      // progress column reflects the removed item.
      queryClient.invalidateQueries({ queryKey: queryKey });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
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
    },
    onError: () => {
      toast.error('Failed to add checklist items');
    },
  });

  const addChecklistItem = useCallback(async (
    targetTicketId: string,
    label: string,
    options?: { parent_id?: string | null; due_date?: string | null }
  ) => {
    const validation = checklistItemSchema.safeParse({ label });
    if (!validation.success) { toast.error(getValidationError(validation.error) || 'Invalid checklist item'); return null; }
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

  return { items, isLoading, isError, fetchChecklists, addChecklistItem, updateChecklistItem, deleteChecklistItem, bulkAddChecklistItems, setItems };
};
