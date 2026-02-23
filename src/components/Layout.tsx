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
  return <div className="min-h-screen flex bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={cn("fixed lg:static inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground flex flex-col transition-transform lg:translate-x-0", sidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="p-6 border-b border-sidebar-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <Ticket className="w-5 h-5 text-sidebar-primary-foreground" />
            </div>
            <span className="font-semibold text-lg text-primary">IT-ärenden</span>
          </div>
          <button className="lg:hidden text-sidebar-foreground" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5 text-secondary-foreground" />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(item => {
          const isActive = location.pathname === item.path;
          return <Link key={item.path} to={item.path} onClick={() => setSidebarOpen(false)} className={cn("flex items-center gap-3 px-4 py-3 rounded-lg transition-colors", isActive ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-primary/5 hover:text-sidebar-accent-foreground")}>
                <item.icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </Link>;
        })}
        </nav>

        <div className="p-4 border-t border-sidebar-border space-y-3">
          <Link to="/tickets/new" onClick={() => setSidebarOpen(false)}>
            <Button className="w-full gap-2" size="lg">
              <Plus className="w-4 h-4" />
              Nytt ärende
            </Button>
          </Link>
          {user && (
            <p className="text-xs text-muted-foreground px-2 truncate">
              {user.email}
            </p>
          )}
          <Button 
            variant="ghost" 
            className="w-full gap-2 text-muted-foreground hover:text-foreground" 
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4" />
            Logga ut
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-30 bg-background border-b p-4 flex items-center gap-4">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <GlobalSearch tickets={tickets} users={users} categories={categories} tags={tags} />
          </div>
        </div>

        {/* Desktop header with search */}
        <div className="hidden lg:block sticky top-0 z-30 bg-background border-b p-4">
          <div className="max-w-md">
            <GlobalSearch tickets={tickets} users={users} categories={categories} tags={tags} />
          </div>
        </div>

        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>;
};
