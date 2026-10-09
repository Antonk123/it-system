import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, KbCategoryRow } from '@/lib/api';
import { kbArticlesKeys } from '@/hooks/useKbArticles';
import { kbArticleKeys } from '@/hooks/useKbArticle';

export const kbCategoryKeys = {
  all: ['kb-categories'] as const,
  list: () => [...kbCategoryKeys.all] as const,
};

/**
 * Invalidates every KB cache a write can affect: category lists (article
 * counts), article lists, and article details.
 */
export const invalidateKbCaches = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: kbCategoryKeys.all });
  queryClient.invalidateQueries({ queryKey: kbArticlesKeys.all });
  queryClient.invalidateQueries({ queryKey: kbArticleKeys.all });
};

/**
 * Fetches KB categories via react-query and exposes create/update/delete
 * mutations that invalidate all KB caches (renamed/removed categories show up
 * in article lists and details).
 * Returns { categories, isLoading, isError, refetch, createCategory, updateCategory, deleteCategory }.
 * The mutation helpers resolve to true on success and show their own toast.
 */
export const useKbCategories = () => {
  const queryClient = useQueryClient();

  const { data: categories = [], isLoading, isError } = useQuery<KbCategoryRow[]>({
    queryKey: kbCategoryKeys.list(),
    queryFn: () => api.getKbCategories(),
    staleTime: 1000 * 60 * 5, // KB categories rarely change — 5 min
  });

  const refetch = () => invalidateKbCaches(queryClient);

  const createMutation = useMutation({
    mutationFn: (name: string) => api.createKbCategory(name),
    onSuccess: () => {
      invalidateKbCaches(queryClient);
      toast.success('Kategori skapad');
    },
    onError: () => toast.error('Kunde inte skapa kategori'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.updateKbCategory(id, name),
    onSuccess: () => {
      invalidateKbCaches(queryClient);
      toast.success('Kategori uppdaterad');
    },
    onError: () => toast.error('Kunde inte uppdatera kategori'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteKbCategory(id),
    onSuccess: () => {
      invalidateKbCaches(queryClient);
      toast.success('Kategori raderad');
    },
    onError: () => toast.error('Kunde inte radera kategori'),
  });

  const createCategory = useCallback(
    async (name: string) => {
      try { await createMutation.mutateAsync(name); return true; } catch { return false; }
    },
    [createMutation]
  );

  const updateCategory = useCallback(
    async (id: string, name: string) => {
      try { await updateMutation.mutateAsync({ id, name }); return true; } catch { return false; }
    },
    [updateMutation]
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      try { await deleteMutation.mutateAsync(id); return true; } catch { return false; }
    },
    [deleteMutation]
  );

  return { categories, isLoading, isError, refetch, createCategory, updateCategory, deleteCategory };
};
