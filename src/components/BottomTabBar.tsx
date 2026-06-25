import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Ticket, Plus, Building2, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabItems = [
  { path: '/', icon: LayoutDashboard, label: 'Översikt' },
  { path: '/tickets', icon: Ticket, label: 'Ärenden' },
  { path: '/tickets/new', icon: Plus, label: 'Nytt' },
  { path: '/companies', icon: Building2, label: 'Företag' },
  { path: '/settings', icon: MoreHorizontal, label: 'Mer' },
];

export const BottomTabBar = () => {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    if (path === '/tickets/new') return location.pathname === '/tickets/new';
    return location.pathname.startsWith(path);
  };

  return (
    <nav
      className={cn(
        'fixed bottom-0 inset-x-0 z-50 lg:hidden',
        'bg-card/95 backdrop-blur-lg border-t border-border',
        'pb-[env(safe-area-inset-bottom)]',
        'overflow-visible',
        'flex items-stretch'
      )}
      style={{ minHeight: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}
      aria-label="Huvudnavigation"
    >
      {tabItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.path);

        if (item.path === '/tickets/new') {
          return (
            <div key={item.path} className="flex-1 flex items-center justify-center relative -mt-3 overflow-visible">
              <Link
                to={item.path}
                aria-current={active ? 'page' : undefined}
                className="flex flex-col items-center justify-center gap-0.5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className={cn(
                  'w-12 h-12 rounded-full flex items-center justify-center shadow-lg -mt-4',
                  active ? 'bg-primary/90' : 'bg-primary'
                )}>
                  <Icon className="w-6 h-6 text-primary-foreground" />
                </div>
                <span className="text-xs font-bold text-primary">{item.label}</span>
              </Link>
            </div>
          );
        }

        return (
          <Link
            key={item.path}
            to={item.path}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex-1 min-h-[44px] flex flex-col items-center justify-center gap-0.5',
              'border-t-2 transition-colors',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
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
