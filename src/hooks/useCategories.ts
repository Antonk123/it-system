import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Category } from '@/types/ticket';
import { categorySchema, getValidationError } from '@/lib/validations';
import { toast } from 'sonner';

// Query keys for React Query
export const categoryKeys = {
  all: ['categories'] as const,
  lists: () => [...categoryKeys.all, 'list'] as const,
  list: () => [...categoryKeys.lists()] as const,
};

export const useCategories = () => {
  const queryClient = useQueryClient();

  // Fetch categories with React Query
  const { data: categories = [], isLoading, isError } = useQuery({
    queryKey: categoryKeys.list(),
    queryFn: async () => {
      const data = await api.getCategories();
      const mapped: Category[] = data.map((c) => ({ id: c.id, label: c.label, position: c.position, icon: c.icon ?? null }));
      return mapped;
    },
    staleTime: 1000 * 60 * 10, // Categories rarely change, cache for 10 minutes
  });

  // Add category mutation
  const addCategoryMutation = useMutation({
    mutationFn: async ({ label, icon }: { label: string; icon?: string | null }) => {
      const validation = categorySchema.safeParse({ label });
      if (!validation.success) {
        throw new Error(getValidationError(validation.error) || 'Invalid category data');
      }
      const data = await api.createCategory(validation.data.label, icon);
      return { id: data.id, label: data.label, position: data.position, icon: data.icon ?? null };
    },
    onSuccess: (newCategory) => {
      // Optimistically update the cache
      queryClient.setQueryData(categoryKeys.list(), (old: Category[] | undefined) => {
        if (!old) return [newCategory];
        return [...old, newCategory].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      });
    },
    onError: () => {
      toast.error('Kunde inte skapa kategori');
    },
  });

  // Update category mutation
  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, label, icon }: { id: string; label: string; icon?: string | null }) => {
      const validation = categorySchema.safeParse({ label });
      if (!validation.success) {
        throw new Error(getValidationError(validation.error) || 'Invalid category data');
      }
      await api.updateCategory(id, validation.data.label, icon);
      return { id, label: validation.data.label, icon };
    },
    onSuccess: ({ id, label, icon }) => {
      // Optimistically update the cache
      queryClient.setQueryData(categoryKeys.list(), (old: Category[] | undefined) => {
        if (!old) return old;
        return old.map((c) => (c.id === id ? { ...c, label, ...(icon !== undefined && { icon }) } : c));
      });
    },
    onError: () => {
      toast.error('Kunde inte uppdatera kategori');
    },
  });

  // Delete category mutation
  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.deleteCategory(id);
      return id;
    },
    onSuccess: (id) => {
      // Optimistically update the cache
      queryClient.setQueryData(categoryKeys.list(), (old: Category[] | undefined) => {
        if (!old) return old;
        return old.filter((c) => c.id !== id);
      });
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error deleting category:', error);
    },
  });

  // Reorder categories mutation
  const reorderCategoriesMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const data = await api.reorderCategories(ids);
      return data.map((c) => ({ id: c.id, label: c.label, position: c.position, icon: c.icon ?? null }));
    },
    onSuccess: (newCategories) => {
      // Update the cache with new order
      queryClient.setQueryData(categoryKeys.list(), newCategories);
    },
    onError: () => {
      toast.error('Kunde inte omordna kategorier');
    },
  });

  const addCategory = useCallback(
    async (label: string, icon?: string | null) => {
      try {
        return await addCategoryMutation.mutateAsync({ label, icon });
      } catch (error) {
        return null;
      }
    },
    [addCategoryMutation]
  );

  const updateCategory = useCallback(
    async (id: string, label: string, icon?: string | null) => {
      await updateCategoryMutation.mutateAsync({ id, label, icon });
    },
    [updateCategoryMutation]
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      await deleteCategoryMutation.mutateAsync(id);
    },
    [deleteCategoryMutation]
  );

  // Fel visas redan som toast i mutationens onError — svälj här så att
  // anrop som inte awaitas (flytta upp/ned) inte ger unhandled rejections.
  const reorderCategories = useCallback(
    async (ids: string[]) => {
      try {
        await reorderCategoriesMutation.mutateAsync(ids);
      } catch {
        // visas via onError
      }
    },
    [reorderCategoriesMutation]
  );

  const getCategoryLabel = useCallback((id: string) => categories.find((c) => c.id === id)?.label || id, [categories]);

  const getCategoryIcon = useCallback((id: string): string | null => categories.find((c) => c.id === id)?.icon ?? null, [categories]);

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: categoryKeys.list() });
  }, [queryClient]);

  return { categories, isLoading, isError, addCategory, updateCategory, deleteCategory, reorderCategories, getCategoryLabel, getCategoryIcon, refetch };
};
