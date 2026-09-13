import { TicketStatus } from '@/types/ticket';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: TicketStatus;
  className?: string;
}

const statusLabels: Record<TicketStatus, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

// Literal class strings so Tailwind's scanner can see and generate them —
// a template-interpolated `status-badge-${status}` is invisible to the scanner.
const statusClasses: Record<TicketStatus, string> = {
  'open': 'status-badge-open',
  'in-progress': 'status-badge-in-progress',
  'waiting': 'status-badge-waiting',
  'resolved': 'status-badge-resolved',
  'closed': 'status-badge-closed',
};

export const StatusBadge = ({ status, className }: StatusBadgeProps) => {
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
      statusClasses[status],
      className
    )}>
      {statusLabels[status]}
    </span>
  );
};
