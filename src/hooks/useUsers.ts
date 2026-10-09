import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, ContactRow } from '@/lib/api';
import { User } from '@/types/ticket';
import { contactSchema, contactUpdateSchema, getValidationError } from '@/lib/validations';
import { parseServerDate } from '@/lib/date';
import { toast } from 'sonner';

// Query keys for React Query
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: () => [...userKeys.lists()] as const,
  page: (page: number, search: string) => [...userKeys.list(), 'page', page, search] as const,
};

export const CONTACTS_PAGE_SIZE = 50;

const toUser = (c: ContactRow) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  department: c.department || undefined,
  company_id: c.company_id || undefined,
  company_name: c.company_name || undefined,
  createdAt: parseServerDate(c.created_at),
});

/** Server-side paginated + searched contact list (page size 50). */
export const useContactsPage = (page: number, search: string, enabled = true) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: userKeys.page(page, search),
    queryFn: async () => {
      const result = await api.getContactsPage({ page, limit: CONTACTS_PAGE_SIZE, search });
      return { users: result.data.map(toUser) as User[], total: result.pagination.total };
    },
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 1000 * 60,
  });

  return { users: data?.users ?? [], total: data?.total ?? 0, isLoading, isError };
};

export const useUsers = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const queryClient = useQueryClient();

  // Fetch users (contacts) with React Query
  const { data: users = [], isLoading, isError } = useQuery({
    queryKey: userKeys.list(),
    queryFn: async () => {
      const data = await api.getContacts();
      return data.map(toUser) as User[];
    },
    enabled,
    staleTime: 1000 * 60 * 5, // Users don't change very often, cache for 5 minutes
  });

  // Add user mutation
  const addUserMutation = useMutation({
    mutationFn: async (user: Omit<User, 'id' | 'createdAt'> & { company_id?: string }) => {
      const validation = contactSchema.safeParse(user);
      if (!validation.success) {
        throw new Error(getValidationError(validation.error) || 'Invalid contact data');
      }
      const data = await api.createContact({
        name: validation.data.name,
        email: validation.data.email,
        company_id: (user as any).company_id || null,
        department: validation.data.department || null,
      } as any);
      return toUser(data);
    },
    onSuccess: (newUser) => {
      // Optimistically update the cache for instant feedback...
      queryClient.setQueryData(userKeys.list(), (old: User[] | undefined) => {
        if (!old) return [newUser];
        return [newUser, ...old];
      });
      // ...then reconcile with the server. The optimistic entry lacks
      // company_name, and on a PWA the in-memory cache is lost when iOS
      // suspends the app — without this the new contact "disappears".
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Kunde inte skapa kontakt');
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<User> & { company_id?: string } }) => {
      const validation = contactUpdateSchema.safeParse(updates);
      if (!validation.success) {
        throw new Error(getValidationError(validation.error) || 'Invalid contact data');
      }
      await api.updateContact(id, {
        name: validation.data.name,
        email: validation.data.email,
        company_id: (updates as any).company_id ?? null,
        department: validation.data.department || null,
      } as any);
      return { id, updates };
    },
    onSuccess: ({ id, updates }) => {
      // Optimistically update the cache
      queryClient.setQueryData(userKeys.list(), (old: User[] | undefined) => {
        if (!old) return old;
        return old.map((u) => (u.id === id ? { ...u, ...updates } : u));
      });
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Kunde inte uppdatera kontakt');
    },
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.deleteContact(id);
      return id;
    },
    onSuccess: (id) => {
      // Optimistically update the cache
      queryClient.setQueryData(userKeys.list(), (old: User[] | undefined) => {
        if (!old) return old;
        return old.filter((u) => u.id !== id);
      });
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error deleting user:', error);
      toast.error('Kunde inte ta bort användare');
    },
  });

  const addUser = useCallback(
    async (user: Omit<User, 'id' | 'createdAt'> & { company_id?: string }) => {
      try {
        return await addUserMutation.mutateAsync(user);
      } catch (error) {
        return null;
      }
    },
    [addUserMutation]
  );

  const updateUser = useCallback(
    async (id: string, updates: Partial<User>) => {
      await updateUserMutation.mutateAsync({ id, updates });
    },
    [updateUserMutation]
  );

  const deleteUser = useCallback(
    async (id: string) => {
      await deleteUserMutation.mutateAsync(id);
    },
    [deleteUserMutation]
  );

  const getUserById = useCallback((id: string) => users.find((u) => u.id === id), [users]);

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: userKeys.list() });
  }, [queryClient]);

  return { users, isLoading, isError, addUser, updateUser, deleteUser, getUserById, refetch };
};
