import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface SystemUser { id: string; email: string; displayName?: string | null; createdAt: string; lastSignIn: string | null; role: 'admin' | 'user'; emailConfirmed: boolean; }

export const useSystemUsers = () => {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true); setError(null);
    try { const { users } = await api.getSystemUsers(); setUsers(users); }
    catch (err) { setError('Kunde inte hämta systemanvändare'); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const inviteUser = useCallback(async (email: string, role: 'admin' | 'user' = 'user', displayName?: string) => {
    try {
      const result = await api.createSystemUser(email, role, displayName);
      toast.success(result.temporaryPassword ? `Användare skapad. Temporärt lösenord: ${result.temporaryPassword}` : 'Användare skapad');
      await fetchUsers(); return true;
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Kunde inte skapa användare'); return false; }
  }, [fetchUsers]);

  const deleteUser = useCallback(async (userId: string) => {
    try { await api.deleteSystemUser(userId); toast.success('Användare borttagen'); await fetchUsers(); return true; }
    catch (err) { toast.error('Kunde inte ta bort användare'); return false; }
  }, [fetchUsers]);

  const updateRole = useCallback(async (userId: string, role: 'admin' | 'user') => {
    try { await api.updateSystemUserRole(userId, role); toast.success('Roll uppdaterad'); await fetchUsers(); return true; }
    catch (err) { toast.error('Kunde inte uppdatera roll'); return false; }
  }, [fetchUsers]);

  return { users, isLoading, error, inviteUser, deleteUser, updateRole, refetch: fetchUsers };
};
