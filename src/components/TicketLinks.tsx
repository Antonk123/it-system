import { useState, useMemo } from 'react';
import { Link as LinkIcon, X, Loader2, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TicketLink } from '@/types/ticket';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTickets } from '@/hooks/useTickets';
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
import { useDebounce } from '@/hooks/useDebounce';

interface TicketLinksProps {
  links: TicketLink[];
  isLoading: boolean;
  isError?: boolean;
  currentTicketId: string;
  onAddLink: (targetTicketId: string) => Promise<void>;
  onDeleteLink: (linkId: string) => Promise<void>;
}

export const TicketLinks = ({
  links,
  isLoading,
  isError,
  currentTicketId,
  onAddLink,
  onDeleteLink,
}: TicketLinksProps) => {
  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 250);

  const { tickets, isLoading: isSearching } = useTickets(
    debouncedSearch.length >= 2
      ? { page: 1, limit: 50, status: 'all', search: debouncedSearch }
      : undefined
  );

  const linkedIds = useMemo(
    () => new Set([currentTicketId, ...links.map((l) => l.linkedTicket.id)]),
    [currentTicketId, links]
  );

  const availableTickets = useMemo(
    () => tickets.filter((t) => !linkedIds.has(t.id)),
    [tickets, linkedIds]
  );

  const handleAddLink = async (ticketId: string) => {
    if (ticketId === currentTicketId) {
      toast.error('Kan inte länka ett ärende till sig självt');
      return;
    }

    setIsAdding(true);
    try {
      await onAddLink(ticketId);
      setOpen(false);
      toast.success('Länk skapad');
    } catch (error: any) {
      const message = error.message || 'Kunde inte skapa länk';
      toast.error(message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    try {
      await onDeleteLink(linkId);
      toast.success('Länk borttagen');
    } catch (error) {
      toast.error('Kunde inte ta bort länk');
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-foreground flex items-center gap-2 text-sm">
        <LinkIcon className="w-4 h-4 text-muted-foreground" />
        Relaterade ärenden ({links.length})
      </h3>

      {/* Add new link form */}
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
            Sök ärenden att länka...
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Sök ärenden..."
              className="h-9"
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              {debouncedSearch.length < 2 ? (
                <CommandEmpty>Skriv minst 2 tecken för att söka.</CommandEmpty>
              ) : isSearching ? (
                <CommandEmpty>
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                  Söker...
                </CommandEmpty>
              ) : availableTickets.length === 0 ? (
                <CommandEmpty>Inga ärenden hittades.</CommandEmpty>
              ) : (
                <CommandGroup>
                  {availableTickets.map((ticket) => (
                    <CommandItem
                      key={ticket.id}
                      value={ticket.id}
                      onSelect={() => handleAddLink(ticket.id)}
                      disabled={isAdding}
                      className="flex items-start gap-2 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-1">
                          {ticket.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground font-mono">
                            #{ticket.id.slice(0, 8)}
                          </span>
                          <StatusBadge status={ticket.status} />
                          <PriorityBadge priority={ticket.priority} />
                          {ticket.category && (
                            <span className="text-xs text-muted-foreground">
                              {ticket.category}
                            </span>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Links list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <p className="text-xs text-destructive py-2">
          Kunde inte hämta länkade ärenden
        </p>
      ) : links.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          Inga länkade ärenden ännu
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((link) => (
            <div
              key={link.id}
              className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg hover:bg-muted transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <Link
                  to={`/tickets/${link.linkedTicket.id}`}
                  className="text-sm font-medium truncate hover:underline block"
                >
                  {link.linkedTicket.title}
                </Link>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">
                    #{link.linkedTicket.id.slice(0, 8)}
                  </span>
                  <StatusBadge status={link.linkedTicket.status} />
                  <PriorityBadge priority={link.linkedTicket.priority} />
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="md:opacity-0 md:group-hover:opacity-100 transition-opacity h-9 w-9 md:h-7 md:w-7 p-0 shrink-0"
                onClick={() => handleDeleteLink(link.id)}
                aria-label="Ta bort länk"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
