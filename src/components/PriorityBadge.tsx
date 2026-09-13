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

// Material-grade swatch: a flat tag with a solid grade bar, not a soft pill —
// priority reads as a specification grade, not a status-of-the-week color.
export const PriorityBadge = ({ priority, className }: PriorityBadgeProps) => {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border-l-2 text-xs font-medium",
      priorityClasses[priority],
      className
    )}>
      {priorityLabels[priority]}
    </span>
  );
};
