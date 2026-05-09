import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, X, Search, Loader2, FilePlus, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { api, KbArticleRow } from '@/lib/api';
import { toast } from 'sonner';

interface KBLinksSectionProps {
  ticketId: string;
  ticketTitle?: string;
}

export const KBLinksSection = ({ ticketId, ticketTitle }: KBLinksSectionProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search input — 300ms, same pattern as useCommandPaletteSearch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Query 1: linked articles — shown immediately on mount (KBSB-03)
  const { data: linked = [], isLoading: isLoadingLinked } = useQuery({
    queryKey: ['ticket-kb-links', ticketId],
    queryFn: () => api.getTicketKbLinks(ticketId),
  });

  const linkedIds = new Set(linked.map((a) => a.id));

  // Query 2: FTS5 search results — only when 2+ chars typed (KBSB-01)
  const { data: searchResults = [], isFetching: isSearchFetching } = useQuery({
    queryKey: ['kb-search', debouncedSearch],
    queryFn: () => api.getKbArticles({ search: debouncedSearch }),
    enabled: debouncedSearch.length >= 2,
  });

  // Filter already-linked articles out of search results client-side
  const filteredResults = searchResults.filter((a: KbArticleRow) => !linkedIds.has(a.id)).slice(0, 8);

  // Mutation: link article to ticket (KBSB-02)
  const linkMutation = useMutation({
    mutationFn: (articleId: string) => api.linkKbArticleToTicket(ticketId, articleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-kb-links', ticketId] });
      setSearchQuery('');
      setDebouncedSearch('');
      toast.success('KB-artikel länkad');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Kunde inte länka artikel');
    },
  });

  // Mutation: unlink article from ticket
  const unlinkMutation = useMutation({
    mutationFn: (articleId: string) => api.unlinkKbArticleFromTicket(ticketId, articleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-kb-links', ticketId] });
      toast.success('Länk borttagen');
    },
    onError: () => {
      toast.error('Kunde inte ta bort länk');
    },
  });

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-foreground flex items-center gap-2 text-sm">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
          Kunskapsbas ({linked.length})
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-7"
          onClick={() =>
            navigate(
              `/kb/new?title=${encodeURIComponent(ticketTitle || '')}&article_type=solution&ticket_id=${ticketId}`
            )
          }
        >
          <FilePlus className="w-3.5 h-3.5 mr-1" />
          Skapa KB-artikel
        </Button>
      </div>

      {/* Linked articles — always visible before search (KBSB-03) */}
      {isLoadingLinked ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : linked.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">Inga KB-artiklar länkade</p>
      ) : (
        <div className="space-y-1.5">
          {linked.map((article) => (
            <div
              key={article.id}
              className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg hover:bg-muted transition-colors group"
            >
              <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <Link
                  to={`/kb/${article.id}`}
                  className="text-sm font-medium truncate hover:underline block"
                >
                  {article.title}
                </Link>
                {article.category_name && (
                  <Badge
                    variant="secondary"
                    className="text-xs mt-0.5"
                    style={
                      article.category_color
                        ? { backgroundColor: article.category_color + '22', color: article.category_color }
                        : undefined
                    }
                  >
                    {article.category_name}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
                onClick={() => unlinkMutation.mutate(article.id)}
                disabled={unlinkMutation.isPending}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Search section — separated from linked articles */}
      <div className="pt-3 border-t border-dashed">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Sök KB-artiklar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>

        {/* Search results (KBSB-01 + KBSB-02) */}
        {debouncedSearch.length >= 2 && (
          <div className="mt-2 space-y-1.5">
            {isSearchFetching ? (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : filteredResults.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">Inga artiklar matchade sökningen</p>
            ) : (
              filteredResults.map((article: KbArticleRow) => (
                <div
                  key={article.id}
                  className="p-2 rounded-lg border-l-2 border-primary/30 bg-muted/30 hover:bg-muted transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{article.title}</p>
                      {article.category_name && (
                        <Badge
                          variant="secondary"
                          className="text-xs mt-0.5"
                          style={
                            article.category_color
                              ? { backgroundColor: article.category_color + '22', color: article.category_color }
                              : undefined
                          }
                        >
                          {article.category_name}
                        </Badge>
                      )}
                      {/* FTS5 snippet: safe <mark> tags from our own SQLite server — single-user system */}
                      {article.snippet && (
                        <p
                          className="text-xs text-muted-foreground mt-0.5 line-clamp-2"
                          // nosec: content is FTS5 snippet from our own SQLite server, single-user system, no XSS risk
                          dangerouslySetInnerHTML={{ __html: article.snippet }}
                        />
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 shrink-0"
                      onClick={() => linkMutation.mutate(article.id)}
                      disabled={linkMutation.isPending}
                      title="Länka artikel"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
