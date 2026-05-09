import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Ticket,
  Archive,
  Users,
  Settings,
  BarChart3,
  BookOpen,
  RefreshCw,
  Clock,
  Plus,
  FilePlus,
  Sun,
  Moon,
} from 'lucide-react';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from '@/components/ui/command';
import { useCommandPaletteSearch } from '@/hooks/useCommandPaletteSearch';
import {
  getRecentlyViewedTickets,
  getRecentlyViewedKB,
  RecentItem,
} from '@/lib/recentlyViewed';
import {
  getStoredMode,
  applyMode,
  saveModeTheme,
  ModeTheme,
} from '@/lib/appearance';
import { dispatchModeChange } from '@/hooks/useMode';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/tickets', icon: Ticket, label: 'Alla ärenden' },
  { path: '/recurring', icon: RefreshCw, label: 'Återkommande' },
  { path: '/reports', icon: BarChart3, label: 'Rapporter' },
  { path: '/archive', icon: Archive, label: 'Arkiv' },
  { path: '/users', icon: Users, label: 'Kontakter' },
  { path: '/kb', icon: BookOpen, label: 'Kunskapsbas' },
  { path: '/settings', icon: Settings, label: 'Inställningar' },
];

function TypeBadge({ type }: { type: 'ticket' | 'kb' | 'contact' }) {
  const label = type === 'ticket' ? 'Ärende' : type === 'kb' ? 'KB' : 'Kontakt';
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-1 shrink-0">
      {label}
    </span>
  );
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const searchHook = useCommandPaletteSearch();
  const { results, isSearching, search, setSearch } = searchHook;

  // Load recently viewed items (merged and sorted by visitedAt desc, top 5)
  const recentItems = useMemo((): (RecentItem & { itemType: 'ticket' | 'kb' })[] => {
    const tickets = getRecentlyViewedTickets().map(item => ({ ...item, itemType: 'ticket' as const }));
    const kb = getRecentlyViewedKB().map(item => ({ ...item, itemType: 'kb' as const }));
    return [...tickets, ...kb]
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, 5);
  }, [open]);

  // Filter nav items by search term when searching
  const filteredNavItems = useMemo(() => {
    if (!search.trim()) return navItems;
    const lower = search.toLowerCase();
    return navItems.filter(item => item.label.toLowerCase().includes(lower));
  }, [search]);

  const handleSelect = (path: string) => {
    onOpenChange(false);
    setSearch('');
    navigate(path);
  };

  const handleThemeToggle = () => {
    const current = getStoredMode();
    const next: ModeTheme = current === 'dark' ? 'light' : 'dark';
    applyMode(next);
    saveModeTheme(next);
    dispatchModeChange(next);
    // Do NOT close palette — user might want to do more
  };

  const currentMode = getStoredMode();

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Sök ärenden, artiklar, sidor..."
        value={search}
        onValueChange={setSearch}
      />

      <CommandList className="max-h-[420px]">
        {/* ── IDLE STATE (no search) ── */}
        {!search && (
          <>
            {/* Recently visited */}
            {recentItems.length > 0 && (
              <CommandGroup heading="Senast besökta">
                {recentItems.map(item => (
                  <CommandItem
                    key={`${item.itemType}-${item.id}`}
                    onSelect={() => handleSelect(item.itemType === 'ticket' ? `/tickets/${item.id}` : `/kb/${item.id}`)}
                    className="flex items-center gap-2"
                  >
                    <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate text-sm">{item.title}</span>
                    <TypeBadge type={item.itemType} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {recentItems.length > 0 && <CommandSeparator />}

            {/* Navigation */}
            <CommandGroup heading="Navigering">
              {navItems.map(({ path, icon: Icon, label }) => (
                <CommandItem
                  key={path}
                  onSelect={() => handleSelect(path)}
                  className="flex items-center gap-2"
                >
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-sm">{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />

            {/* Quick actions */}
            <CommandGroup heading="Snabbåtgärder">
              <CommandItem
                onSelect={() => handleSelect('/tickets/new')}
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm">Nytt ärende</span>
                <CommandShortcut>N</CommandShortcut>
              </CommandItem>
              <CommandItem
                onSelect={() => handleSelect('/kb/new')}
                className="flex items-center gap-2"
              >
                <FilePlus className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm">Ny KB-artikel</span>
                <CommandShortcut>K</CommandShortcut>
              </CommandItem>
              <CommandItem
                onSelect={handleThemeToggle}
                className="flex items-center gap-2"
              >
                {currentMode === 'dark' ? (
                  <Sun className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <Moon className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <span className="flex-1 text-sm">Byt tema</span>
                <CommandShortcut>T</CommandShortcut>
              </CommandItem>
              <CommandItem
                onSelect={() => handleSelect('/settings')}
                className="flex items-center gap-2"
              >
                <Settings className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm">Inställningar</span>
                <CommandShortcut>S</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {/* ── SEARCH STATE ── */}
        {search && (
          <>
            {/* Loading */}
            {isSearching && results.length === 0 && (
              <CommandEmpty>Söker...</CommandEmpty>
            )}

            {/* Results */}
            {results.length > 0 && (
              <CommandGroup heading="Resultat">
                {results.map(result => (
                  <CommandItem
                    key={`${result.type}-${result.id}`}
                    onSelect={() => handleSelect(
                      result.type === 'ticket' ? `/tickets/${result.id}`
                      : result.type === 'contact' ? `/users`
                      : `/kb/${result.id}`
                    )}
                    className="flex items-center gap-2"
                  >
                    {result.type === 'ticket' ? (
                      <Ticket className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : result.type === 'contact' ? (
                      <Users className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1 truncate text-sm">{result.title}</span>
                    <TypeBadge type={result.type} />
                    {result.subtitle && (
                      <span className="text-xs text-muted-foreground ml-1">{result.subtitle}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* No results */}
            {!isSearching && results.length === 0 && (
              <CommandEmpty>Inga resultat för &quot;{search}&quot;</CommandEmpty>
            )}

            {/* Filtered nav items during search */}
            {filteredNavItems.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Navigering">
                  {filteredNavItems.map(({ path, icon: Icon, label }) => (
                    <CommandItem
                      key={path}
                      onSelect={() => handleSelect(path)}
                      className="flex items-center gap-2"
                    >
                      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-sm">{label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </>
        )}
      </CommandList>

      {/* Footer hint bar */}
      <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center gap-4">
        <span>ESC för att stänga</span>
        <span>Enter för att välja</span>
      </div>
    </CommandDialog>
  );
}
