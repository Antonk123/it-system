import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Ticket, BookOpen, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabItems = [
  { path: '/', icon: LayoutDashboard, label: 'Översikt' },
  { path: '/tickets', icon: Ticket, label: 'Ärenden' },
  { path: '/kb', icon: BookOpen, label: 'Kunskapsbas' },
  { path: '/settings', icon: Settings, label: 'Inställningar' },
];

export const BottomTabBar = () => {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <nav
      className={cn(
        'fixed bottom-0 inset-x-0 z-50 md:hidden',
        'h-14 bg-card border-t border-border',
        'pb-[env(safe-area-inset-bottom)]',
        'flex items-stretch'
      )}
    >
      {tabItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.path);
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              'flex-1 min-h-[44px] flex flex-col items-center justify-center gap-0.5',
              'border-t-2 transition-colors',
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground'
            )}
          >
            <Icon className="w-5 h-5" />
            <span className="text-xs font-bold">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
