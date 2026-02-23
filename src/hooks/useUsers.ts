import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { User } from '@/types/ticket';
import { contactSchema, contactUpdateSchema, getValidationError } from '@/lib/validations';
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
  const { data: users = [], isLoading } = useQuery({
    queryKey: userKeys.list(),
    queryFn: async () => {
      const data = await api.getContacts();
      const mapped: User[] = data.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        department: u.company || undefined,
        createdAt: new Date(u.created_at),
      }));
      return mapped;
    },
    staleTime: 1000 * 60 * 5, // Users don't change very often, cache for 5 minutes
  });

  // Add user mutation
  const addUserMutation = useMutation({
    mutationFn: async (user: Omit<User, 'id' | 'createdAt'>) => {
      const validation = contactSchema.safeParse(user);
      if (!validation.success) {
        throw new Error(getValidationError(validation.error) || 'Invalid contact data');
      }
      const data = await api.createContact({
        name: validation.data.name,
        email: validation.data.email,
        company: validation.data.department || null,
      });
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        department: data.company || undefined,
        createdAt: new Date(data.created_at),
      };
    },
    onSuccess: (newUser) => {
      // Optimistically update the cache
      queryClient.setQueryData(userKeys.list(), (old: User[] | undefined) => {
        if (!old) return [newUser];
        return [newUser, ...old];
      });
    },
    onError: () => {
      toast.error('Failed to create contact');
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<User> }) => {
      const validation = contactUpdateSchema.safeParse(updates);
      if (!validation.success) {
        throw new Error(getValidationError(validation.error) || 'Invalid contact data');
      }
      await api.updateContact(id, {
        name: validation.data.name,
        email: validation.data.email,
        company: validation.data.department || null,
      });
      return { id, updates };
    },
    onSuccess: ({ id, updates }) => {
      // Optimistically update the cache
      queryClient.setQueryData(userKeys.list(), (old: User[] | undefined) => {
        if (!old) return old;
        return old.map((u) => (u.id === id ? { ...u, ...updates } : u));
      });
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
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error deleting user:', error);
    },
  });

  const addUser = useCallback(
    async (user: Omit<User, 'id' | 'createdAt'>) => {
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

  return { users, isLoading, addUser, updateUser, deleteUser, getUserById, refetch };
};
