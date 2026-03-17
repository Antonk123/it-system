import { useState } from 'react';
import { Link as LinkIcon, X, Loader2, Search, Check } from 'lucide-react';
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
import { cn } from '@/lib/utils';

interface TicketLinksProps {
  links: TicketLink[];
  isLoading: boolean;
  currentTicketId: string;
  onAddLink: (targetTicketId: string) => Promise<void>;
  onDeleteLink: (linkId: string) => Promise<void>;
}

export const TicketLinks = ({
  links,
  isLoading,
  currentTicketId,
  onAddLink,
  onDeleteLink,
}: TicketLinksProps) => {
  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch active tickets (open, in-progress, waiting, resolved)
  const { tickets: activeTickets } = useTickets({
    page: 1,
    limit: 500,
  });

  // Fetch closed/archived tickets separately
  const { tickets: closedTickets } = useTickets({
    page: 1,
    limit: 500,
    status: 'closed'
  });

  // Merge all tickets
  const tickets = [...activeTickets, ...closedTickets];

  // Debug: Log ticket statuses
  if (import.meta.env.DEV && tickets.length > 0) {
    const statusCounts = tickets.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('TicketLinks - Total tickets:', tickets.length, 'By status:', statusCounts);
  }

  const handleAddLink = async (ticketId: string) => {
    if (ticketId === currentTicketId) {
      toast.error('Cannot link a ticket to itself');
      return;
    }

    setIsAdding(true);
    try {
      await onAddLink(ticketId);
      setOpen(false);
      toast.success('Link created successfully');
    } catch (error: any) {
      const message = error.message || 'Failed to create link';
      toast.error(message);
    } finally {
      setIsAdding(false);
    }
  };

  // Filter out current ticket and already linked tickets
  const excludedTickets = tickets.filter(
    (ticket) =>
      ticket.id !== currentTicketId &&
      !links.some((link) => link.linkedTicket.id === ticket.id)
  );

  // Custom search filter
  const availableTickets = excludedTickets.filter((ticket) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    const searchableText = [
      ticket.title,
      ticket.id,
      ticket.description || '',
      ticket.category || '',
      ticket.status,
      ticket.priority,
      ticket.notes || '',
      ticket.solution || '',
      ...(ticket.tags?.map((t: any) => t.name) || []),
    ].join(' ').toLowerCase();

    return searchableText.includes(query);
  });

  const handleDeleteLink = async (linkId: string) => {
    try {
      await onDeleteLink(linkId);
      toast.success('Link removed successfully');
    } catch (error) {
      toast.error('Failed to remove link');
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-foreground flex items-center gap-2 text-sm">
        <LinkIcon className="w-4 h-4 text-muted-foreground" />
        Related Tickets ({links.length})
      </h3>

      {/* Add new link form */}
      <Popover
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) setSearchQuery(''); // Clear search when closed
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
            Search tickets to link...
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search tickets..."
              className="h-9"
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              <CommandEmpty>No tickets found.</CommandEmpty>
              <CommandGroup>
                {availableTickets.slice(0, 100).map((ticket) => (
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
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Links list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : links.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No linked tickets yet
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
                className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
                onClick={() => handleDeleteLink(link.id)}
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
