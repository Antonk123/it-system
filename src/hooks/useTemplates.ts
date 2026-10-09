import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, TemplateRow } from '@/lib/api';
import { Template, TemplateFieldRow } from '@/types/ticket';
import { templateSchema, templateUpdateSchema, getValidationError } from '@/lib/validations';
import { parseServerDate } from '@/lib/date';
import { safeJsonParse } from '@/lib/safeJsonParse';
import { toast } from 'sonner';

// Query keys for React Query
export const templateKeys = {
  all: ['templates'] as const,
  lists: () => [...templateKeys.all, 'list'] as const,
  list: () => [...templateKeys.lists()] as const,
};

export const mapTemplate = (t: TemplateRow): Template => ({
  id: t.id,
  name: t.name,
  description: t.description,
  type: (t.template_type as 'standard' | 'dynamic') || 'standard',
  titleTemplate: t.title_template,
  descriptionTemplate: t.description_template,
  priority: t.priority as Template['priority'],
  category: t.category_id,
  notesTemplate: t.notes_template,
  solutionTemplate: t.solution_template,
  position: t.position,
  createdBy: t.created_by,
  createdAt: parseServerDate(t.created_at),
  updatedAt: parseServerDate(t.updated_at),
  fields: (t.fields as TemplateFieldRow[] | undefined) || [],
});

type TemplateFieldInput = Parameters<typeof api.createTemplateField>[1];
type TemplateFieldUpdate = Parameters<typeof api.updateTemplateField>[2];

// Servern svarar på engelska vid namnkrock — översätt det vanliga fallet.
const templateErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.includes('already exists')
    ? 'En mall med det namnet finns redan'
    : fallback;

export const useTemplates = () => {
  const queryClient = useQueryClient();

  // Fetch templates with React Query
  const { data: templates = [], isLoading, isError } = useQuery({
    queryKey: templateKeys.list(),
    queryFn: async () => (await api.getTemplates()).map(mapTemplate),
    staleTime: 1000 * 60 * 10, // Templates rarely change, cache for 10 minutes
  });

  // Add template mutation
  const addTemplateMutation = useMutation({
    mutationFn: async (template: Omit<Template, 'id' | 'position' | 'createdBy' | 'createdAt' | 'updatedAt'>) => {
      const validation = templateSchema.safeParse(template);
      if (!validation.success) {
        throw new Error(getValidationError(validation.error) || 'Invalid template data');
      }
      // Fält skickas med i samma anrop — servern skapar mall och fält i en transaktion.
      const data = await api.createTemplate({
        name: validation.data.name,
        description: validation.data.description || null,
        template_type: validation.data.type || 'standard',
        title_template: validation.data.titleTemplate,
        description_template: validation.data.descriptionTemplate,
        priority: validation.data.priority,
        category_id: validation.data.category || null,
        notes_template: validation.data.notesTemplate || null,
        solution_template: validation.data.solutionTemplate || null,
        fields: template.fields?.map((field) => ({
          field_name: field.field_name,
          field_label: field.field_label,
          field_type: field.field_type,
          placeholder: field.placeholder,
          default_value: field.default_value,
          required: field.required,
          options: safeJsonParse<string[] | undefined>(field.options, undefined),
        })),
      });
      return mapTemplate(data);
    },
    onSuccess: (newTemplate) => {
      queryClient.setQueryData(templateKeys.list(), (old: Template[] | undefined) => {
        if (!old) return [newTemplate];
        return [...old, newTemplate].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      });
      toast.success('Mall skapad');
    },
    onError: (error) => {
      toast.error(templateErrorMessage(error, 'Kunde inte skapa mall'));
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
      if (validation.data.type !== undefined) apiUpdates.template_type = validation.data.type;
      if (validation.data.titleTemplate !== undefined) apiUpdates.title_template = validation.data.titleTemplate;
      if (validation.data.descriptionTemplate !== undefined) apiUpdates.description_template = validation.data.descriptionTemplate;
      if (validation.data.priority !== undefined) apiUpdates.priority = validation.data.priority;
      if (validation.data.category !== undefined) apiUpdates.category_id = validation.data.category;
      if (validation.data.notesTemplate !== undefined) apiUpdates.notes_template = validation.data.notesTemplate;
      if (validation.data.solutionTemplate !== undefined) apiUpdates.solution_template = validation.data.solutionTemplate;

      return mapTemplate(await api.updateTemplate(id, apiUpdates));
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(templateKeys.list(), (old: Template[] | undefined) => {
        if (!old) return old;
        return old.map((t) => (t.id === updated.id ? updated : t));
      });
      toast.success('Mall uppdaterad');
    },
    onError: (error) => {
      toast.error(templateErrorMessage(error, 'Kunde inte uppdatera mall'));
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
    mutationFn: async (ids: string[]) => (await api.reorderTemplates(ids)).map(mapTemplate),
    onSuccess: (reordered) => {
      // Omordningssvaret saknar fält — behåll de redan hämtade.
      queryClient.setQueryData(templateKeys.list(), (old: Template[] | undefined) => {
        const previous = new Map((old ?? []).map((t) => [t.id, t]));
        return reordered.map((t) => ({ ...t, fields: previous.get(t.id)?.fields ?? [] }));
      });
      toast.success('Mallar omordnade');
    },
    onError: () => {
      toast.error('Kunde inte omordna mallar');
    },
  });

  // Fältoperationer: listan innehåller mallarnas fält, så varje lyckad
  // ändring invalideras mall-listan. Fel visas som toast och ger null/false.
  const invalidateTemplates = () => queryClient.invalidateQueries({ queryKey: templateKeys.list() });

  const createFieldMutation = useMutation({
    mutationFn: ({ templateId, data }: { templateId: string; data: TemplateFieldInput }) =>
      api.createTemplateField(templateId, data),
    onSuccess: invalidateTemplates,
    onError: () => toast.error('Kunde inte lägga till fält'),
  });

  const updateFieldMutation = useMutation({
    mutationFn: ({ templateId, fieldId, data }: { templateId: string; fieldId: string; data: TemplateFieldUpdate }) =>
      api.updateTemplateField(templateId, fieldId, data),
    onSuccess: invalidateTemplates,
    onError: () => toast.error('Kunde inte uppdatera fält'),
  });

  const deleteFieldMutation = useMutation({
    mutationFn: ({ templateId, fieldId }: { templateId: string; fieldId: string }) =>
      api.deleteTemplateField(templateId, fieldId),
    onSuccess: invalidateTemplates,
    onError: () => toast.error('Kunde inte ta bort fält'),
  });

  const reorderFieldsMutation = useMutation({
    mutationFn: ({ templateId, ids }: { templateId: string; ids: string[] }) =>
      api.reorderTemplateFields(templateId, ids),
    onSuccess: invalidateTemplates,
    onError: () => toast.error('Kunde inte omordna fält'),
  });

  const createTemplateField = useCallback(
    async (templateId: string, data: TemplateFieldInput) => {
      try { return await createFieldMutation.mutateAsync({ templateId, data }); } catch { return null; }
    },
    [createFieldMutation]
  );

  const updateTemplateField = useCallback(
    async (templateId: string, fieldId: string, data: TemplateFieldUpdate) => {
      try { return await updateFieldMutation.mutateAsync({ templateId, fieldId, data }); } catch { return null; }
    },
    [updateFieldMutation]
  );

  const deleteTemplateField = useCallback(
    async (templateId: string, fieldId: string) => {
      try { await deleteFieldMutation.mutateAsync({ templateId, fieldId }); return true; } catch { return false; }
    },
    [deleteFieldMutation]
  );

  const reorderTemplateFields = useCallback(
    async (templateId: string, ids: string[]) => {
      try { await reorderFieldsMutation.mutateAsync({ templateId, ids }); return true; } catch { return false; }
    },
    [reorderFieldsMutation]
  );

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

  // Fel visas redan som toast i mutationens onError — svälj här så att
  // anrop som inte awaitas (flytta upp/ned) inte ger unhandled rejections.
  const reorderTemplates = useCallback(
    async (ids: string[]) => {
      try {
        await reorderTemplatesMutation.mutateAsync(ids);
      } catch {
        // visas via onError
      }
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
    isError,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    reorderTemplates,
    createTemplateField,
    updateTemplateField,
    deleteTemplateField,
    reorderTemplateFields,
    getTemplateById,
    refetch,
  };
};
