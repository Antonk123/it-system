import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { fileUploadSchema, getValidationError } from '@/lib/validations';
import { toast } from 'sonner';

export interface TicketAttachment {
  id: string; ticketId: string; fileName: string; filePath: string; fileSize: number | null; fileType: string | null; createdAt: Date; url: string;
}

export const useTicketAttachments = (ticketId?: string) => {
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const fetchAttachments = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const data = await api.getAttachments(id);
      const mapped = data.map((a) => ({
        id: a.id, ticketId: a.ticket_id, fileName: a.file_name, filePath: a.file_path, fileSize: a.file_size, fileType: a.file_type, createdAt: new Date(a.created_at), url: a.url,
      }));
      setAttachments(mapped);
    } catch (error) { if (import.meta.env.DEV) console.error('Error fetching attachments:', error); }
    finally { setIsLoading(false); }
  }, []);

  const uploadAttachment = useCallback(async (ticketId: string, file: File) => {
    const validation = fileUploadSchema.safeParse({ file });
    if (!validation.success) { toast.error(getValidationError(validation.error) || 'Invalid file'); return null; }
    setIsUploading(true);
    try {
      const data = await api.uploadAttachment(ticketId, file);
      const newAttachment: TicketAttachment = { id: data.id, ticketId: data.ticket_id, fileName: data.file_name, filePath: data.file_path, fileSize: data.file_size, fileType: data.file_type, createdAt: new Date(data.created_at), url: data.url };
      setAttachments((prev) => [...prev, newAttachment]);
      return newAttachment;
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error uploading file:', error);
      toast.error(`Kunde inte ladda upp fil: ${file.name}`);
      return null;
    }
    finally { setIsUploading(false); }
  }, []);

  const deleteAttachment = useCallback(async (attachment: TicketAttachment) => {
    try { await api.deleteAttachment(attachment.id); setAttachments((prev) => prev.filter((a) => a.id !== attachment.id)); return true; }
    catch (error) { if (import.meta.env.DEV) console.error('Error deleting attachment:', error); return false; }
  }, []);

  return { attachments, isLoading, isUploading, fetchAttachments, uploadAttachment, deleteAttachment };
};
