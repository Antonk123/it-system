import { useState, useCallback } from 'react';
import { api, ChecklistTemplate } from '@/lib/api';
import { toast } from 'sonner';

export const useChecklistTemplates = () => {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getChecklistTemplates();
      setTemplates(data);
    } catch {
      toast.error('Kunde inte hämta checklistmallar');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createTemplate = useCallback(async (data: {
    name: string;
    description?: string;
    items: { label: string; parent_label?: string }[];
  }) => {
    try {
      const t = await api.createChecklistTemplate(data);
      setTemplates(prev => [...prev, t]);
      toast.success('Mall skapad');
      return t;
    } catch (e: any) {
      toast.error(
        e.message?.includes('already exists')
          ? 'En mall med det namnet finns redan'
          : 'Kunde inte skapa mall'
      );
      return null;
    }
  }, []);

  const updateTemplate = useCallback(async (
    id: string,
    data: { name?: string; description?: string; items?: { label: string; parent_label?: string }[] }
  ) => {
    try {
      const t = await api.updateChecklistTemplate(id, data);
      setTemplates(prev => prev.map(x => x.id === id ? t : x));
      toast.success('Mall uppdaterad');
      return t;
    } catch {
      toast.error('Kunde inte uppdatera mall');
      return null;
    }
  }, []);

  const deleteTemplate = useCallback(async (id: string) => {
    try {
      await api.deleteChecklistTemplate(id);
      setTemplates(prev => prev.filter(x => x.id !== id));
      toast.success('Mall borttagen');
    } catch {
      toast.error('Kunde inte ta bort mall');
    }
  }, []);

  const applyTemplate = useCallback(async (templateId: string, ticketId: string) => {
    try {
      const items = await api.applyChecklistTemplate(templateId, ticketId);
      toast.success('Mall applicerad');
      return items;
    } catch {
      toast.error('Kunde inte applicera mall');
      return null;
    }
  }, []);

  return { templates, isLoading, fetchTemplates, createTemplate, updateTemplate, deleteTemplate, applyTemplate };
};
