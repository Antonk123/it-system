import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Tag } from '@/types/ticket';
import { toast } from 'sonner';

export const tagKeys = {
  all: ['tags'] as const,
  list: () => [...tagKeys.all, 'list'] as const,
};

export function useTags() {
  const queryClient = useQueryClient();

  // Fetch all tags
  const { data: tags = [], isLoading, error, refetch } = useQuery({
    queryKey: tagKeys.list(),
    queryFn: () => api.getTags(),
  });

  // Create tag
  const createTagMutation = useMutation({
    mutationFn: (tagData: { name: string; color?: string }) => api.createTag(tagData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.list() });
    },
    onError: () => toast.error('Kunde inte skapa tagg'),
  });

  // Update tag
  const updateTagMutation = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name: string; color?: string }) =>
      api.updateTag(id, { name, color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.list() });
    },
    onError: () => toast.error('Kunde inte uppdatera tagg'),
  });

  // Delete tag
  const deleteTagMutation = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.list() });
    },
    onError: () => toast.error('Kunde inte ta bort tagg'),
  });

  // Wrapped callbacks (useCompanies convention). Preserve the existing contract:
  // return the resolved value and re-throw on error so callers' try/catch still works.
  const createTag = useCallback(
    (tagData: { name: string; color?: string }) => createTagMutation.mutateAsync(tagData),
    [createTagMutation],
  );

  const updateTag = useCallback(
    (vars: { id: string; name: string; color?: string }) => updateTagMutation.mutateAsync(vars),
    [updateTagMutation],
  );

  const deleteTag = useCallback(
    (id: string) => deleteTagMutation.mutateAsync(id),
    [deleteTagMutation],
  );

  return {
    tags,
    isLoading,
    error,
    refetch,
    createTag,
    updateTag,
    deleteTag,
    isCreating: createTagMutation.isPending,
    isUpdating: updateTagMutation.isPending,
    isDeleting: deleteTagMutation.isPending,
  };
}
