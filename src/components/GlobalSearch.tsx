import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Ticket, User as UserIcon, ArrowRight, Clock, Zap, Tag, Folder } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { CategoryBadge } from './CategoryBadge';
import { TagBadges } from './TagBadges';
import { Ticket as TicketType, User, Category, Tag as TagType } from '@/types/ticket';
import { format } from 'date-fns';

interface GlobalSearchProps {
  tickets: TicketType[];
  users: User[];
  categories?: Category[];
  tags?: TagType[];
}

export const GlobalSearch = ({ tickets, users, categories = [], tags = [] }: GlobalSearchProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const normalizeSearch = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  // Get recently viewed tickets from localStorage
  const recentTickets = useMemo(() => {
    try {
      const stored = localStorage.getItem('recently_viewed_tickets') || '[]';
      const recentIds: string[] = JSON.parse(stored);
      return recentIds
        .map(id => tickets.find(t => t.id === id))
        .filter((t): t is TicketType => !!t)
        .slice(0, 3);
    } catch {
      return [];
    }
  }, [tickets]);

  // Calculate popular tags
  const popularTags = useMemo(() => {
    const usage = new Map<string, number>();
    tickets.forEach(ticket => {
      ticket.tags?.forEach(tag => {
        usage.set(tag.id, (usage.get(tag.id) || 0) + 1);
      });
    });

    return Array.from(usage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => tags.find(t => t.id === id))
      .filter((t): t is TagType => !!t);
  }, [tickets, tags]);

  // Calculate popular categories
  const popularCategories = useMemo(() => {
    const usage = new Map<string, number>();
    tickets.forEach(ticket => {
      if (ticket.category) {
        usage.set(ticket.category, (usage.get(ticket.category) || 0) + 1);
      }
    });

    return Array.from(usage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => {
        const cat = categories.find(c => c.id === id);
        return cat ? { ...cat, count } : null;
      })
      .filter((c): c is Category & { count: number } => !!c);
  }, [tickets, categories]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

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
    <div ref={containerRef} className="relative w-full md:w-[280px] group">
      {/* Layer 1: Outer rotating gradient (always visible) */}
      <div className="absolute z-[-1] overflow-hidden h-full w-full max-h-[56px] md:max-h-[70px] rounded-xl blur-[2px] md:blur-[3px]">
        <div className="absolute w-[999px] h-[999px] bg-no-repeat top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                        bg-[conic-gradient(hsl(var(--search-glow-base)),hsl(var(--search-glow-primary-deep))_5%,hsl(var(--search-glow-base))_38%,hsl(var(--search-glow-base))_50%,hsl(var(--search-glow-accent-vivid))_60%,hsl(var(--search-glow-base))_87%)]
                        transition-all duration-2000
                        animate-search-glow-slow
                        group-hover:rotate-[-120deg] group-focus-within:animate-search-glow-focus">
        </div>
      </div>

      {/* Layer 2: Inner gradient (desktop only) */}
      <div className="hidden md:block absolute z-[-1] overflow-hidden h-full w-full max-h-[65px] max-w-[312px] rounded-xl blur-[3px]">
        <div className="absolute w-[600px] h-[600px] bg-no-repeat top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[82deg]
                        bg-[conic-gradient(rgba(0,0,0,0),hsl(var(--search-glow-primary-dark)),rgba(0,0,0,0)_10%,rgba(0,0,0,0)_50%,hsl(var(--search-glow-accent-dark)),rgba(0,0,0,0)_60%)]
                        transition-all duration-2000
                        group-hover:rotate-[-98deg] group-focus-within:rotate-[442deg]">
        </div>
      </div>

      {/* Layer 3: Highlight gradient (desktop only) */}
      <div className="hidden md:block absolute z-[-1] overflow-hidden h-full w-full max-h-[63px] max-w-[307px] rounded-lg blur-[2px]">
        <div className="absolute w-[600px] h-[600px] bg-no-repeat top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[70deg]
                        bg-[conic-gradient(rgba(0,0,0,0)_0%,hsl(var(--search-glow-primary-bright)),rgba(0,0,0,0)_8%,rgba(0,0,0,0)_50%,hsl(var(--search-glow-accent-bright)),rgba(0,0,0,0)_58%)]
                        brightness-140 transition-all duration-2000
                        group-hover:rotate-[-97deg] group-focus-within:rotate-[443deg]">
        </div>
      </div>

      {/* Search icon */}
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10 pointer-events-none" />

      {/* Input with updated background */}
      <Input
        ref={inputRef}
        placeholder="Sök överallt..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
        className="relative pl-10 pr-4 bg-[hsl(var(--search-input-bg))] border-primary/30 focus-visible:border-primary/50 focus-visible:ring-0 transition-colors"
      />

      {/* Dropdown - absolute positioned */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-md shadow-md max-h-[400px] overflow-y-auto z-50">
          <Command shouldFilter={false}>
            <CommandList>
          {!search && (
            <>
              {/* Quick Actions */}
              <CommandGroup heading={<span className="flex items-center gap-2"><Zap className="w-4 h-4" /> Snabbåtgärder</span>}>
                <CommandItem
                  onSelect={() => handleSelect('/tickets/new')}
                  className="flex items-center gap-3"
                >
                  <span className="text-sm">Nytt ärende</span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto" />
                </CommandItem>
                <CommandItem
                  onSelect={() => handleSelect('/settings')}
                  className="flex items-center gap-3"
                >
                  <span className="text-sm">Inställningar</span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground ml-auto" />
                </CommandItem>
              </CommandGroup>

              {/* Recent Tickets */}
              {recentTickets.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={<span className="flex items-center gap-2"><Clock className="w-4 h-4" /> Nyligen visade</span>}>
                    {recentTickets.map(ticket => (
                      <CommandItem
                        key={ticket.id}
                        onSelect={() => handleSelect(`/tickets/${ticket.id}`)}
                        className="flex items-center gap-2"
                      >
                        <span className="text-sm flex-1 truncate">{ticket.title}</span>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {/* Popular Tags */}
              {popularTags.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={<span className="flex items-center gap-2"><Tag className="w-4 h-4" /> Populära taggar</span>}>
                    {popularTags.map(tag => {
                      const tagCount = tickets.filter(t => t.tags?.some(tag2 => tag2.id === tag.id)).length;
                      return (
                        <CommandItem
                          key={tag.id}
                          onSelect={() => handleSelect(`/tickets?tags=${tag.id}`)}
                          className="flex items-center gap-2"
                        >
                          <span
                            style={{ backgroundColor: tag.color }}
                            className="w-2 h-2 rounded-full"
                          />
                          <span className="text-sm flex-1">{tag.name}</span>
                          <span className="text-xs text-muted-foreground">({tagCount})</span>
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}

              {/* Popular Categories */}
              {popularCategories.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={<span className="flex items-center gap-2"><Folder className="w-4 h-4" /> Vanliga kategorier</span>}>
                    {popularCategories.map(cat => (
                      <CommandItem
                        key={cat.id}
                        onSelect={() => handleSelect(`/tickets?category=${cat.id}`)}
                        className="flex items-center gap-2"
                      >
                        <span className="text-sm flex-1">{cat.label}</span>
                        <span className="text-xs text-muted-foreground">({cat.count})</span>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
              <CommandSeparator />
            </>
          )}

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
          </Command>
        </div>
      )}
    </div>
  );
};
