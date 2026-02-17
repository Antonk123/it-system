import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const useTicketSharing = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const getExistingShare = useCallback(async (ticketId: string) => {
    try { const { share_token } = await api.getShareToken(ticketId); return share_token; }
    catch (error) { console.error('Error fetching existing share:', error); return null; }
  }, []);

  const createShareLink = useCallback(async (ticketId: string): Promise<string | null> => {
    setIsLoading(true);
    try {
      const { share_token } = await api.createShareToken(ticketId);
      const url = `${window.location.origin}/shared/${share_token}`;
      setShareUrl(url);
      return url;
    } catch (error) { toast.error('Kunde inte skapa delningslänk'); return null; }
    finally { setIsLoading(false); }
  }, []);

  const deleteShareLink = useCallback(async (ticketId: string): Promise<boolean> => {
    setIsLoading(true);
    try { await api.deleteShareToken(ticketId); setShareUrl(null); toast.success('Delningslänk borttagen'); return true; }
    catch (error) { toast.error('Kunde inte ta bort delningslänk'); return false; }
    finally { setIsLoading(false); }
  }, []);

  const copyToClipboard = useCallback(async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success('Länk kopierad till urklipp'); }
    catch (error) { toast.error('Kunde inte kopiera länk'); }
  }, []);

  return { isLoading, shareUrl, createShareLink, deleteShareLink, getExistingShare, copyToClipboard, setShareUrl };
};
