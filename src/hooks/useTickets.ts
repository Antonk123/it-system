import { useCallback } from 'react';
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
  sortBy?: 'createdAt' | 'status' | 'priority' | 'category';
  sortDir?: 'asc' | 'desc';
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
    if (opts.status && opts.status !== 'all') params.append('status', opts.status);
    if (opts.priority && opts.priority !== 'all') params.append('priority', opts.priority);
    if (opts.category && opts.category !== 'all') params.append('category', opts.category);
    if (opts.search) params.append('search', opts.search);
    if (opts.sortBy) params.append('sortBy', opts.sortBy);
    if (opts.sortDir) params.append('sortDir', opts.sortDir);
    return params.toString() ? `?${params.toString()}` : '';
  }, []);

  // Fetch tickets with React Query
  const { data: queryData, isLoading } = useQuery({
    queryKey: ticketKeys.list(options || {}),
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
        }));
        return { tickets: mapped, pagination: response.pagination };
      }
    },
  });

  const tickets = queryData?.tickets || [];
  const pagination = queryData?.pagination || null;

  // Add ticket mutation
  const addTicketMutation = useMutation({
    mutationFn: async (ticket: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'> & { customFields?: CustomFieldInput[] }) => {
      const { customFields, templateId, ...ticketData } = ticket;
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
      });

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
    mutationFn: async ({ id, updates, customFields }: { id: string; updates: Partial<Ticket>; customFields?: CustomFieldInput[] }) => {
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

      await api.updateTicket(id, { ...(updateData as any), customFields: customFields || undefined });

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
    async (ticket: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'>, customFields?: CustomFieldInput[]) => {
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
    getTicketById,
    refetch,
  };
};
