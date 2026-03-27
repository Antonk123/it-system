import { memo, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import { Ticket as TicketType } from '@/types/ticket';
import { TagBadges } from './TagBadges';
import { PriorityBadge } from './PriorityBadge';
import { useCategories } from '@/hooks/useCategories';
import { cn } from '@/lib/utils';
import { Tag } from 'lucide-react';

interface KanbanCardProps {
  ticket: TicketType;
  onTicketClick?: (ticketId: string) => void;
}

export const KanbanCard = memo(function KanbanCard({ ticket, onTicketClick }: KanbanCardProps) {
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

  const handlePointerDown = (e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!pointerStart.current) return;
    const dx = Math.abs(e.clientX - pointerStart.current.x);
    const dy = Math.abs(e.clientY - pointerStart.current.y);
    // Only navigate if pointer barely moved (click, not drag)
    if (dx < 5 && dy < 5) {
      if (onTicketClick) {
        onTicketClick(ticket.id);
      } else {
        navigate(`/tickets/${ticket.id}`);
      }
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
        listeners?.onPointerDown?.(e as any);
      }}
      onClick={handleClick}
      className={cn(
        'p-3 rounded-lg cursor-pointer',
        'bg-card border border-border',
        'hover:border-primary/50 hover:bg-card/80',
        'transition-all duration-200',
        isDragging && 'opacity-50 scale-95 shadow-2xl z-50 ring-2 ring-primary cursor-grabbing'
      )}
    >
      {/* Title */}
      <p className="text-sm font-medium text-foreground line-clamp-2 mb-2.5">
        {ticket.title}
      </p>

      {/* Priority */}
      <div className="mb-2">
        <PriorityBadge priority={ticket.priority} />
      </div>

      {/* Tags */}
      {ticket.tags && ticket.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-2">
          <TagBadges tags={ticket.tags} maxDisplay={2} />
        </div>
      )}

      {/* Category */}
      {ticket.category && (
        <div className="pt-2 border-t border-border">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Tag className="w-3 h-3" />
            {getCategoryLabel(ticket.category)}
          </span>
        </div>
      )}
    </div>
  );
});
