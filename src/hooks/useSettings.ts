import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const settingsKeys = {
  all: ['settings'] as const,
};

export const useSettings = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => api.getSettings(),
  });

  const updateTwoWayEmail = useMutation({
    mutationFn: (enabled: boolean) => api.updateTwoWayEmail(enabled),
    onSuccess: (result) => {
      queryClient.setQueryData(settingsKeys.all, result);
      queryClient.invalidateQueries({ queryKey: settingsKeys.all });
      toast.success(result.twoWayEmailEnabled ? 'Två-vägs e-post aktiverad' : 'Två-vägs e-post inaktiverad');
    },
    onError: () => toast.error('Kunde inte spara inställningen'),
  });

  // Default to enabled (matches the backend fallback) while loading, so the
  // public-reply toggle never disappears spuriously before the setting arrives.
  return {
    twoWayEmailEnabled: data?.twoWayEmailEnabled ?? true,
    isLoading,
    isError,
    updateTwoWayEmail,
  };
};
