import { Badge } from '@/components/ui/badge';
import { Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SLABadgeProps {
  deadline: string | null | undefined;
  met: number | null | undefined;
  pausedAt: string | null | undefined;
  label?: string;
  className?: string;
  ticketStatus?: string;
}

export function SLABadge({ deadline, met, pausedAt, label, className, ticketStatus }: SLABadgeProps) {
  if (!deadline) return null;

  const isClosedOrResolved = ticketStatus === 'closed' || ticketStatus === 'resolved';

  // Already resolved (met is a number: 1 = OK, 0 = breached).
  // Loose != null treats null and undefined alike — an undefined met means
  // "not resolved", so it falls through to the paused/active branches below.
  if (met != null) {
    // På stängda/lösta ärenden — dämpa "Bruten" till historik-färg istället för alarm-rött.
    // SLA-status är fakta att rapportera på, inte ett aktivt larm.
    if (isClosedOrResolved && met === 0) {
      return (
        <Badge variant="outline" className={cn('gap-1 text-muted-foreground border-muted-foreground/30', className)}>
          <AlertTriangle className="h-3 w-3" />
          {label} Bruten
        </Badge>
      );
    }
    return (
      <Badge variant={met === 1 ? 'secondary' : 'destructive'} className={cn('gap-1', className)}>
        {met === 1 ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        {label} {met === 1 ? 'OK' : 'Bruten'}
      </Badge>
    );
  }

  // Paused
  if (pausedAt) {
    return (
      <Badge variant="outline" className={cn('gap-1 text-muted-foreground', className)}>
        <Clock className="h-3 w-3" />
        {label} Pausad
      </Badge>
    );
  }

  // Active — calculate remaining time
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const remainingMs = deadlineDate.getTime() - now.getTime();

  if (remainingMs <= 0) {
    return (
      <Badge variant="destructive" className={cn('gap-1', className)}>
        <AlertTriangle className="h-3 w-3" />
        {label} Överskriden
      </Badge>
    );
  }

  const remainingMinutes = Math.round(remainingMs / 60000);
  const remainingHours = Math.round(remainingMinutes / 60 * 10) / 10;
  const timeText = remainingMinutes > 120 ? `${remainingHours}h` : `${remainingMinutes}m`;

  const isWarning = remainingMinutes < 60;
  const isUrgent = remainingMinutes < 15;

  const variant = isUrgent ? 'destructive' : 'secondary';

  return (
    <Badge
      variant={variant}
      className={cn(
        'gap-1',
        isWarning && !isUrgent && 'bg-[hsl(var(--status-in-progress)/0.2)] text-[hsl(var(--status-in-progress))] border-[hsl(var(--status-in-progress)/0.3)]',
        className
      )}
    >
      <Clock className="h-3 w-3" />
      {label} {timeText}
    </Badge>
  );
}
