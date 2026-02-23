import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Ticket as TicketType, TicketStatus } from '@/types/ticket';
import { KanbanCard } from './KanbanCard';
import { cn } from '@/lib/utils';

interface KanbanColumnProps {
  status: TicketStatus;
  label: string;
  tickets: TicketType[];
}

export function KanbanColumn({ status, label, tickets }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { status },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col bg-muted rounded-lg p-4 min-h-[500px] transition-colors',
        isOver && 'bg-muted/80 ring-2 ring-primary'
      )}
    >
      {/* Column Header */}
      <div className="mb-4 pb-3 border-b">
        <h3 className="font-semibold text-foreground">{label}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {tickets.length} {tickets.length === 1 ? 'ärende' : 'ärenden'}
        </p>
      </div>

      {/* Cards Container */}
      <SortableContext
        items={tickets.map(t => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-3 flex-1">
          {tickets.length > 0 ? (
            tickets.map(ticket => (
              <KanbanCard key={ticket.id} ticket={ticket} />
            ))
          ) : (
            <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
              Inga ärenden
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}
