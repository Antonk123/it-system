import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface RecurringTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category_id: string | null;
  tags: string[];
  interval_type: 'daily' | 'weekly' | 'monthly';
  interval_day: number | null;
  is_active: number; // 0 or 1 (SQLite integer boolean)
  last_run: string | null;
  next_run: string;
  created_at: string;
  updated_at: string;
  history: Array<{
    id: string;
    ticket_id: string;
    created_at: string;
    ticket_title: string;
  }>;
}

export type CreateTemplateInput = {
  name: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category_id: string | null;
  tags: string[];
  interval_type: 'daily' | 'weekly' | 'monthly';
  interval_day: number | null;
};

export const recurringKeys = {
  all: ['recurring'] as const,
  list: () => [...recurringKeys.all, 'list'] as const,
};

export function useRecurringTemplates() {
  const queryClient = useQueryClient();

  const templates = useQuery({
    queryKey: recurringKeys.list(),
    queryFn: () => api.request<RecurringTemplate[]>('/recurring'),
  });

  const createTemplate = useMutation({
    mutationFn: (data: CreateTemplateInput) =>
      api.request<RecurringTemplate>('/recurring', { method: 'POST', body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast.success('Återkommande schema skapat');
    },
    onError: () => toast.error('Något gick fel'),
  });

  const updateTemplate = useMutation({
    mutationFn: ({ id, ...data }: CreateTemplateInput & { id: string }) =>
      api.request<RecurringTemplate>('/recurring/' + id, { method: 'PUT', body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast.success('Schema uppdaterat');
    },
    onError: () => toast.error('Något gick fel'),
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: string) =>
      api.request<void>('/recurring/' + id, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast.success('Schema borttaget');
    },
    onError: () => toast.error('Något gick fel'),
  });

  const toggleTemplate = useMutation({
    mutationFn: (id: string) =>
      api.request<{ id: string; is_active: number; next_run: string }>(
        '/recurring/' + id + '/toggle',
        { method: 'PATCH' }
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast.success(data.is_active ? 'Schema aktiverat' : 'Schema pausat');
    },
    onError: () => toast.error('Något gick fel'),
  });

  return {
    templates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    toggleTemplate,
  };
}
