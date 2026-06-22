import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, TicketRow, KbArticleRow, ContactRow, PaginatedResponse } from '@/lib/api';
import { useDebounce } from './useDebounce';

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

// Kontakter laddas en gång och filtreras lokalt — separat fråga med lång staleTime.
const contactsQuery = {
  queryKey: ['command-palette-contacts'] as const,
  queryFn: () => api.getContacts(),
  staleTime: 1000 * 60 * 5, // 5 minuter
};

export function useCommandPaletteSearch(): UseCommandPaletteSearchReturn {
  const [search, setSearch] = useState('');
  // Debounca söktermen 250 ms för att undvika onödiga API-anrop vid snabb inmatning.
  const term = useDebounce(search.trim(), 250);

  // Hämta tickets + KB-artiklar baserat på debouncat sökterm.
  const searchEnabled = term.length > 0;
  const { data: searchData, isFetching: isSearchFetching } = useQuery({
    queryKey: ['command-palette-search', term] as const,
    queryFn: async () => {
      const [ticketResponse, kbArticles] = await Promise.all([
        api.getTickets('?page=1&limit=6&status=all&search=' + encodeURIComponent(term)),
        api.getKbArticles({ search: term }),
      ]);

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

      return { ticketResults, kbResults };
    },
    enabled: searchEnabled,
    staleTime: 0, // sökresultat ska alltid vara färska
  });

  // Kontakter hämtas separat och filtreras lokalt mot det debounca söktermen.
  const { data: contacts = [], isFetching: isContactsFetching } = useQuery<ContactRow[]>({
    ...contactsQuery,
    // Hämta kontakter så fort söktermen är aktiv så att listan är redo.
    enabled: searchEnabled,
  });

  const contactResults: SearchResult[] = searchEnabled
    ? (() => {
        const lower = term.toLowerCase();
        return contacts
          .filter(
            c =>
              c.name.toLowerCase().includes(lower) ||
              c.email.toLowerCase().includes(lower) ||
              (c.company_name && c.company_name.toLowerCase().includes(lower)),
          )
          .slice(0, 5)
          .map(c => ({
            id: c.id,
            title: c.name || c.email,
            type: 'contact' as const,
            subtitle: c.company_name || undefined,
          }));
      })()
    : [];

  const results: SearchResult[] = searchEnabled && searchData
    ? [...searchData.ticketResults, ...contactResults, ...searchData.kbResults]
    : [];

  // isSearching är sant medan debounce väntar (input skiljer sig från term)
  // eller medan react-query hämtar data. Inkludera ÄVEN kontaktfrågans hämtning —
  // annars (kall kontakt-cache) hinner tickets/KB returnera först och en sökning
  // som bara matchar kontakter visar "Inga resultat" tills kontakterna poppar in.
  const isDebouncing = search.trim() !== term && search.trim().length > 0;
  const isSearching = isDebouncing || (searchEnabled && (isSearchFetching || isContactsFetching));

  return { results, isSearching, search, setSearch };
}
