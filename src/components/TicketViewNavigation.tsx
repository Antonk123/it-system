import { Link, useLocation } from 'react-router';
import { ticketViews, getTicketScope, ticketTabLink } from '@/lib/ticketNavigation';
import { cn } from '@/lib/utils';

/** Page links, not ARIA tabs: switching views navigates to an existing route. */
export function TicketViewNavigation() {
  const { pathname, search } = useLocation();
  const scope = getTicketScope(pathname, new URLSearchParams(search));
  return (
    <nav aria-label="Ärendevyer" className="flex flex-wrap gap-1 border-b border-border">
      {ticketViews.map((view) => {
        const { id, label } = view;
        const active = scope.tab === id;
        return (
          <Link
            key={id}
            to={ticketTabLink(view, pathname, search)}
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
