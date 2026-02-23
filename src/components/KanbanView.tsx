import { useMemo } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Ticket as TicketType, User, TicketStatus } from '@/types/ticket';
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';

interface KanbanViewProps {
  tickets: TicketType[];
  users: User[];
  onStatusChange: (ticketId: string, status: TicketStatus) => void;
}

const STATUSES: TicketStatus[] = ['open', 'in-progress', 'waiting', 'resolved', 'closed'];
const STATUS_LABELS: Record<TicketStatus, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

export function KanbanView({ tickets, users, onStatusChange }: KanbanViewProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      distance: 8,
    })
  );

  // Group tickets by status
  const ticketsByStatus = useMemo(() => {
    const grouped: Record<TicketStatus, TicketType[]> = {
      'open': [],
      'in-progress': [],
      'waiting': [],
      'resolved': [],
      'closed': [],
    };

    tickets.forEach(ticket => {
      if (ticket.status in grouped) {
        grouped[ticket.status].push(ticket);
      }
    });

    return grouped;
  }, [tickets]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

    // Extract ticket ID and target status from the over data
    const overData = over.data.current as { status: TicketStatus } | undefined;
    if (!overData?.status) return;

    const ticketId = active.id as string;
    const newStatus = overData.status;

    // Find the ticket to check its current status
    const ticket = tickets.find(t => t.id === ticketId);
    if (ticket && ticket.status !== newStatus) {
      onStatusChange(ticketId, newStatus);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 overflow-x-auto pb-4">
        {STATUSES.map(status => (
          <KanbanColumn
            key={status}
            status={status}
            label={STATUS_LABELS[status]}
            tickets={ticketsByStatus[status]}
          />
        ))}
      </div>
      <DragOverlay>
        {/* Overlay content during drag - can be enhanced later */}
      </DragOverlay>
    </DndContext>
  );
}
