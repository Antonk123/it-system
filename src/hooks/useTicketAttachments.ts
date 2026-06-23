import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fileUploadSchema, getValidationError } from '@/lib/validations';
import { parseServerDate } from '@/lib/date';
import { toast } from 'sonner';

export interface TicketAttachment {
  id: string; ticketId: string; fileName: string; filePath: string; fileSize: number | null; fileType: string | null; createdAt: Date; url: string;
}

// Query-key factory — invalidate the SPECIFIC ticket(id) key derived from the
// mutated attachment's own ticketId, never a generic ['attachments'] prefix nor
// a closure-captured (possibly stale) queryTicketId.
export const attachmentKeys = {
  all: ['attachments'] as const,
  ticket: (id: string) => ['attachments', id] as const,
};

const mapAttachment = (a: {
  id: string; ticket_id: string; file_name: string; file_path: string;
  file_size: number | null; file_type: string | null; created_at: string; url: string;
}): TicketAttachment => ({
  id: a.id, ticketId: a.ticket_id, fileName: a.file_name, filePath: a.file_path,
  fileSize: a.file_size, fileType: a.file_type, createdAt: parseServerDate(a.created_at), url: a.url,
});

export const useTicketAttachments = (initialTicketId?: string) => {
  const queryClient = useQueryClient();
  // Internal query ID — updated when fetchAttachments(id) is called
  const [queryTicketId, setQueryTicketId] = useState<string | undefined>(initialTicketId);
  const queryKey = queryTicketId ? attachmentKeys.ticket(queryTicketId) : attachmentKeys.all;

  const { data: attachments = [], isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await api.getAttachments(queryTicketId!);
      return (data as Parameters<typeof mapAttachment>[0][]).map(mapAttachment);
    },
    enabled: Boolean(queryTicketId),
  });

  // isUploading is tracked separately since upload is not part of the data query
  const [isUploading, setIsUploading] = useState(false);

  // fetchAttachments(id) — sets active ticket ID (triggers query) and refetches if same ID
  const fetchAttachments = useCallback(async (id: string) => {
    setQueryTicketId(id);
    await queryClient.invalidateQueries({ queryKey: attachmentKeys.ticket(id) });
  }, [queryClient]);

  const uploadMutation = useMutation({
    mutationFn: async ({ ticketId, file }: { ticketId: string; file: File }) => {
      const data = await api.uploadAttachment(ticketId, file);
      return mapAttachment(data as Parameters<typeof mapAttachment>[0]);
    },
    onSuccess: (_data, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: attachmentKeys.ticket(ticketId) });
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error uploading file:', error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ attachmentId }: { attachmentId: string; ticketId: string }) => {
      await api.deleteAttachment(attachmentId);
      return attachmentId;
    },
    onSuccess: (_data, { ticketId }) => {
      // Scope to the SPECIFIC ticket the attachment belonged to (carried through
      // the mutation variables), not a generic prefix nor a stale closure key —
      // correct even if the user switched tickets while delete was in-flight.
      queryClient.invalidateQueries({ queryKey: attachmentKeys.ticket(ticketId) });
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error deleting attachment:', error);
    },
  });

  const uploadAttachment = useCallback(async (ticketId: string, file: File): Promise<TicketAttachment | null> => {
    const validation = fileUploadSchema.safeParse({ file });
    if (!validation.success) { toast.error(getValidationError(validation.error) || 'Invalid file'); return null; }
    setIsUploading(true);
    try {
      return await uploadMutation.mutateAsync({ ticketId, file });
    } catch {
      toast.error(`Kunde inte ladda upp fil: ${file.name}`);
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [uploadMutation]);

  const deleteAttachment = useCallback(async (attachment: TicketAttachment): Promise<boolean> => {
    try {
      await deleteMutation.mutateAsync({ attachmentId: attachment.id, ticketId: attachment.ticketId });
      return true;
    } catch {
      return false;
    }
  }, [deleteMutation]);

  return { attachments, isLoading, isError, isUploading, fetchAttachments, uploadAttachment, deleteAttachment };
};
