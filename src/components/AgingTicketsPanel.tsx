import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AgingTicket } from '@/hooks/useDashboardOverview';

interface AgingTicketsPanelProps {
  tickets: AgingTicket[] | undefined;
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

export const AgingTicketsPanel = ({ tickets, isLoading, isError, onRetry }: AgingTicketsPanelProps) => {
  const navigate = useNavigate();

  return (
    <Card aria-busy={isLoading}>
      {/* Skärmläsar-tillkännagivande för asynkron laddning */}
      <span aria-live="polite" className="sr-only">{isLoading ? 'Laddar…' : ''}</span>
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div className="flex items-start gap-2">
          <Clock className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-foreground leading-tight">Åldrande ärenden</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
              Öppna ärenden utan aktivitet, rankade efter tid sedan senaste uppdatering
            </p>
          </div>
        </div>
        {tickets && tickets.length > 5 && (
          <button
            onClick={() => navigate('/tickets?status=open')}
            className="text-xs font-semibold text-primary underline-offset-2 hover:underline shrink-0 ml-2"
          >
            Visa alla
          </button>
        )}
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : isError ? (
          <div className="text-center py-6">
            <p className="text-sm font-semibold text-destructive">Kunde inte hämta eftersläpning</p>
            <button
              onClick={() => onRetry?.()}
              aria-label="Försök igen"
              className="mt-2 text-xs font-medium text-destructive hover:opacity-75 transition-opacity underline-offset-2 hover:underline"
            >
              Försök igen
            </button>
          </div>
        ) : !tickets || tickets.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm font-semibold text-muted-foreground">Ingen eftersläpning</p>
            <p className="text-xs text-muted-foreground mt-1">Alla öppna ärenden är nyligen uppdaterade.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {tickets.slice(0, 5).map((ticket) => (
              <div
                key={ticket.id}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
                className={cn(
                  'flex items-center gap-3 px-1 py-2 rounded-md cursor-pointer',
                  'hover:bg-muted/40 transition-colors duration-150',
                  ticket.age_days >= 14 && 'border-l-2 border-l-destructive/60',
                  ticket.age_days >= 7 && ticket.age_days < 14 && 'border-l-2 border-l-[hsl(var(--priority-high))]/50'
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate" title={ticket.title}>
                    {ticket.title}
                  </p>
                  {ticket.requester_name && (
                    <p className="text-xs text-muted-foreground truncate">{ticket.requester_name}</p>
                  )}
                </div>
                <span className="text-xs font-semibold tabular-nums text-muted-foreground w-16 text-right shrink-0">
                  {ticket.age_days} {ticket.age_days === 1 ? 'dag' : 'dagar'}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs font-semibold uppercase tracking-wider shrink-0',
                    ticket.priority === 'critical' && 'border-[hsl(var(--priority-critical))] text-[hsl(var(--priority-critical))]',
                    ticket.priority === 'high' && 'border-[hsl(var(--priority-high))] text-[hsl(var(--priority-high))]',
                    ticket.priority === 'medium' && 'border-[hsl(var(--priority-medium))] text-[hsl(var(--priority-medium))]',
                    ticket.priority === 'low' && 'border-[hsl(var(--priority-low))] text-[hsl(var(--priority-low))]'
                  )}
                >
                  {ticket.priority}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
