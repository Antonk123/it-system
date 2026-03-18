import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, X, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { api, KbArticleRow } from '@/lib/api';
import { toast } from 'sonner';

interface LinkedArticle extends KbArticleRow {
  link_id: string;
}

interface KBLinksSectionProps {
  ticketId: string;
}

export const KBLinksSection = ({ ticketId }: KBLinksSectionProps) => {
  const [linked, setLinked] = useState<LinkedArticle[]>([]);
  const [allArticles, setAllArticles] = useState<KbArticleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const fetchLinked = useCallback(async () => {
    try {
      const data = await api.getTicketKbLinks(ticketId);
      setLinked(data);
    } catch {
      // non-critical
    } finally {
      setIsLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchLinked();
  }, [fetchLinked]);

  useEffect(() => {
    if (!open) return;
    const fetch = async () => {
      try {
        const data = await api.getKbArticles();
        setAllArticles(data);
      } catch {
        toast.error('Kunde inte hämta artiklar');
      }
    };
    fetch();
  }, [open]);

  const availableArticles = allArticles.filter((a) => {
    if (linked.some((l) => l.id === a.id)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return a.title.toLowerCase().includes(q) || (a.category_name?.toLowerCase() ?? '').includes(q);
  });

  const handleLink = async (articleId: string) => {
    setIsAdding(true);
    try {
      await api.linkKbArticleToTicket(ticketId, articleId);
      await fetchLinked();
      setOpen(false);
      setSearchQuery('');
      toast.success('KB-artikel länkad');
    } catch (error: any) {
      toast.error(error.message || 'Kunde inte länka artikel');
    } finally {
      setIsAdding(false);
    }
  };

  const handleUnlink = async (articleId: string) => {
    try {
      await api.unlinkKbArticleFromTicket(ticketId, articleId);
      setLinked((prev) => prev.filter((a) => a.id !== articleId));
      toast.success('Länk borttagen');
    } catch {
      toast.error('Kunde inte ta bort länk');
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-foreground flex items-center gap-2 text-sm">
        <BookOpen className="w-4 h-4 text-muted-foreground" />
        Knowledge Base ({linked.length})
      </h3>

      {/* Add link */}
      <Popover
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) setSearchQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs text-muted-foreground"
            disabled={isAdding}
          >
            <Search className="mr-2 h-3.5 w-3.5" />
            Länka KB-artikel...
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[380px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Sök artiklar..."
              className="h-9"
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              <CommandEmpty>Inga artiklar hittades.</CommandEmpty>
              <CommandGroup>
                {availableArticles.slice(0, 50).map((article) => (
                  <CommandItem
                    key={article.id}
                    value={article.id}
                    onSelect={() => handleLink(article.id)}
                    disabled={isAdding}
                    className="flex items-start gap-2 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium line-clamp-1">{article.title}</p>
                      {article.category_name && (
                        <p className="text-xs text-muted-foreground mt-0.5">{article.category_name}</p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Linked articles */}
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : linked.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">Inga KB-artiklar länkade</p>
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
                    style={article.category_color ? { backgroundColor: article.category_color + '22', color: article.category_color } : undefined}
                  >
                    {article.category_name}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
                onClick={() => handleUnlink(article.id)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
