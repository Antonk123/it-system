import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, CustomFieldInput } from '@/lib/api';
import { Ticket, TicketStatus, TicketPriority } from '@/types/ticket';
import { ticketInsertSchema, ticketUpdateSchema, getValidationError } from '@/lib/validations';
import { toast } from 'sonner';

interface UseTicketsOptions {
  page?: number;
  limit?: number;
  status?: TicketStatus | 'all';
  priority?: TicketPriority | 'all';
  category?: string | 'all';
  search?: string;
  tags?: string;
  tagMode?: 'or' | 'and';
  dateFrom?: string;
  dateTo?: string;
  dateField?: 'created_at' | 'updated_at' | 'closed_at';
  checklist?: string;
  sortBy?: 'createdAt' | 'status' | 'priority' | 'category' | 'tags';
  sortDir?: 'asc' | 'desc';
  company_id?: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Query keys for React Query
export const ticketKeys = {
  all: ['tickets'] as const,
  lists: () => [...ticketKeys.all, 'list'] as const,
  list: (filters: UseTicketsOptions) => [...ticketKeys.lists(), filters] as const,
  details: () => [...ticketKeys.all, 'detail'] as const,
  detail: (id: string) => [...ticketKeys.details(), id] as const,
};

export const useTickets = (options?: UseTicketsOptions) => {
  const queryClient = useQueryClient();

  // Build query string
  const buildQueryString = useCallback((opts?: UseTicketsOptions) => {
    if (!opts) return '';
    const params = new URLSearchParams();
    if (opts.page) params.append('page', String(opts.page));
    if (opts.limit) params.append('limit', String(opts.limit));
    if (opts.status) params.append('status', opts.status);
    if (opts.priority && opts.priority !== 'all') params.append('priority', opts.priority);
    if (opts.category && opts.category !== 'all') params.append('category', opts.category);
    if (opts.search) params.append('search', opts.search);
    if (opts.tags) params.append('tags', opts.tags);
    if (opts.tagMode && opts.tagMode !== 'or') params.append('tagMode', opts.tagMode);
    if (opts.dateFrom) params.append('dateFrom', opts.dateFrom);
    if (opts.dateTo) params.append('dateTo', opts.dateTo);
    if (opts.dateField && opts.dateField !== 'created_at') params.append('dateField', opts.dateField);
    if (opts.checklist) params.append('checklist', opts.checklist);
    if (opts.sortBy) params.append('sortBy', opts.sortBy);
    if (opts.sortDir) params.append('sortDir', opts.sortDir);
    if (opts.company_id && opts.company_id !== 'all') params.append('company_id', opts.company_id);
    return params.toString() ? `?${params.toString()}` : '';
  }, []);

  // Fetch tickets with React Query (with caching for performance)
  const { data: queryData, isLoading } = useQuery({
    queryKey: ticketKeys.list(options || {}),
    staleTime: 1000 * 60 * 2, // Consider data fresh for 2 minutes
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes (formerly cacheTime)
    queryFn: async () => {
      const queryString = buildQueryString(options);
      const response = await api.getTickets(queryString);

      // Check response format
      if (Array.isArray(response)) {
        // Legacy format (no pagination)
        const mapped: Ticket[] = response.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: t.status as TicketStatus,
          priority: t.priority as TicketPriority,
          category: t.category_id || undefined,
          requesterId: t.requester_id || '',
          createdAt: new Date(t.created_at),
          updatedAt: new Date(t.updated_at),
          resolvedAt: t.resolved_at ? new Date(t.resolved_at) : undefined,
          closedAt: t.closed_at ? new Date(t.closed_at) : undefined,
          notes: t.notes || undefined,
          solution: t.solution || undefined,
          templateId: t.template_id || undefined,
          tags: (t.tags || []) as any,
          sla_response_deadline: t.sla_response_deadline ?? null,
          sla_resolution_deadline: t.sla_resolution_deadline ?? null,
          sla_paused_at: t.sla_paused_at ?? null,
          sla_paused_duration: t.sla_paused_duration ?? 0,
          sla_response_met: t.sla_response_met ?? null,
          sla_resolution_met: t.sla_resolution_met ?? null,
          ai_suggested_category_id: t.ai_suggested_category_id ?? null,
          ai_suggested_confidence: t.ai_suggested_confidence ?? null,
        }));
        return { tickets: mapped, pagination: null };
      } else {
        // Paginated format
        const mapped: Ticket[] = response.data.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: t.status as TicketStatus,
          priority: t.priority as TicketPriority,
          category: t.category_id || undefined,
          requesterId: t.requester_id || '',
          createdAt: new Date(t.created_at),
          updatedAt: new Date(t.updated_at),
          resolvedAt: t.resolved_at ? new Date(t.resolved_at) : undefined,
          closedAt: t.closed_at ? new Date(t.closed_at) : undefined,
          notes: t.notes || undefined,
          solution: t.solution || undefined,
          templateId: t.template_id || undefined,
          tags: (t.tags || []) as any,
          sla_response_deadline: t.sla_response_deadline ?? null,
          sla_resolution_deadline: t.sla_resolution_deadline ?? null,
          sla_paused_at: t.sla_paused_at ?? null,
          sla_paused_duration: t.sla_paused_duration ?? 0,
          sla_response_met: t.sla_response_met ?? null,
          sla_resolution_met: t.sla_resolution_met ?? null,
          ai_suggested_category_id: t.ai_suggested_category_id ?? null,
          ai_suggested_confidence: t.ai_suggested_confidence ?? null,
        }));
        return { tickets: mapped, pagination: response.pagination };
      }
    },
  });

  const tickets = useMemo(() => queryData?.tickets ?? [], [queryData?.tickets]);
  const pagination = queryData?.pagination || null;

  // Add ticket mutation
  const addTicketMutation = useMutation({
    mutationFn: async (ticket: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'> & { customFields?: CustomFieldInput[]; assigned_to?: string; company_id?: string }) => {
      const { customFields, templateId, assigned_to, company_id, ...ticketData } = ticket;
      const validation = ticketInsertSchema.safeParse(ticketData);
      if (!validation.success) {
        const errorMsg = getValidationError(validation.error);
        throw new Error(errorMsg || 'Invalid ticket data');
      }

      const data = await api.createTicket({
        title: validation.data.title,
        description: validation.data.description,
        status: validation.data.status,
        priority: validation.data.priority,
        // "none" means no category
        category_id: validation.data.category === 'none' ? null : (validation.data.category || null),
        requester_id: validation.data.requesterId || null,
        notes: validation.data.notes || null,
        solution: validation.data.solution || null,
        customFields: customFields,
        template_id: templateId || null,
        assigned_to: assigned_to || null,
        company_id: company_id || null,
      });

      if (data.warnings) {
        data.warnings.forEach((w: string) => toast.warning(w));
      }

      return {
        id: data.id,
        title: data.title,
        description: data.description,
        status: data.status as TicketStatus,
        priority: data.priority as TicketPriority,
        category: data.category_id || undefined,
        requesterId: data.requester_id || '',
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
        notes: data.notes || undefined,
        solution: data.solution || undefined,
      };
    },
    onSuccess: () => {
      // Invalidate all ticket queries to refetch
      queryClient.invalidateQueries({ queryKey: ticketKeys.lists() });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create ticket');
    },
  });

  // Update ticket mutation
  const updateTicketMutation = useMutation({
    mutationFn: async ({ id, updates, customFields, tagIds }: { id: string; updates: Partial<Ticket> & { tag_ids?: string[] }; customFields?: CustomFieldInput[]; tagIds?: string[] }) => {
      const validation = ticketUpdateSchema.safeParse(updates);
      if (!validation.success) {
        const errorMsg = getValidationError(validation.error);
        throw new Error(errorMsg || 'Invalid ticket data');
      }

      const validated = validation.data;
      const updateData: Record<string, unknown> = {};

      if (validated.title !== undefined) updateData.title = validated.title;
      if (validated.description !== undefined) updateData.description = validated.description;
      if (validated.status !== undefined) updateData.status = validated.status;
      if (validated.priority !== undefined) updateData.priority = validated.priority;
      // Handle "none" as "no category"
      if (validated.category !== undefined) updateData.category_id = validated.category === 'none' ? null : validated.category;
      if (validated.requesterId !== undefined) updateData.requester_id = validated.requesterId || null;
      if (validated.notes !== undefined) updateData.notes = validated.notes || null;
      if (validated.solution !== undefined) updateData.solution = validated.solution || null;
      if ((updates as any).assigned_to !== undefined) updateData.assigned_to = (updates as any).assigned_to || null;
      if ((updates as any).company_id !== undefined) updateData.company_id = (updates as any).company_id || null;

      // Handle tags
      if (tagIds !== undefined || updates.tag_ids !== undefined) {
        updateData.tag_ids = tagIds || updates.tag_ids || [];
      }

      const updateResult = await api.updateTicket(id, { ...(updateData as any), customFields: customFields || undefined });

      if (updateResult?.warnings) {
        updateResult.warnings.forEach((w: string) => toast.warning(w));
      }

      // Fetch fresh data from server
      const freshTicket = await api.getTicket(id);
      return {
        id: freshTicket.id,
        title: freshTicket.title,
        description: freshTicket.description,
        status: freshTicket.status as TicketStatus,
        priority: freshTicket.priority as TicketPriority,
        requesterId: freshTicket.requester_id || '',
        category: freshTicket.category_id || undefined,
        notes: freshTicket.notes || undefined,
        solution: freshTicket.solution || undefined,
        createdAt: new Date(freshTicket.created_at),
        updatedAt: new Date(freshTicket.updated_at),
        resolvedAt: freshTicket.resolved_at ? new Date(freshTicket.resolved_at) : undefined,
        closedAt: freshTicket.closed_at ? new Date(freshTicket.closed_at) : undefined,
        tags: (freshTicket as any).tags || [],
        sla_response_deadline: freshTicket.sla_response_deadline ?? null,
        sla_resolution_deadline: freshTicket.sla_resolution_deadline ?? null,
        sla_paused_at: freshTicket.sla_paused_at ?? null,
        sla_paused_duration: freshTicket.sla_paused_duration ?? 0,
        sla_response_met: freshTicket.sla_response_met ?? null,
        sla_resolution_met: freshTicket.sla_resolution_met ?? null,
      };
    },
    onMutate: async ({ id, updates, customFields: _cf }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ticketKeys.lists() });

      // Snapshot the previous value
      const previousTickets = queryClient.getQueryData(ticketKeys.list(options || {}));

      // Optimistically update to the new value
      queryClient.setQueryData(ticketKeys.list(options || {}), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          tickets: old.tickets.map((t: Ticket) => {
            if (t.id === id) {
              return {
                ...t,
                ...updates,
                // Handle category "none" value
                category: updates.category === 'none' ? undefined : (updates.category !== undefined ? updates.category : t.category),
              };
            }
            return t;
          }),
        };
      });

      return { previousTickets };
    },
    onError: (error: Error, _variables, context) => {
      // Rollback on error
      if (context?.previousTickets) {
        queryClient.setQueryData(ticketKeys.list(options || {}), context.previousTickets);
      }
      toast.error(error.message || 'Failed to update ticket');
    },
    onSuccess: () => {
      // Invalidate to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ticketKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ticketKeys.details() });
    },
  });

  // Bulk update tickets mutation
  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, updates }: { ids: string[]; updates: { status?: string; priority?: string; category_id?: string | null } }) => {
      return await api.bulkUpdateTickets(ids, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.lists() });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to bulk update tickets');
    },
  });

  // Delete ticket mutation
  const deleteTicketMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.deleteTicket(id);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.lists() });
    },
    onError: (error: Error) => {
      if (import.meta.env.DEV) console.error('Error deleting ticket:', error);
    },
  });

  const addTicket = useCallback(
    async (ticket: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'> & { assigned_to?: string; company_id?: string }, customFields?: CustomFieldInput[]) => {
      // Let the mutation handle errors (it shows toast on error)
      // Don't silently swallow errors by returning null
      return await addTicketMutation.mutateAsync({ ...ticket, customFields });
    },
    [addTicketMutation]
  );

  const updateTicket = useCallback(
    async (id: string, updates: Partial<Ticket>, customFields?: CustomFieldInput[]) => {
      await updateTicketMutation.mutateAsync({ id, updates, customFields });
    },
    [updateTicketMutation]
  );

  const deleteTicket = useCallback(
    async (id: string) => {
      await deleteTicketMutation.mutateAsync(id);
    },
    [deleteTicketMutation]
  );

  const bulkUpdateTickets = useCallback(
    async (ids: string[], updates: { status?: string; priority?: string; category_id?: string | null }) => {
      return await bulkUpdateMutation.mutateAsync({ ids, updates });
    },
    [bulkUpdateMutation]
  );

  const getTicketById = useCallback(
    (id: string) => tickets.find((t) => t.id === id),
    [tickets]
  );

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ticketKeys.lists() });
  }, [queryClient]);

  return {
    tickets,
    pagination,
    isLoading,
    addTicket,
    updateTicket,
    deleteTicket,
    bulkUpdateTickets,
    getTicketById,
    refetch,
  };
};
