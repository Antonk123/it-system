import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Tag } from '@/types/ticket';

const tagKeys = {
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
  });

  // Update tag
  const updateTagMutation = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name: string; color?: string }) =>
      api.updateTag(id, { name, color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.list() });
    },
  });

  // Delete tag
  const deleteTagMutation = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.list() });
    },
  });

  return {
    tags,
    isLoading,
    error,
    refetch,
    createTag: createTagMutation.mutateAsync,
    updateTag: updateTagMutation.mutateAsync,
    deleteTag: deleteTagMutation.mutateAsync,
    isCreating: createTagMutation.isPending,
    isUpdating: updateTagMutation.isPending,
    isDeleting: deleteTagMutation.isPending,
  };
}
