import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const backupConfigKeys = {
  all: ['backup-config'] as const,
  config: () => [...backupConfigKeys.all, 'config'] as const,
};

export const useBackupConfig = () => {
  const queryClient = useQueryClient();

  const { data: config, isLoading, isError } = useQuery({
    queryKey: backupConfigKeys.config(),
    queryFn: () => api.getBackupConfig(),
  });

  const updateMutation = useMutation({
    mutationFn: (body: { enabled: boolean; time: string; retentionDays: number }) =>
      api.updateBackupConfig(body),
    onSuccess: (data) => {
      queryClient.setQueryData(backupConfigKeys.config(), data);
      queryClient.invalidateQueries({ queryKey: backupConfigKeys.config() });
      toast.success('Backup-schema sparat');
    },
    onError: () => toast.error('Kunde inte spara backup-schemat'),
  });

  return { config, isLoading, isError, updateConfig: updateMutation };
};

export const useRunBackupNow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.runBackupNow(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: backupConfigKeys.config() });
      const sizeMB = data.lastSizeBytes != null
        ? ` (${(data.lastSizeBytes / (1024 * 1024)).toFixed(1)} MB)`
        : '';
      toast.success(`Backup klar${sizeMB}`);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : '';
      // Backend svarar 409 om en backup redan pågår — request() kastar med serverns
      // felmeddelande som .message. Visa det snällt istället för ett generiskt fel.
      if (/pågår|409|in progress|already/i.test(message)) {
        toast.error('En backup pågår redan. Vänta tills den är klar.');
      } else {
        toast.error('Backup misslyckades. Kontrollera servern och försök igen.');
      }
    },
  });
};
