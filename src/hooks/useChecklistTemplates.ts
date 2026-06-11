import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ChecklistTemplate } from '@/lib/api';
import { toast } from 'sonner';

const QUERY_KEY = ['checklist-templates'] as const;

export const useChecklistTemplates = () => {
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery<ChecklistTemplate[]>({
    queryKey: QUERY_KEY,
    queryFn: () => api.getChecklistTemplates(),
    staleTime: 5 * 60 * 1000,
  });

  // No-op kept for backward compatibility — react-query fetches automatically.
  // Callers that do `useEffect(() => { fetchTemplates(); }, [fetchTemplates])` are safe:
  // the effect runs but does nothing extra since the query already ran on mount.
  const fetchTemplates = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      items: { label: string; parent_label?: string }[];
    }) => api.createChecklistTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success('Mall skapad');
    },
    onError: (e: any) => {
      toast.error(
        e.message?.includes('already exists')
          ? 'En mall med det namnet finns redan'
          : 'Kunde inte skapa mall'
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: {
      id: string;
      data: { name?: string; description?: string; items?: { label: string; parent_label?: string }[] };
    }) => api.updateChecklistTemplate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success('Mall uppdaterad');
    },
    onError: () => {
      toast.error('Kunde inte uppdatera mall');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteChecklistTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success('Mall borttagen');
    },
    onError: () => {
      toast.error('Kunde inte ta bort mall');
    },
  });

  const createTemplate = useCallback(async (data: {
    name: string;
    description?: string;
    items: { label: string; parent_label?: string }[];
  }) => {
    try {
      return await createMutation.mutateAsync(data);
    } catch {
      return null;
    }
  }, [createMutation]);

  const updateTemplate = useCallback(async (
    id: string,
    data: { name?: string; description?: string; items?: { label: string; parent_label?: string }[] }
  ) => {
    try {
      return await updateMutation.mutateAsync({ id, data });
    } catch {
      return null;
    }
  }, [updateMutation]);

  const deleteTemplate = useCallback(async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
    } catch {
      // error toast handled in onError
    }
  }, [deleteMutation]);

  const applyTemplate = useCallback(async (templateId: string, ticketId: string) => {
    try {
      const items = await api.applyChecklistTemplate(templateId, ticketId);
      toast.success('Mall applicerad');
      return items;
    } catch {
      toast.error('Kunde inte applicera mall');
      return null;
    }
  }, []);

  return { templates, isLoading, fetchTemplates, createTemplate, updateTemplate, deleteTemplate, applyTemplate };
};
