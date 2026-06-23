import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface SystemUser {
  id: string;
  email: string;
  displayName?: string | null;
  createdAt: string;
  lastSignIn: string | null;
  role: 'admin' | 'user';
  emailConfirmed: boolean;
}

export const systemUserKeys = {
  all: ['system-users'] as const,
  list: () => [...systemUserKeys.all, 'list'] as const,
};

/**
 * Hämta listan av systemanvändare (kräver admin på backend).
 * @param enabled Sätt false för att skippa nätverksanropet (t.ex. för icke-admins).
 */
export const useSystemUsers = (options: { enabled?: boolean } = {}) => {
  const { enabled = true } = options;
  const queryClient = useQueryClient();

  const {
    data: users = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: systemUserKeys.list(),
    queryFn: async (): Promise<SystemUser[]> => {
      const result = await api.getSystemUsers();
      return result.users;
    },
    enabled,
    staleTime: 1000 * 60 * 5, // 5 min — admin user list rarely changes
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: systemUserKeys.list() });
  }, [queryClient]);

  // Mutations drive cache invalidation via their onSuccess lifecycle — the
  // wrapper functions no longer invalidate manually.
  const inviteMutation = useMutation({
    mutationFn: ({ email, role, displayName }: { email: string; role: 'admin' | 'user'; displayName?: string }) =>
      api.createSystemUser(email, role, displayName),
    onSuccess: (result) => {
      toast.success(
        result.temporaryPassword
          ? `Användare skapad. Temporärt lösenord: ${result.temporaryPassword}`
          : 'Användare skapad',
      );
      queryClient.invalidateQueries({ queryKey: systemUserKeys.list() });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Kunde inte skapa användare');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => api.deleteSystemUser(userId),
    onSuccess: () => {
      toast.success('Användare borttagen');
      queryClient.invalidateQueries({ queryKey: systemUserKeys.list() });
    },
    onError: () => {
      toast.error('Kunde inte ta bort användare');
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'user' }) =>
      api.updateSystemUserRole(userId, role),
    onSuccess: () => {
      toast.success('Roll uppdaterad');
      queryClient.invalidateQueries({ queryKey: systemUserKeys.list() });
    },
    onError: () => {
      toast.error('Kunde inte uppdatera roll');
    },
  });

  const inviteUser = useCallback(
    async (email: string, role: 'admin' | 'user' = 'user', displayName?: string) => {
      try {
        await inviteMutation.mutateAsync({ email, role, displayName });
        return true;
      } catch {
        return false;
      }
    },
    [inviteMutation],
  );

  const deleteUser = useCallback(
    async (userId: string) => {
      try {
        await deleteMutation.mutateAsync(userId);
        return true;
      } catch {
        return false;
      }
    },
    [deleteMutation],
  );

  const updateRole = useCallback(
    async (userId: string, role: 'admin' | 'user') => {
      try {
        await updateRoleMutation.mutateAsync({ userId, role });
        return true;
      } catch {
        return false;
      }
    },
    [updateRoleMutation],
  );

  return {
    users,
    isLoading,
    error: error ? 'Kunde inte hämta systemanvändare' : null,
    inviteUser,
    deleteUser,
    updateRole,
    refetch: invalidate,
  };
};
