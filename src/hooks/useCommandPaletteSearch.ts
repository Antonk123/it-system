import { useState, useEffect, useRef } from 'react';
import { api, TicketRow, KbArticleRow, ContactRow } from '@/lib/api';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface SearchResult {
  id: string;
  title: string;
  type: 'ticket' | 'kb' | 'contact';
  subtitle?: string;
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
  const contactsCacheRef = useRef<ContactRow[] | null>(null);

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
        const contactsPromise = contactsCacheRef.current
          ? Promise.resolve(contactsCacheRef.current)
          : api.getContacts();

        const [ticketResponse, kbArticles, contacts] = await Promise.all([
          api.getTickets('?page=1&limit=6&status=all&search=' + encodeURIComponent(term)),
          api.getKbArticles({ search: term }),
          contactsPromise,
        ]);

        contactsCacheRef.current = contacts;

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

        const lower = term.toLowerCase();
        const contactResults: SearchResult[] = contacts
          .filter(c => c.name.toLowerCase().includes(lower)
            || c.email.toLowerCase().includes(lower)
            || (c.company_name && c.company_name.toLowerCase().includes(lower)))
          .slice(0, 5)
          .map(c => ({
            id: c.id,
            title: c.name || c.email,
            type: 'contact',
            subtitle: c.company_name || undefined,
          }));

        setResults([...ticketResults, ...contactResults, ...kbResults]);
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

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { results, isSearching, search, setSearch };
}
