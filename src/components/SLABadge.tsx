import { Badge } from '@/components/ui/badge';
import { Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SLABadgeProps {
  deadline: string | null;
  met: number | null;
  pausedAt: string | null;
  label?: string;
  className?: string;
}

export function SLABadge({ deadline, met, pausedAt, label, className }: SLABadgeProps) {
  if (!deadline) return null;

  // Already resolved
  if (met !== null) {
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
        isWarning && !isUrgent && 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
        className
      )}
    >
      <Clock className="h-3 w-3" />
      {label} {timeText}
    </Badge>
  );
}
