import { Link, useLocation } from 'react-router';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navItems, isNavItemActive } from '@/components/navItems';

/**
 * Flikrad som ersätter sidomenyn när IT-System visas inbäddat i Navet.
 * Döljs i fristående läge via CSS (.prefabnavet-embedded-tabs i prefabnavet-theme.css).
 */
export const EmbeddedTabs = () => {
  const { pathname } = useLocation();
  return (
    <div
      data-print-hide
      data-testid="embedded-tabs"
      className="prefabnavet-embedded-tabs sticky top-0 z-30 items-center gap-2 border-b border-border bg-background px-3 py-2"
    >
      <nav aria-label="IT-ärenden" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {navItems.map((item) => {
          const active = isNavItemActive(item.path, pathname);
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <Link
        to="/tickets/new"
        aria-label="Nytt ärende (flikrad)"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Nytt ärende
      </Link>
    </div>
  );
};
