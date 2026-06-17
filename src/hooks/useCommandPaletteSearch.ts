import { useState, useEffect, useRef } from 'react';
import { api, TicketRow, KbArticleRow, ContactRow, PaginatedResponse } from '@/lib/api';

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
  // Guards against stale in-flight requests clobbering newer results when the
  // user types fast or clears the input mid-fetch.
  const latestQueryRef = useRef('');

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const term = search.trim();
    latestQueryRef.current = term;

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

        // If the user changed the query while this fetch was in flight,
        // discard the stale result.
        if (latestQueryRef.current !== term) return;

        contactsCacheRef.current = contacts;

        const rows: TicketRow[] = Array.isArray(ticketResponse)
          ? (ticketResponse as TicketRow[])
          : (ticketResponse as unknown as PaginatedResponse<TicketRow>).data;

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
        if (latestQueryRef.current === term) setResults([]);
      } finally {
        if (latestQueryRef.current === term) setIsSearching(false);
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
