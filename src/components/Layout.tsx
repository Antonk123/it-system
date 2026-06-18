import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Ticket, Archive, Users, Plus, Menu, X, LogOut, Settings, BarChart3, ChevronsRight, BookOpen, RefreshCw, Sun, Moon, Search, Building2, Receipt, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CommandPalette } from '@/components/CommandPalette';
import { useAuth } from '@/contexts/AuthContext';
import { QuickCaptureFAB } from '@/components/QuickCaptureFAB';
import { BottomTabBar } from '@/components/BottomTabBar';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { applyMode, getStoredMode, saveModeTheme, ModeTheme } from '@/lib/appearance';
import { dispatchModeChange } from '@/hooks/useMode';
import { RouteBreadcrumbs } from '@/components/RouteBreadcrumbs';

interface LayoutProps {
  children: ReactNode;
}
const navItems = [{
  path: '/',
  icon: LayoutDashboard,
  label: 'Översikt'
}, {
  path: '/my-tickets',
  icon: Inbox,
  label: 'Mina ärenden'
}, {
  path: '/tickets',
  icon: Ticket,
  label: 'Alla ärenden'
}, {
  path: '/recurring',
  icon: RefreshCw,
  label: 'Återkommande'
}, {
  path: '/reports',
  icon: BarChart3,
  label: 'Rapporter'
}, {
  path: '/invoices',
  icon: Receipt,
  label: 'Fakturering'
}, {
  path: '/archive',
  icon: Archive,
  label: 'Arkiv'
}, {
  path: '/companies',
  icon: Building2,
  label: 'Företag'
}, {
  path: '/users',
  icon: Users,
  label: 'Kontakter'
}, {
  path: '/kb',
  icon: BookOpen,
  label: 'Kunskapsbas'
}, {
  path: '/settings',
  icon: Settings,
  label: 'Inställningar'
}];

// Sidebar components
interface NavOptionProps {
  item: typeof navItems[0];
  isActive: boolean;
  open: boolean;
  onClick: () => void;
}

const NavOption = ({ item, isActive, open, onClick }: NavOptionProps) => {
  const Icon = item.icon;

  return (
    <Link
      to={item.path}
      onClick={onClick}
      className={cn(
        "relative flex h-11 w-full items-center rounded-md transition-all duration-200",
        isActive
          ? "bg-primary/10 text-primary shadow-sm border-l-2 border-primary"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary"
      )}
    >
      <div className="grid h-full w-12 place-content-center">
        <Icon className="h-4 w-4" />
      </div>

      {open && (
        <span className={cn(
          "text-sm font-medium transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0"
        )}>
          {item.label}
        </span>
      )}
    </Link>
  );
};

interface TitleSectionProps {
  open: boolean;
}

const TitleSection = ({ open }: TitleSectionProps) => {
  return (
    <div className="p-4 border-b border-sidebar-border">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg">
          <img src="/icons/pfm-logo-lg.png" alt="PFM" className="w-full h-full object-cover" />
        </div>

        {open && (
          <div className="transition-opacity duration-200">
            <span className="block text-sm font-semibold text-sidebar-foreground">
              IT-ärenden
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

interface BottomSectionProps {
  open: boolean;
  user: any;
  onLogout: () => void;
  onToggle: () => void;
}

const BottomSection = ({ open, user, onLogout, onToggle }: BottomSectionProps) => {
  return (
    <div className="border-t border-sidebar-border p-2 space-y-2">
      {/* "Nytt ärende" button */}
      <Link to="/tickets/new">
        <button className={cn(
          "w-full flex items-center gap-2 rounded-md transition-all duration-200",
          "bg-linear-to-r from-primary to-accent text-white",
          "hover:from-primary/90 hover:to-accent/90",
          open ? "h-11 px-4" : "h-11 justify-center"
        )}>
          <Plus className="w-5 h-5" />
          {open && <span className="text-sm font-medium">Nytt ärende</span>}
        </button>
      </Link>

      {/* User email display (only when open) */}
      {open && user && (
        <div className="px-3 py-2 rounded-lg bg-background/20 border border-border/30">
          <p className="text-xs text-muted-foreground truncate flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary/60"></span>
            {user.email}
          </p>
        </div>
      )}

      {/* Logout button */}
      <button
        onClick={onLogout}
        aria-label="Logga ut"
        className={cn(
          "w-full flex items-center gap-2 rounded-md transition-all duration-200",
          "text-muted-foreground hover:text-foreground hover:bg-destructive/10",
          open ? "h-10 px-3" : "h-10 justify-center"
        )}
      >
        <LogOut className="w-4 h-4" />
        {open && <span className="text-sm">Logga ut</span>}
      </button>

      {/* Desktop only: Toggle button (hidden on mobile) */}
      <button
        onClick={onToggle}
        aria-label={open ? "Dölj sidofält" : "Visa sidofält"}
        className="hidden lg:flex w-full items-center gap-2 px-3 py-2 rounded-md hover:bg-sidebar-accent transition-colors"
      >
        <ChevronsRight className={cn(
          "h-4 w-4 transition-transform duration-300",
          !open && "rotate-180"
        )} />
        {open && <span className="text-sm text-muted-foreground">Dölj</span>}
      </button>
    </div>
  );
};

export const Layout = ({
  children
}: LayoutProps) => {
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile toggle
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false); // Desktop collapse
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { signOut, user } = useAuth();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const [mode, setMode] = useState<ModeTheme>(getStoredMode);

  const handleModeToggle = () => {
    const next: ModeTheme = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    applyMode(next);
    saveModeTheme(next);
    dispatchModeChange(next);
  };

  const handleLogout = async () => {
    await signOut();
  };
  return <><a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-background focus:px-4 focus:py-2 focus:rounded-md focus:ring-2 focus:ring-ring">
      Hoppa till innehåll
    </a><div className="min-h-dvh flex bg-background relative overflow-hidden">
      {/* Decorative floating shapes */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }}></div>
        <div className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-accent/5 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }}></div>
        <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-primary/3 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '12s', animationDelay: '4s' }}></div>
      </div>

      {/* Mobile overlay with backdrop blur */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Stäng meny"
          tabIndex={0}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 lg:hidden animate-fade-in cursor-default"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar with collapsible design */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 flex flex-col transition-[width,transform,background-color] duration-300 ease-in-out",
        "bg-sidebar border-r border-sidebar-border",
        // Keep the off-canvas drawer's top/bottom content clear of the iOS
        // notch and home indicator (0 on desktop / non-notched devices).
        "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        // Mobile
        sidebarOpen ? "translate-x-0 w-64 shadow-2xl" : "-translate-x-full lg:translate-x-0",
        // Desktop collapsible
        "lg:w-64",
        sidebarCollapsed && "lg:w-16"
      )}>
        {/* Close button for mobile */}
        <button
          className="lg:hidden absolute top-[calc(env(safe-area-inset-top,0px)+0.75rem)] right-3 text-sidebar-foreground hover:text-primary transition-colors z-20 inline-flex items-center justify-center h-10 w-10 rounded-md hover:bg-sidebar-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setSidebarOpen(false)}
          aria-label="Stäng meny"
        >
          <X className="w-5 h-5" />
        </button>

        {/* TitleSection */}
        <TitleSection open={!sidebarCollapsed} />

        {/* Nav Items */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => (
            <NavOption
              key={item.path}
              item={item}
              isActive={item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)}
              open={!sidebarCollapsed}
              onClick={() => setSidebarOpen(false)}
            />
          ))}
        </nav>

        {/* Bottom section */}
        <BottomSection
          open={!sidebarCollapsed}
          user={user}
          onLogout={handleLogout}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </aside>

      {/* Main content */}
      <main id="main-content" className="flex-1 min-w-0 relative">
        {/* Mobile header */}
        <div data-print-hide className="lg:hidden sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] flex items-center gap-4 shadow-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-primary/10 transition-colors"
            aria-label="Öppna meny"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1 relative group" onClick={() => setPaletteOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setPaletteOpen(true); }} aria-label="Sök överallt">
            {/* Glow layer */}
            <div className="absolute z-[-1] overflow-hidden h-full w-full rounded-xl blur-[2px] dark:opacity-50">
              <div className="absolute w-[999px] h-[999px] bg-no-repeat top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                              bg-[conic-gradient(hsl(var(--search-glow-base)),hsl(var(--search-glow-primary-deep))_5%,hsl(var(--search-glow-base))_38%,hsl(var(--search-glow-base))_50%,hsl(var(--search-glow-accent-vivid))_60%,hsl(var(--search-glow-base))_87%)]
                              transition-all duration-2000
                              animate-search-glow-slow
                              group-hover:rotate-[-120deg] group-focus-within:animate-search-glow-focus" />
            </div>
            <div className="relative flex w-full items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--search-input-bg))] border border-primary/30 text-muted-foreground text-sm cursor-pointer transition-colors">
              <Search className="w-4 h-4" />
              <span>Sök överallt...</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleModeToggle} aria-label="Byt tema-läge">
            {mode === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
        </div>

        {/* Desktop header with search */}
        <div data-print-hide className="hidden lg:block sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative group w-80 shrink-0 cursor-pointer" onClick={() => setPaletteOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setPaletteOpen(true); }} aria-label="Sök överallt">
                {/* Glow layer 1: outer rotating gradient */}
                <div className="absolute z-[-1] overflow-hidden h-full w-full max-h-[56px] rounded-xl blur-[3px] dark:opacity-50">
                  <div className="absolute w-[999px] h-[999px] bg-no-repeat top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                                  bg-[conic-gradient(hsl(var(--search-glow-base)),hsl(var(--search-glow-primary-deep))_5%,hsl(var(--search-glow-base))_38%,hsl(var(--search-glow-base))_50%,hsl(var(--search-glow-accent-vivid))_60%,hsl(var(--search-glow-base))_87%)]
                                  transition-all duration-2000
                                  animate-search-glow-slow
                                  group-hover:rotate-[-120deg] group-focus-within:animate-search-glow-focus" />
                </div>
                {/* Glow layer 2: inner gradient */}
                <div className="absolute z-[-1] overflow-hidden h-full w-full max-h-[52px] rounded-xl blur-[3px] dark:opacity-50">
                  <div className="absolute w-[600px] h-[600px] bg-no-repeat top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-82
                                  bg-[conic-gradient(rgba(0,0,0,0),hsl(var(--search-glow-primary-dark)),rgba(0,0,0,0)_10%,rgba(0,0,0,0)_50%,hsl(var(--search-glow-accent-dark)),rgba(0,0,0,0)_60%)]
                                  transition-all duration-2000
                                  group-hover:rotate-[-98deg] group-focus-within:rotate-442" />
                </div>
                {/* Glow layer 3: highlight */}
                <div className="absolute z-[-1] overflow-hidden h-full w-full max-h-[50px] rounded-lg blur-[2px] dark:opacity-50">
                  <div className="absolute w-[600px] h-[600px] bg-no-repeat top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-70
                                  bg-[conic-gradient(rgba(0,0,0,0)_0%,hsl(var(--search-glow-primary-bright)),rgba(0,0,0,0)_8%,rgba(0,0,0,0)_50%,hsl(var(--search-glow-accent-bright)),rgba(0,0,0,0)_58%)]
                                  brightness-140 transition-all duration-2000
                                  group-hover:rotate-[-97deg] group-focus-within:rotate-443" />
                </div>
                <div className="relative flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--search-input-bg))] border border-primary/30 text-muted-foreground text-sm transition-colors">
                  <Search className="w-4 h-4" />
                  <span>Sök överallt...</span>
                  <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">
                    {navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl+K'}
                  </kbd>
                </div>
              </div>
              <RouteBreadcrumbs />
            </div>
            <Button variant="ghost" size="icon" onClick={handleModeToggle} aria-label="Byt tema-läge">
              {mode === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile breadcrumbs (visible only on detail pages where crumbs > 0) */}
        <div data-print-hide className="lg:hidden px-5 pt-3">
          <RouteBreadcrumbs />
        </div>

        {/* pb-24 on mobile leaves room for the fixed BottomTabBar + lifted FAB without
            clipping the last row of content. lg: keeps the regular desktop padding. */}
        <div className="p-5 pb-28 lg:p-6 lg:pb-6 relative z-10" style={{ paddingBottom: 'max(7rem, calc(5rem + env(safe-area-inset-bottom, 0px)))' }}>
          {children}
        </div>
      </main>

      <div data-print-hide>
        <QuickCaptureFAB className={cn(
          "left-4 lg:transition-[left] lg:duration-300",
          "bottom-[72px] lg:bottom-6",
          sidebarCollapsed ? "lg:left-20" : "lg:left-68"
        )} />
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <div data-print-hide>
        <BottomTabBar />
      </div>

      <OnboardingWizard />
    </div></>;
};
