import { memo, useMemo, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type Announcements,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Ticket as TicketType, User, TicketStatus } from '@/types/ticket';
import { STATUS_LABELS } from '@/lib/constants';
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';

interface KanbanViewProps {
  tickets: TicketType[];
  users: User[];
  onStatusChange: (ticketId: string, status: TicketStatus) => void;
  onTicketClick?: (ticketId: string) => void;
}

const STATUSES: TicketStatus[] = ['open', 'in-progress', 'waiting', 'resolved', 'closed'];

export const KanbanView = memo(function KanbanView({ tickets, users, onStatusChange, onTicketClick }: KanbanViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    // Tangentbords-DnD: Space plockar upp/släpper, piltangenter flyttar, Esc avbryter.
    // Enter lämnas medvetet UTANFÖR (default start/end) så kortet kan öppnas med Enter
    // (se onKeyDown i KanbanCard).
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
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

  // Härled målkolumnens status oavsett om `over` är en kolumn (data.status satt)
  // eller ett kort i en icke-tom kolumn (då saknar over.data.current status —
  // tidigare buggade detta tyst bort släpp på kolumner som redan hade kort).
  const resolveTargetStatus = (over: DragEndEvent['over']): TicketStatus | null => {
    if (!over) return null;
    const data = over.data.current as { status?: TicketStatus } | undefined;
    if (data?.status) return data.status;
    const overId = String(over.id);
    const overTicket = tickets.find(t => t.id === overId);
    if (overTicket) return overTicket.status;
    if (overId.startsWith('column-')) return overId.slice('column-'.length) as TicketStatus;
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;

    const newStatus = resolveTargetStatus(over);
    if (!newStatus) return;

    const ticketId = active.id as string;
    const ticket = tickets.find(t => t.id === ticketId);
    if (ticket && ticket.status !== newStatus) {
      onStatusChange(ticketId, newStatus);
    }
  };

  // Skärmläsar-uppläsning på svenska med ärendetitel + målkolumn (default-texterna
  // läser annars upp råa UUID:n och kolumn-id:n).
  const titleOf = (id: string | number) => tickets.find(t => t.id === id)?.title ?? 'ärendet';
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Plockade upp ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) => {
      const s = resolveTargetStatus(over);
      return s ? `Flyttar ${titleOf(active.id)} till ${STATUS_LABELS[s]}.` : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const s = resolveTargetStatus(over);
      return s
        ? `${titleOf(active.id)} flyttades till ${STATUS_LABELS[s]}.`
        : 'Flytt avbruten.';
    },
    onDragCancel: ({ active }) => `Flytt avbruten. ${titleOf(active.id)} är kvar.`,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        // Default-instruktionen (engelska) säger "press space or enter" — men Enter
        // öppnar nu ärendet, inte plockar upp. Egen svensk instruktion som matchar.
        screenReaderInstructions: {
          draggable:
            'Tryck på mellanslag för att plocka upp ärendet. Använd piltangenterna för att flytta det, mellanslag igen för att släppa, Escape för att avbryta. Tryck Enter för att öppna ärendet.',
        },
      }}
    >
      <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 overflow-x-auto pb-4">
        {STATUSES.map(status => (
          <KanbanColumn
            key={status}
            status={status}
            label={STATUS_LABELS[status]}
            tickets={ticketsByStatus[status]}
            onTicketClick={onTicketClick}
          />
        ))}
      </div>
      <DragOverlay>
        {activeId ? (() => {
          const activeTicket = tickets.find(t => t.id === activeId);
          return activeTicket ? <KanbanCard ticket={activeTicket} /> : null;
        })() : null}
      </DragOverlay>
    </DndContext>
  );
});
