import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import { useRef } from 'react';
import { Ticket as TicketType } from '@/types/ticket';
import { TagBadges } from './TagBadges';
import { useCategories } from '@/hooks/useCategories';
import { cn } from '@/lib/utils';
import { Tag, AlertCircle, ArrowUp, ArrowDown, Minus, GripVertical } from 'lucide-react';

interface KanbanCardProps {
  ticket: TicketType;
}

const priorityConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  critical: { label: 'Kritisk', color: 'text-red-400 bg-red-400/10 border-red-400/30', icon: AlertCircle },
  high: { label: 'Hög', color: 'text-orange-400 bg-orange-400/10 border-orange-400/30', icon: ArrowUp },
  medium: { label: 'Medium', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', icon: Minus },
  low: { label: 'Låg', color: 'text-blue-400 bg-blue-400/10 border-blue-400/30', icon: ArrowDown },
};

export function KanbanCard({ ticket }: KanbanCardProps) {
  const navigate = useNavigate();
  const { getCategoryLabel } = useCategories();
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: ticket.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priority = priorityConfig[ticket.priority] || priorityConfig.medium;
  const PriorityIcon = priority.icon;

  const handlePointerDown = (e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!pointerStart.current) return;
    const dx = Math.abs(e.clientX - pointerStart.current.x);
    const dy = Math.abs(e.clientY - pointerStart.current.y);
    // Only navigate if pointer barely moved (click, not drag)
    if (dx < 5 && dy < 5) {
      navigate(`/tickets/${ticket.id}`);
    }
    pointerStart.current = null;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        handlePointerDown(e);
        // Call dnd-kit's onPointerDown too
        listeners?.onPointerDown?.(e as any);
      }}
      onClick={handleClick}
      className={cn(
        'p-3 rounded-lg cursor-pointer',
        'bg-[hsl(220_24%_13%)] border border-[hsl(220_20%_20%)]',
        'hover:border-[hsl(175_70%_45%/0.5)] hover:bg-[hsl(220_24%_15%)]',
        'transition-all duration-200',
        isDragging && 'opacity-50 scale-95 shadow-2xl z-50 ring-2 ring-[hsl(175_70%_45%)] cursor-grabbing'
      )}
    >
      {/* Title */}
      <p className="text-sm font-medium text-[hsl(210_20%_95%)] line-clamp-2 mb-2.5">
        {ticket.title}
      </p>

      {/* Priority */}
      <div className="mb-2">
        <span className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border',
          priority.color
        )}>
          <PriorityIcon className="w-3 h-3" />
          {priority.label}
        </span>
      </div>

      {/* Tags */}
      {ticket.tags && ticket.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-2">
          <TagBadges tags={ticket.tags} maxDisplay={2} />
        </div>
      )}

      {/* Category */}
      {ticket.category && (
        <div className="pt-2 border-t border-[hsl(220_20%_20%)]">
          <span className="inline-flex items-center gap-1 text-xs text-[hsl(215_15%_55%)]">
            <Tag className="w-3 h-3" />
            {getCategoryLabel(ticket.category)}
          </span>
        </div>
      )}
    </div>
  );
}
