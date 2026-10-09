import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const backupFilesKeys = {
  all: ['backup-files'] as const,
  list: () => [...backupFilesKeys.all, 'list'] as const,
};

export const useBackupFiles = () => {
  const { data: files = [], isLoading, isError } = useQuery({
    queryKey: backupFilesKeys.list(),
    queryFn: () => api.getBackupFiles(),
  });

  return { files, isLoading, isError };
};
