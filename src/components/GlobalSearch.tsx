import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Ticket, User as UserIcon, ArrowRight } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { CategoryBadge } from './CategoryBadge';
import { Ticket as TicketType, User } from '@/types/ticket';
import { format } from 'date-fns';

interface GlobalSearchProps {
  tickets: TicketType[];
  users: User[];
}

export const GlobalSearch = ({ tickets, users }: GlobalSearchProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const normalizeSearch = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const getUserName = (userId: string) => {
    return users.find(u => u.id === userId)?.name || '';
  };

  const ticketMatches = useMemo(() => {
    if (!search) {
      const active = tickets.filter((t) => t.status !== "closed").slice(0, 5);
      const archived = tickets.filter((t) => t.status === "closed").slice(0, 5);
      return { active, archived };
    }

    const normalized = normalizeSearch(search);
    const tokens = normalized.split(" ").filter(Boolean);
    const matches = tickets.filter((t) => {
      const requesterName = normalizeSearch(getUserName(t.requesterId));
      const haystack = [
        t.title,
        t.description,
        t.category || "",
        requesterName,
      ]
        .map(normalizeSearch)
        .join(" ");

      return tokens.every((token) => haystack.includes(token));
    });

    return {
      active: matches.filter((t) => t.status !== "closed").slice(0, 10),
      archived: matches.filter((t) => t.status === "closed").slice(0, 10),
    };
  }, [tickets, users, search]);

  const filteredUsers = useMemo(() => {
    if (!search) return users.slice(0, 5);
    const lower = normalizeSearch(search);
    return users.filter(u => 
      normalizeSearch(u.name).includes(lower) ||
      normalizeSearch(u.email).includes(lower) ||
      normalizeSearch(u.department || '').includes(lower)
    ).slice(0, 10);
  }, [users, search]);

  const getUserTicketCount = (userId: string) => {
    return tickets.filter(t => t.requesterId === userId).length;
  };

  const handleSelect = (path: string) => {
    setOpen(false);
    setSearch('');
    navigate(path);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-muted/50 hover:bg-muted rounded-lg transition-colors w-full sm:w-auto"
      >
        <Search className="w-4 h-4" />
        <span className="hidden sm:inline">Sök överallt...</span>
        <span className="sm:hidden">Sök...</span>
        <kbd className="hidden sm:inline-flex pointer-events-none h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput 
          placeholder="Sök ärenden, användare..." 
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>Inga resultat hittades.</CommandEmpty>
          
          {ticketMatches.active.length > 0 && (
            <CommandGroup heading="Ärenden">
              {ticketMatches.active.map((ticket) => (
                <CommandItem
                  key={ticket.id}
                  onSelect={() => handleSelect(`/tickets/${ticket.id}`)}
                  className="flex flex-col items-start gap-1 py-3"
                >
                  <div className="flex items-center gap-2 w-full">
                    <Ticket className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="font-medium flex-1 truncate">{ticket.title}</span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-2 ml-6 flex-wrap">
                    <StatusBadge status={ticket.status} />
                    <PriorityBadge priority={ticket.priority} />
                    <CategoryBadge category={ticket.category} />
                    {getUserName(ticket.requesterId) && (
                      <span className="text-xs text-muted-foreground">
                        • {getUserName(ticket.requesterId)}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {ticketMatches.archived.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Arkiv">
                {ticketMatches.archived.map((ticket) => (
                  <CommandItem
                    key={ticket.id}
                    onSelect={() => handleSelect(`/tickets/${ticket.id}`)}
                    className="flex flex-col items-start gap-1 py-3"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Ticket className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="font-medium flex-1 truncate">{ticket.title}</span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex items-center gap-2 ml-6 flex-wrap">
                      <StatusBadge status={ticket.status} />
                      <PriorityBadge priority={ticket.priority} />
                      <CategoryBadge category={ticket.category} />
                      {getUserName(ticket.requesterId) && (
                        <span className="text-xs text-muted-foreground">
                          • {getUserName(ticket.requesterId)}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {filteredUsers.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Användare">
                {filteredUsers.map((user) => {
                  const ticketCount = getUserTicketCount(user.id);
                  return (
                    <CommandItem
                      key={user.id}
                      onSelect={() => handleSelect(`/users?highlight=${user.id}`)}
                      className="flex items-center gap-3 py-3"
                    >
                      <UserIcon className="w-4 h-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                      {ticketCount > 0 && (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                          {ticketCount} ärende{ticketCount !== 1 ? 'n' : ''}
                        </span>
                      )}
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
};
