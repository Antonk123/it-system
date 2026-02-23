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

export const PriorityBadge = ({ priority, className }: PriorityBadgeProps) => {
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
      `priority-badge-${priority}`,
      className
    )}>
      {priorityLabels[priority]}
    </span>
  );
};
