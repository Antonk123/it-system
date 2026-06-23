import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, TicketLinkRow } from '@/lib/api';
import { TicketLink } from '@/types/ticket';
import { parseServerDate } from '@/lib/date';

// Query-key factory — invalidate the SPECIFIC ticket(id) key rather than a
// generic ['ticket-links'] prefix, avoiding matches against unrelated queries.
export const ticketLinkKeys = {
  all: ['ticket-links'] as const,
  ticket: (id: string) => ['ticket-links', id] as const,
};

const mapLink = (link: TicketLinkRow): TicketLink => ({
  id: link.id,
  sourceTicketId: link.sourceTicketId,
  targetTicketId: link.targetTicketId,
  linkType: link.linkType as 'related',
  createdBy: link.createdBy,
  createdAt: parseServerDate(link.createdAt),
  linkedTicket: {
    id: link.linkedTicket.id,
    title: link.linkedTicket.title,
    status: link.linkedTicket.status as any,
    priority: link.linkedTicket.priority as any,
    createdAt: parseServerDate(link.linkedTicket.created_at),
  },
});

export const useTicketLinks = (ticketId: string) => {
  const queryClient = useQueryClient();
  const queryKey = ticketLinkKeys.ticket(ticketId);

  const { data: links = [], isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await api.getTicketLinks(ticketId) as TicketLinkRow[];
      return data.map(mapLink);
    },
    enabled: Boolean(ticketId),
  });

  const addLinkMutation = useMutation({
    mutationFn: async ({ targetTicketId, linkType }: { targetTicketId: string; linkType: string }) => {
      const data = await api.createTicketLink(ticketId, targetTicketId, linkType) as TicketLinkRow;
      return mapLink(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error adding ticket link:', error);
    },
  });

  const deleteLinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      await api.deleteTicketLink(linkId);
      return linkId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error deleting ticket link:', error);
    },
  });

  const addLink = useCallback(async (targetTicketId: string, linkType: string = 'related') => {
    return addLinkMutation.mutateAsync({ targetTicketId, linkType });
  }, [addLinkMutation]);

  const deleteLink = useCallback(async (linkId: string) => {
    await deleteLinkMutation.mutateAsync(linkId);
  }, [deleteLinkMutation]);

  return {
    links,
    isLoading,
    isError,
    addLink,
    deleteLink,
    refetch: () => refetch(),
  };
};
