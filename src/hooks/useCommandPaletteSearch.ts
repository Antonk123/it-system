import { useState, useEffect, useRef } from 'react';
import { api, TicketRow, KbArticleRow } from '@/lib/api';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface SearchResult {
  id: string;
  title: string;
  type: 'ticket' | 'kb';
  subtitle?: string; // status for tickets, article_type for KB
}

interface UseCommandPaletteSearchReturn {
  results: SearchResult[];
  isSearching: boolean;
  search: string;
  setSearch: (value: string) => void;
}

export function useCommandPaletteSearch(): UseCommandPaletteSearchReturn {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const term = search.trim();

    if (!term) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    debounceRef.current = setTimeout(async () => {
      try {
        const [ticketResponse, kbArticles] = await Promise.all([
          api.getTickets('?page=1&limit=6&status=all&search=' + encodeURIComponent(term)),
          api.getKbArticles({ search: term }),
        ]);

        const rows: TicketRow[] = Array.isArray(ticketResponse)
          ? (ticketResponse as TicketRow[])
          : (ticketResponse as PaginatedResponse<TicketRow>).data;

        const ticketResults: SearchResult[] = rows.slice(0, 5).map(t => ({
          id: t.id,
          title: t.title,
          type: 'ticket',
          subtitle: t.status,
        }));

        const kbResults: SearchResult[] = (kbArticles as KbArticleRow[]).slice(0, 5).map(a => ({
          id: a.id,
          title: a.title,
          type: 'kb',
          subtitle: a.article_type ?? undefined,
        }));

        setResults([...ticketResults, ...kbResults]);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { results, isSearching, search, setSearch };
}
