import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { User } from '@/types/ticket';
import { contactSchema, contactUpdateSchema, getValidationError } from '@/lib/validations';
import { parseServerDate } from '@/lib/date';
import { toast } from 'sonner';

// Query keys for React Query
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: () => [...userKeys.lists()] as const,
};

export const useUsers = () => {
  const queryClient = useQueryClient();

  // Fetch users (contacts) with React Query
  const { data: users = [], isLoading, isError } = useQuery({
    queryKey: userKeys.list(),
    queryFn: async () => {
      const data = await api.getContacts();
      const mapped = data.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        department: u.department || undefined,
        company_id: u.company_id || undefined,
        company_name: u.company_name || undefined,
        createdAt: parseServerDate(u.created_at),
      }));
      return mapped as (User & { company_id?: string; company_name?: string })[];
    },
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
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        department: data.department || undefined,
        createdAt: parseServerDate(data.created_at),
      };
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
    onError: () => {
      toast.error('Failed to create contact');
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
    onError: () => {
      toast.error('Failed to update contact');
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
