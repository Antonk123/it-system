import { useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle, CheckCircle, MessageSquare, ArrowRightLeft, UserPlus } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';
import type { ActivityEvent } from '@/hooks/useActivityFeed';
import { parseServerDate } from '@/lib/date';

interface ActivityFeedPanelProps {
  events: ActivityEvent[] | undefined;
  isLoading: boolean;
}

function getEventIcon(event: ActivityEvent) {
  if (event.field_name === 'created') {
    return { icon: Plus, className: 'border-primary/50 bg-primary/15 text-primary' };
  }
  if (event.field_name === 'status' && (event.new_value === 'resolved' || event.new_value === 'closed')) {
    return { icon: CheckCircle, className: 'border-[hsl(var(--status-resolved))]/50 bg-[hsl(var(--status-resolved))]/15 text-[hsl(var(--status-resolved))]' };
  }
  if (event.field_name === 'priority' && (event.new_value === 'critical' || event.new_value === 'high')) {
    return { icon: AlertTriangle, className: 'border-[hsl(var(--priority-high))]/50 bg-[hsl(var(--priority-high))]/15 text-[hsl(var(--priority-high))]' };
  }
  if (event.field_name === 'assigned_to') {
    return { icon: UserPlus, className: 'border-border bg-card text-muted-foreground' };
  }
  if (event.field_name === 'status') {
    return { icon: ArrowRightLeft, className: 'border-border bg-card text-muted-foreground' };
  }
  return { icon: MessageSquare, className: 'border-border bg-card text-muted-foreground' };
}

function getEventDescription(event: ActivityEvent): string {
  const user = event.user_name || 'System';

  if (event.field_name === 'created') {
    const via = event.new_value === 'email' ? ' via e-post' :
                event.new_value?.startsWith('recurring:') ? ' (återkommande)' : '';
    return `${user} skapade ärende${via}`;
  }

  const statusLabels: Record<string, string> = {
    'open': 'Öppen',
    'in-progress': 'Pågående',
    'waiting': 'Väntar',
    'resolved': 'Löst',
    'closed': 'Stängt',
  };

  if (event.field_name === 'status') {
    const from = statusLabels[event.old_value ?? ''] || event.old_value;
    const to = statusLabels[event.new_value ?? ''] || event.new_value;
    return `${user} ändrade status: ${from} → ${to}`;
  }

  if (event.field_name === 'priority') {
    return `${user} ändrade prioritet: ${event.old_value} → ${event.new_value}`;
  }

  if (event.field_name === 'assigned_to') {
    return `${user} tilldelade ärendet`;
  }

  return `${user} uppdaterade ${event.field_name}`;
}

export const ActivityFeedPanel = ({ events, isLoading }: ActivityFeedPanelProps) => {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Aktivitet</p>
          <span className="font-mono text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
            senaste
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-5 pb-4 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="w-7 h-7 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !events || events.length === 0 ? (
          <div className="text-center py-8 px-5">
            <p className="text-sm font-medium text-muted-foreground">Ingen aktivitet ännu</p>
          </div>
        ) : (
          <div className="pb-2">
            {events.slice(0, 10).map((event, idx) => {
              const { icon: Icon, className: iconClass } = getEventIcon(event);
              const isLast = idx === Math.min(events.length, 10) - 1;

              return (
                <div
                  key={event.id}
                  className="group grid grid-cols-[28px_1fr] gap-3 px-5 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors relative"
                  onClick={() => event.ticket_id && navigate(`/tickets/${event.ticket_id}`)}
                >
                  {/* Timeline connector */}
                  {!isLast && (
                    <div className="absolute left-[33px] top-[34px] bottom-[-2px] w-px bg-border/60" />
                  )}

                  {/* Icon */}
                  <div className={cn(
                    'w-7 h-7 rounded-full border flex items-center justify-center z-10 relative',
                    iconClass
                  )}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>

                  {/* Content */}
                  <div className="min-w-0">
                    <p className="text-[13px] leading-snug text-foreground/90">
                      {getEventDescription(event)}
                      {event.ticket_title && (
                        <>
                          {' · '}
                          <span className="font-mono text-[11px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            {event.ticket_title}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="font-mono text-[10.5px] text-muted-foreground mt-1 tracking-wide">
                      {formatDistanceToNow(parseServerDate(event.changed_at), { addSuffix: true, locale: sv })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
