import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, CustomFieldInput, TicketRow } from '@/lib/api';
import { Ticket, TicketStatus, TicketPriority } from '@/types/ticket';
import { ticketInsertSchema, ticketUpdateSchema, getValidationError } from '@/lib/validations';
import { parseServerDate } from '@/lib/date';
import { mapTicketRow } from '@/lib/mapTicket';
import { toast } from 'sonner';

interface UseTicketsOptions {
  page?: number;
  limit?: number;
  status?: TicketStatus | 'all' | (string & {}); // tillåter komma-separerad multi-status, t.ex. "open,waiting"
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
  assigned_to?: string;
  requester_id?: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Apply a camelCase Partial<Ticket> patch onto a raw snake_case TicketRow.
// Lets the single-ticket detail cache be patched optimistically so the UI
// reflects a status/category/solution change instantly, instead of waiting for
// a network round-trip — the difference between "instant" and 30s on a slow
// VPN/5G link.
function applyOptimisticRow(row: TicketRow, updates: Partial<Ticket> & { tag_ids?: string[] }): TicketRow {
  const next = { ...row } as TicketRow & Record<string, unknown>;
  const u = updates as Partial<Ticket> & { assigned_to?: string | null; company_id?: string | null };
  if (u.title !== undefined) next.title = u.title;
  if (u.description !== undefined) next.description = u.description;
  if (u.status !== undefined) next.status = u.status;
  if (u.priority !== undefined) next.priority = u.priority;
  if (u.category !== undefined) next.category_id = u.category === 'none' ? null : u.category ?? null;
  if (u.requesterId !== undefined) next.requester_id = u.requesterId || null;
  if (u.notes !== undefined) next.notes = u.notes ?? null;
  if (u.solution !== undefined) next.solution = u.solution ?? null;
  if (u.assigned_to !== undefined) next.assigned_to = u.assigned_to || null;
  if (u.company_id !== undefined) next.company_id = u.company_id || null;
  return next;
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
    if (opts.assigned_to && opts.assigned_to !== 'all') params.append('assigned_to', opts.assigned_to);
    if (opts.requester_id && opts.requester_id !== 'all') params.append('requester_id', opts.requester_id);
    return params.toString() ? `?${params.toString()}` : '';
  }, []);

  // Fetch tickets with React Query (with caching for performance)
  const { data: queryData, isLoading, isError } = useQuery({
    queryKey: ticketKeys.list(options || {}),
    staleTime: 1000 * 60 * 2, // Consider data fresh for 2 minutes
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes (formerly cacheTime)
    queryFn: async () => {
      const queryString = buildQueryString(options);
      const response = await api.getTickets(queryString);

      // Check response format
      if (Array.isArray(response)) {
        // Legacy format (no pagination)
        const mapped: Ticket[] = response.map(mapTicketRow);
        return { tickets: mapped, pagination: null };
      } else {
        // Paginated format
        const mapped: Ticket[] = response.data.map(mapTicketRow);
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
        createdAt: parseServerDate(data.created_at),
        updatedAt: parseServerDate(data.updated_at),
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

      // Single round-trip: the PUT response IS the fresh ticket row (+ tags).
      // We deliberately no longer follow with a second GET /tickets/:id — that
      // doubled latency on slow links (VPN/5G) for every status/category/solution
      // change, since the detail page then also had to wait for a third refetch.
      const updated = await api.updateTicket(id, { ...(updateData as any), customFields: customFields || undefined }) as TicketRow & { warnings?: string[] };

      if (updated?.warnings) {
        updated.warnings.forEach((w: string) => toast.warning(w));
      }

      return { id, updated, hadCustomFields: !!(customFields && customFields.length > 0) };
    },
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing refetches för alla list-instanser och denna tickets detail.
      await queryClient.cancelQueries({ queryKey: ticketKeys.lists() });
      await queryClient.cancelQueries({ queryKey: ticketKeys.detail(id) });

      // Snapshot ALLA monterade list-cacher för rollback (inte bara den stängda nyckeln)
      const previousLists = queryClient.getQueriesData<unknown>({ queryKey: ticketKeys.lists() });
      const previousDetail = queryClient.getQueryData<TicketRow>(ticketKeys.detail(id));

      // Optimistisk list-uppdatering på ALLA monterade list-instanser (alla filtersvyer)
      queryClient.setQueriesData<unknown>(
        {
          predicate: (query) => {
            const key = query.queryKey;
            // Matcha alla nycklar med formen ['tickets', 'list', ...filters]
            return (
              Array.isArray(key) &&
              key[0] === 'tickets' &&
              key[1] === 'list'
            );
          },
        },
        (old: any) => {
          if (!old) return old;
          return {
            ...old,
            tickets: old.tickets.map((t: Ticket) => {
              if (t.id === id) {
                return {
                  ...t,
                  ...updates,
                  // Hantera category "none" → ingen kategori
                  category: updates.category === 'none' ? undefined : (updates.category !== undefined ? updates.category : t.category),
                };
              }
              return t;
            }),
          };
        }
      );

      // Optimistisk detail-uppdatering — TicketDetail läser från denna query,
      // utan detta såg användaren INGEN förändring förrän hela nätverksanropet var klart.
      queryClient.setQueryData<TicketRow | undefined>(ticketKeys.detail(id), (old) =>
        old ? applyOptimisticRow(old, updates) : old
      );

      return { previousLists, previousDetail, id };
    },
    onError: (error: Error, _variables, context) => {
      // Återställ ALLA list-cacher och detail-cachen vid fel
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      if (context?.id && context?.previousDetail !== undefined) {
        queryClient.setQueryData(ticketKeys.detail(context.id), context.previousDetail);
      }
      toast.error(error.message || 'Failed to update ticket');
    },
    onSuccess: ({ id, updated, hadCustomFields }) => {
      // Seed the detail cache with the authoritative row from the PUT response,
      // preserving field_values (the PUT response omits them). This reconciles
      // the optimistic state WITHOUT another network round-trip.
      queryClient.setQueryData<TicketRow>(ticketKeys.detail(id), (old) => ({
        ...(old as TicketRow),
        ...updated,
        field_values: (old as any)?.field_values ?? (updated as any).field_values ?? [],
      }));
      // Custom fields changed → field_values are stale; refetch the detail once.
      if (hadCustomFields) {
        queryClient.invalidateQueries({ queryKey: ticketKeys.detail(id) });
      }
    },
    onSettled: () => {
      // Mark all list views stale so every filter-view converges. Default
      // refetchType only refetches *active* (mounted) lists immediately —
      // inactive ones refetch lazily on next mount, so this doesn't spam the
      // network on a slow link. The optimistic update already gave instant UX.
      queryClient.invalidateQueries({ queryKey: ticketKeys.lists() });
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
    isError,
    addTicket,
    updateTicket,
    deleteTicket,
    bulkUpdateTickets,
    getTicketById,
    refetch,
  };
};
