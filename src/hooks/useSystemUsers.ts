import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

  const inviteUser = useCallback(
    async (email: string, role: 'admin' | 'user' = 'user', displayName?: string) => {
      try {
        const result = await api.createSystemUser(email, role, displayName);
        toast.success(
          result.temporaryPassword
            ? `Användare skapad. Temporärt lösenord: ${result.temporaryPassword}`
            : 'Användare skapad',
        );
        await invalidate();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Kunde inte skapa användare');
        return false;
      }
    },
    [invalidate],
  );

  const deleteUser = useCallback(
    async (userId: string) => {
      try {
        await api.deleteSystemUser(userId);
        toast.success('Användare borttagen');
        await invalidate();
        return true;
      } catch {
        toast.error('Kunde inte ta bort användare');
        return false;
      }
    },
    [invalidate],
  );

  const updateRole = useCallback(
    async (userId: string, role: 'admin' | 'user') => {
      try {
        await api.updateSystemUserRole(userId, role);
        toast.success('Roll uppdaterad');
        await invalidate();
        return true;
      } catch {
        toast.error('Kunde inte uppdatera roll');
        return false;
      }
    },
    [invalidate],
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
