import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const useTicketSharing = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [isError, setIsError] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const getExistingShare = useCallback(async (ticketId: string) => {
    try { const { share_token } = await api.getShareToken(ticketId); return share_token; }
    catch (error) { if (import.meta.env.DEV) console.error('Error fetching existing share:', error); return null; }
  }, []);

  const createShareLink = useCallback(async (ticketId: string): Promise<string | null> => {
    setIsLoading(true);
    setIsPending(true);
    setIsError(false);
    try {
      const { share_token } = await api.createShareToken(ticketId);
      const url = `${window.location.origin}/shared/${share_token}`;
      setShareUrl(url);
      return url;
    } catch (error) { toast.error('Kunde inte skapa delningslänk'); setIsError(true); return null; }
    finally { setIsLoading(false); setIsPending(false); }
  }, []);

  const deleteShareLink = useCallback(async (ticketId: string): Promise<boolean> => {
    setIsLoading(true);
    setIsPending(true);
    setIsError(false);
    try { await api.deleteShareToken(ticketId); setShareUrl(null); toast.success('Delningslänk borttagen'); return true; }
    catch (error) { toast.error('Kunde inte ta bort delningslänk'); setIsError(true); return false; }
    finally { setIsLoading(false); setIsPending(false); }
  }, []);

  const copyToClipboard = useCallback(async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success('Länk kopierad till urklipp'); }
    catch (error) { toast.error('Kunde inte kopiera länk'); }
  }, []);

  return { isLoading, isPending, isError, shareUrl, createShareLink, deleteShareLink, getExistingShare, copyToClipboard, setShareUrl };
};
