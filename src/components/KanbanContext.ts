import { createContext, useContext } from 'react';

interface KanbanContextValue {
  onTicketClick?: (ticketId: string) => void;
}

export const KanbanContext = createContext<KanbanContextValue>({});

export const useKanban = () => useContext(KanbanContext);
