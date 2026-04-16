import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiKeyRow } from '@/lib/api';

export const apiKeyKeys = {
  all: ['api-keys'] as const,
  list: () => [...apiKeyKeys.all, 'list'] as const,
};

export const useApiKeys = () => {
  const queryClient = useQueryClient();

  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: apiKeyKeys.list(),
    queryFn: () => api.getApiKeys(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; permissions?: string[]; expires_at?: string }) =>
      api.createApiKey(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.list() });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.list() });
    },
  });

  return {
    apiKeys,
    isLoading,
    createApiKey: createMutation.mutateAsync,
    deleteApiKey: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
};
