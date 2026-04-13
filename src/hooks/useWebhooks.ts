import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, WebhookRow, WebhookDeliveryRow } from '@/lib/api';

export const webhookKeys = {
  all: ['webhooks'] as const,
  list: () => [...webhookKeys.all, 'list'] as const,
  deliveries: (id: string) => [...webhookKeys.all, 'deliveries', id] as const,
};

export const useWebhooks = () => {
  const queryClient = useQueryClient();

  const { data: webhooks = [], isLoading } = useQuery({
    queryKey: webhookKeys.list(),
    queryFn: () => api.getWebhooks(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { url: string; events: string[] }) =>
      api.createWebhook(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.list() });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; url?: string; events?: string[]; active?: boolean }) =>
      api.updateWebhook(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.list() });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteWebhook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.list() });
    },
  });

  return {
    webhooks,
    isLoading,
    createWebhook: createMutation.mutateAsync,
    updateWebhook: updateMutation.mutateAsync,
    deleteWebhook: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
};

export const useWebhookDeliveries = (webhookId: string) => {
  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: webhookKeys.deliveries(webhookId),
    queryFn: () => api.getWebhookDeliveries(webhookId),
    enabled: !!webhookId,
  });

  return { deliveries, isLoading };
};
