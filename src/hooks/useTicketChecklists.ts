import { useState, useCallback } from 'react';
import { api, ChecklistRow } from '@/lib/api';
import { checklistItemSchema, getValidationError } from '@/lib/validations';
import { toast } from 'sonner';

export interface ChecklistItem { id: string; ticket_id: string; label: string; completed: boolean; position: number; created_at: string; updated_at: string; }

export const useTicketChecklists = (ticketId?: string) => {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchChecklists = useCallback(async (id?: string) => {
    const targetId = id || ticketId;
    if (!targetId) return;
    setIsLoading(true);
    try {
      const data = await api.getChecklists(targetId);
      setItems(data as ChecklistItem[]);
    } catch (error) { if (import.meta.env.DEV) console.error('Error fetching checklists:', error); }
    finally { setIsLoading(false); }
  }, [ticketId]);

  const addChecklistItem = useCallback(async (targetTicketId: string, label: string) => {
    const validation = checklistItemSchema.safeParse({ label });
    if (!validation.success) { toast.error(getValidationError(validation.error) || 'Invalid checklist item'); return null; }
    try {
      const data = await api.createChecklistItem(targetTicketId, validation.data.label);
      setItems(prev => [...prev, data as ChecklistItem]);
      return data;
    } catch (error) { toast.error('Failed to add checklist item'); return null; }
  }, []);

  const updateChecklistItem = useCallback(async (id: string, updates: Partial<Pick<ChecklistItem, 'label' | 'completed'>>) => {
    try { await api.updateChecklistItem(id, updates); setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item)); }
    catch (error) { if (import.meta.env.DEV) console.error('Error updating checklist item:', error); }
  }, []);

  const deleteChecklistItem = useCallback(async (id: string) => {
    try { await api.deleteChecklistItem(id); setItems(prev => prev.filter(item => item.id !== id)); }
    catch (error) { if (import.meta.env.DEV) console.error('Error deleting checklist item:', error); }
  }, []);

  const bulkAddChecklistItems = useCallback(async (targetTicketId: string, labels: string[]) => {
    if (labels.length === 0) return [];
    try { return await api.bulkCreateChecklistItems(targetTicketId, labels) as ChecklistItem[]; }
    catch (error) { toast.error('Failed to add checklist items'); return []; }
  }, []);

  return { items, isLoading, fetchChecklists, addChecklistItem, updateChecklistItem, deleteChecklistItem, bulkAddChecklistItems, setItems };
};
