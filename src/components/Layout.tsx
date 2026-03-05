import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Ticket, Archive, Users, Plus, Menu, X, LogOut, Settings, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { GlobalSearch } from '@/components/GlobalSearch';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useCategories } from '@/hooks/useCategories';
import { useTags } from '@/hooks/useTags';
import { useAuth } from '@/contexts/AuthContext';

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
  path: '/reports',
  icon: BarChart3,
  label: 'Rapporter'
}, {
  path: '/archive',
  icon: Archive,
  label: 'Arkiv'
}, {
  path: '/users',
  icon: Users,
  label: 'Kontakter'
}, {
  path: '/settings',
  icon: Settings,
  label: 'Inställningar'
}];
export const Layout = ({
  children
}: LayoutProps) => {
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { tickets } = useTickets({ page: 1, limit: 100 });
  const { users } = useUsers();
  const { categories } = useCategories();
  const { tags } = useTags();
  const { signOut, user } = useAuth();

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
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden animate-fade-in" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar with enhanced styling */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 w-64 flex flex-col transition-all duration-300 lg:translate-x-0",
        "bg-gradient-to-b from-sidebar via-sidebar to-sidebar-accent",
        "border-r border-sidebar-border/50 backdrop-blur-xl",
        sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      )}>
        {/* Geometric corner accent */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/10 to-transparent rounded-bl-full opacity-50"></div>

        <div className="p-6 flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/25 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <Ticket className="w-6 h-6 text-white relative z-10" />
            </div>
            <span className="font-bold text-xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">IT-ärenden</span>
          </div>
          <button className="lg:hidden text-sidebar-foreground hover:text-primary transition-colors" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2 relative z-10">
          {navItems.map((item, index) => {
          const isActive = location.pathname === item.path;
          return <Link
            key={item.path}
            to={item.path}
            onClick={() => setSidebarOpen(false)}
            className={cn(
              "flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 animate-slide-in-right group relative overflow-hidden",
              isActive
                ? "bg-gradient-to-r from-primary/15 to-accent/10 text-primary shadow-lg shadow-primary/10 border border-primary/20"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary border border-transparent"
            )}
            style={{ animationDelay: `${index * 50}ms` }}
          >
                {/* Hover effect gradient */}
                {!isActive && (
                  <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                )}

                {/* Active indicator bar */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-primary to-accent rounded-r"></div>
                )}

                <item.icon className={cn(
                  "w-5 h-5 relative z-10 transition-transform duration-300",
                  isActive ? "scale-110" : "group-hover:scale-110"
                )} />
                <span className="font-semibold relative z-10">{item.label}</span>
              </Link>;
        })}
        </nav>

        <div className="p-4 border-t border-sidebar-border/50 space-y-3 relative z-10 bg-sidebar-accent/30 backdrop-blur-sm">
          <Link to="/tickets/new" onClick={() => setSidebarOpen(false)}>
            <Button className="w-full gap-2 bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 shadow-lg shadow-primary/25 border-0 font-semibold relative overflow-hidden group" size="lg">
              <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <Plus className="w-5 h-5 relative z-10 group-hover:rotate-90 transition-transform duration-300" />
              <span className="relative z-10">Nytt ärende</span>
            </Button>
          </Link>
          {user && (
            <div className="px-3 py-2 rounded-lg bg-background/20 border border-border/30">
              <p className="text-xs text-muted-foreground truncate flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary/60 animate-pulse"></span>
                {user.email}
              </p>
            </div>
          )}
          <Button
            variant="ghost"
            className="w-full gap-2 text-muted-foreground hover:text-foreground hover:bg-destructive/10 transition-all duration-200"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4" />
            Logga ut
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 relative">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50 p-4 flex items-center gap-4 shadow-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-primary/10 transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <GlobalSearch tickets={tickets} users={users} categories={categories} tags={tags} />
          </div>
        </div>

        {/* Desktop header with search */}
        <div className="hidden lg:block sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/50 p-4 shadow-sm">
          <div className="max-w-md relative">
            <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-primary to-accent rounded-r opacity-50"></div>
            <GlobalSearch tickets={tickets} users={users} categories={categories} tags={tags} />
          </div>
        </div>

        <div className="p-6 lg:p-8 relative z-10">
          {children}
        </div>
      </main>
    </div>;
};
