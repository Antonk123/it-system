import { Link, useLocation } from 'react-router';
import { ticketViews } from '@/lib/ticketNavigation';
import { cn } from '@/lib/utils';

/** Page links, not ARIA tabs: switching views navigates to an existing route. */
export function TicketViewNavigation() {
  const { pathname, search } = useLocation();
  return (
    <nav aria-label="Ärendevyer" className="flex flex-wrap gap-1 border-b border-border">
      {ticketViews.map(({ path, label }) => {
        const active = pathname === path;
        return (
          <Link
            key={path}
            to={active ? `${path}${search}` : path}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center border-b-2 px-4 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
