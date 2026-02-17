import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Template, TemplateRow, TemplateFieldRow } from '@/types/ticket';
import { templateSchema, templateUpdateSchema, getValidationError } from '@/lib/validations';
import { toast } from 'sonner';

// Query keys for React Query
export const templateKeys = {
  all: ['templates'] as const,
  lists: () => [...templateKeys.all, 'list'] as const,
  list: () => [...templateKeys.lists()] as const,
};

export const useTemplates = () => {
  const queryClient = useQueryClient();

  // Fetch templates with React Query
  const { data: templates = [], isLoading } = useQuery({
    queryKey: templateKeys.list(),
    queryFn: async () => {
      const data = await api.getTemplates();
      const mapped: Template[] = data.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        titleTemplate: t.title_template,
        descriptionTemplate: t.description_template,
        priority: t.priority as Template['priority'],
        category: t.category_id,
        notesTemplate: t.notes_template,
        solutionTemplate: t.solution_template,
        position: t.position,
        createdBy: t.created_by,
        createdAt: new Date(t.created_at),
        updatedAt: new Date(t.updated_at),
        fields: (t.fields as TemplateFieldRow[] | undefined) || [],
      }));
      return mapped;
    },
    staleTime: 1000 * 60 * 10, // Templates rarely change, cache for 10 minutes
  });

  // Add template mutation
  const addTemplateMutation = useMutation({
    mutationFn: async (template: Omit<Template, 'id' | 'position' | 'createdBy' | 'createdAt' | 'updatedAt'>) => {
      const validation = templateSchema.safeParse(template);
      if (!validation.success) {
        throw new Error(getValidationError(validation.error) || 'Invalid template data');
      }
      const data = await api.createTemplate({
        name: validation.data.name,
        description: validation.data.description || null,
        title_template: validation.data.titleTemplate,
        description_template: validation.data.descriptionTemplate,
        priority: validation.data.priority,
        category_id: validation.data.category || null,
        notes_template: validation.data.notesTemplate || null,
        solution_template: validation.data.solutionTemplate || null,
      });
      return {
        id: data.id,
        name: data.name,
        description: data.description,
        titleTemplate: data.title_template,
        descriptionTemplate: data.description_template,
        priority: data.priority as Template['priority'],
        category: data.category_id,
        notesTemplate: data.notes_template,
        solutionTemplate: data.solution_template,
        position: data.position,
        createdBy: data.created_by,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    },
    onSuccess: (newTemplate) => {
      queryClient.setQueryData(templateKeys.list(), (old: Template[] | undefined) => {
        if (!old) return [newTemplate];
        return [...old, newTemplate].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      });
      toast.success('Mall skapad');
    },
    onError: () => {
      toast.error('Kunde inte skapa mall');
    },
  });

  // Update template mutation
  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Template> }) => {
      const validation = templateUpdateSchema.safeParse(updates);
      if (!validation.success) {
        throw new Error(getValidationError(validation.error) || 'Invalid template data');
      }
      const apiUpdates: any = {};
      if (validation.data.name !== undefined) apiUpdates.name = validation.data.name;
      if (validation.data.description !== undefined) apiUpdates.description = validation.data.description;
      if (validation.data.titleTemplate !== undefined) apiUpdates.title_template = validation.data.titleTemplate;
      if (validation.data.descriptionTemplate !== undefined) apiUpdates.description_template = validation.data.descriptionTemplate;
      if (validation.data.priority !== undefined) apiUpdates.priority = validation.data.priority;
      if (validation.data.category !== undefined) apiUpdates.category_id = validation.data.category;
      if (validation.data.notesTemplate !== undefined) apiUpdates.notes_template = validation.data.notesTemplate;
      if (validation.data.solutionTemplate !== undefined) apiUpdates.solution_template = validation.data.solutionTemplate;

      await api.updateTemplate(id, apiUpdates);
      return { id, updates };
    },
    onSuccess: ({ id, updates }) => {
      queryClient.setQueryData(templateKeys.list(), (old: Template[] | undefined) => {
        if (!old) return old;
        return old.map((t) => (t.id === id ? { ...t, ...updates } : t));
      });
      toast.success('Mall uppdaterad');
    },
    onError: () => {
      toast.error('Kunde inte uppdatera mall');
    },
  });

  // Delete template mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.deleteTemplate(id);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData(templateKeys.list(), (old: Template[] | undefined) => {
        if (!old) return old;
        return old.filter((t) => t.id !== id);
      });
      toast.success('Mall raderad');
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error deleting template:', error);
      toast.error('Kunde inte radera mall');
    },
  });

  // Reorder templates mutation
  const reorderTemplatesMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const data = await api.reorderTemplates(ids);
      return data.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        titleTemplate: t.title_template,
        descriptionTemplate: t.description_template,
        priority: t.priority as Template['priority'],
        category: t.category_id,
        notesTemplate: t.notes_template,
        solutionTemplate: t.solution_template,
        position: t.position,
        createdBy: t.created_by,
        createdAt: new Date(t.created_at),
        updatedAt: new Date(t.updated_at),
      }));
    },
    onSuccess: (newTemplates) => {
      queryClient.setQueryData(templateKeys.list(), newTemplates);
      toast.success('Mallar omordnade');
    },
    onError: () => {
      toast.error('Kunde inte omordna mallar');
    },
  });

  const addTemplate = useCallback(
    async (template: Omit<Template, 'id' | 'position' | 'createdBy' | 'createdAt' | 'updatedAt'>) => {
      try {
        return await addTemplateMutation.mutateAsync(template);
      } catch (error) {
        return null;
      }
    },
    [addTemplateMutation]
  );

  const updateTemplate = useCallback(
    async (id: string, updates: Partial<Template>) => {
      await updateTemplateMutation.mutateAsync({ id, updates });
    },
    [updateTemplateMutation]
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      await deleteTemplateMutation.mutateAsync(id);
    },
    [deleteTemplateMutation]
  );

  const reorderTemplates = useCallback(
    async (ids: string[]) => {
      await reorderTemplatesMutation.mutateAsync(ids);
    },
    [reorderTemplatesMutation]
  );

  const getTemplateById = useCallback((id: string) => templates.find((t) => t.id === id), [templates]);

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: templateKeys.list() });
  }, [queryClient]);

  return {
    templates,
    isLoading,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    reorderTemplates,
    getTemplateById,
    refetch,
  };
};
