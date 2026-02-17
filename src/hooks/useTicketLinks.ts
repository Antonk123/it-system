import { useState, useEffect, useCallback } from 'react';
import { api, TicketLinkRow } from '@/lib/api';
import { TicketLink } from '@/types/ticket';

export const useTicketLinks = (ticketId: string) => {
  const [links, setLinks] = useState<TicketLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLinks = useCallback(async () => {
    if (!ticketId) return;

    setIsLoading(true);
    try {
      const data = await api.getTicketLinks(ticketId) as TicketLinkRow[];
      const mapped: TicketLink[] = data.map((link) => ({
        id: link.id,
        sourceTicketId: link.sourceTicketId,
        targetTicketId: link.targetTicketId,
        linkType: link.linkType as 'related',
        createdBy: link.createdBy,
        createdAt: new Date(link.createdAt),
        linkedTicket: {
          id: link.linkedTicket.id,
          title: link.linkedTicket.title,
          status: link.linkedTicket.status as any,
          priority: link.linkedTicket.priority as any,
          createdAt: new Date(link.linkedTicket.created_at),
        },
      }));
      setLinks(mapped);
    } catch (error) {
      console.error('Error fetching ticket links:', error);
    } finally {
      setIsLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const addLink = useCallback(async (targetTicketId: string, linkType: string = 'related') => {
    try {
      const data = await api.createTicketLink(ticketId, targetTicketId, linkType) as TicketLinkRow;
      const newLink: TicketLink = {
        id: data.id,
        sourceTicketId: data.sourceTicketId,
        targetTicketId: data.targetTicketId,
        linkType: data.linkType as 'related',
        createdBy: data.createdBy,
        createdAt: new Date(data.createdAt),
        linkedTicket: {
          id: data.linkedTicket.id,
          title: data.linkedTicket.title,
          status: data.linkedTicket.status as any,
          priority: data.linkedTicket.priority as any,
          createdAt: new Date(data.linkedTicket.created_at),
        },
      };
      setLinks((prev) => [newLink, ...prev]);
      return newLink;
    } catch (error) {
      console.error('Error adding ticket link:', error);
      throw error;
    }
  }, [ticketId]);

  const deleteLink = useCallback(async (linkId: string) => {
    try {
      await api.deleteTicketLink(linkId);
      setLinks((prev) => prev.filter((link) => link.id !== linkId));
    } catch (error) {
      console.error('Error deleting ticket link:', error);
      throw error;
    }
  }, []);

  return { links, isLoading, addLink, deleteLink, refetch: fetchLinks };
};
