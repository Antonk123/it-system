import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LayoutDashboard, Ticket, Archive, Users, Plus, Menu, X, LogOut, Settings, BarChart3, ChevronsRight, BookOpen, RefreshCw, Sun, Moon, Search, Building2, Receipt } from 'lucide-react';
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
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg">
          <Ticket className="w-6 h-6 text-white" />
        </div>

        {open && (
          <div className="transition-opacity duration-200">
            <span className="block text-sm font-semibold text-sidebar-foreground">
              IT-ärenden
            </span>
            <span className="block text-xs text-muted-foreground">
              Ticket System
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
          "bg-gradient-to-r from-primary to-accent text-white",
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
  return <div className="min-h-screen flex bg-background relative overflow-hidden">
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
          tabIndex={-1}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden animate-fade-in cursor-default"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar with collapsible design */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 ease-in-out",
        "bg-sidebar border-r border-sidebar-border",
        // Mobile
        sidebarOpen ? "translate-x-0 w-64 shadow-2xl" : "-translate-x-full lg:translate-x-0",
        // Desktop collapsible
        "lg:w-64",
        sidebarCollapsed && "lg:w-16"
      )}>
        {/* Close button for mobile */}
        <button
          className="lg:hidden absolute top-3 right-3 text-sidebar-foreground hover:text-primary transition-colors z-20 inline-flex items-center justify-center h-10 w-10 rounded-md hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      <main className="flex-1 min-w-0 relative">
        {/* Mobile header */}
        <div data-print-hide className="lg:hidden sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50 p-4 flex items-center gap-4 shadow-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-primary/10 transition-colors"
            aria-label="Öppna meny"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex w-full items-center gap-2 px-3 py-2 rounded-lg border border-border/50 text-muted-foreground text-sm hover:bg-muted/50 transition-colors"
            >
              <Search className="w-4 h-4" />
              <span>Sök...</span>
            </button>
          </div>
          <Button variant="ghost" size="icon" onClick={handleModeToggle} aria-label="Byt tema-läge">
            {mode === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
        </div>

        {/* Desktop header with search */}
        <div data-print-hide className="hidden lg:block sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
              <button
                onClick={() => setPaletteOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border/50 text-muted-foreground text-sm hover:bg-muted/50 transition-colors w-72 shrink-0"
              >
                <Search className="w-4 h-4" />
                <span>Sök ärenden, artiklar, sidor...</span>
                <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">
                  {navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl+K'}
                </kbd>
              </button>
              <RouteBreadcrumbs />
            </div>
            <Button variant="ghost" size="icon" onClick={handleModeToggle} aria-label="Byt tema-läge">
              {mode === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        <motion.div
          key={location.pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="p-5 pb-20 md:pb-5 lg:p-6 relative z-10"
        >
          {children}
        </motion.div>
      </main>

      <div data-print-hide>
        <QuickCaptureFAB className={cn(
          "left-4 lg:transition-[left] lg:duration-300",
          "bottom-[72px] md:bottom-6",
          sidebarCollapsed ? "lg:left-20" : "lg:left-[17rem]"
        )} />
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <div data-print-hide>
        <BottomTabBar />
      </div>

      <OnboardingWizard />
    </div>;
};
