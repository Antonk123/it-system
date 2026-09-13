import { TicketPriority } from '@/types/ticket';
import { cn } from '@/lib/utils';

interface PriorityBadgeProps {
  priority: TicketPriority;
  className?: string;
}

const priorityLabels: Record<TicketPriority, string> = {
  'low': 'Låg',
  'medium': 'Medium',
  'high': 'Hög',
  'critical': 'Kritisk',
};

// Literal class strings so Tailwind's scanner can see and generate them —
// a template-interpolated `priority-badge-${priority}` is invisible to the scanner.
const priorityClasses: Record<TicketPriority, string> = {
  'low': 'priority-badge-low',
  'medium': 'priority-badge-medium',
  'high': 'priority-badge-high',
  'critical': 'priority-badge-critical',
};

export const PriorityBadge = ({ priority, className }: PriorityBadgeProps) => {
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
      priorityClasses[priority],
      className
    )}>
      {priorityLabels[priority]}
    </span>
  );
};
