// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { KanbanView } from './KanbanView';
import type { Ticket } from '@/types/ticket';

vi.mock('@/hooks/useCategories', () => ({ useCategories: () => ({ getCategoryLabel: () => '' }) }));
afterEach(cleanup);

const ticket = { id: 't1', title: 'Skrivaren', priority: 'high', status: 'open', createdAt: new Date(), requesterId: 'c1' } as Ticket;

describe('KanbanView', () => {
  it('når onTicketClick via kontext i kortet utan att den skickas genom kolumnen', () => {
    const onTicketClick = vi.fn();
    render(<MemoryRouter><KanbanView tickets={[ticket]} onStatusChange={vi.fn()} onTicketClick={onTicketClick} /></MemoryRouter>);
    fireEvent.keyDown(screen.getByText('Skrivaren'), { key: 'Enter' });
    expect(onTicketClick).toHaveBeenCalledWith('t1');
  });
});
