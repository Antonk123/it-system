// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { UserTicketHistory } from './UserTicketHistory';

const mocks = vi.hoisted(() => ({
  useTickets: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@/hooks/useTickets', () => ({ useTickets: mocks.useTickets }));

const ticket = (id: string, status = 'open') => ({
  id, title: `Ärende ${id}`, status, priority: 'medium', createdAt: new Date('2026-09-08T10:00:00Z'),
});
const result = (over: Record<string, unknown>) => ({
  tickets: [], pagination: null, isLoading: false, isError: false, refetch: mocks.refetch, ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const renderHistory = () => render(<MemoryRouter><UserTicketHistory userId="c1" /></MemoryRouter>);

describe('UserTicketHistory', () => {
  it('visar fel med "Försök igen" i stället för "Inga ärenden kopplade"', () => {
    mocks.useTickets.mockReturnValue(result({ isError: true }));
    renderHistory();
    expect(screen.getByRole('alert')).toHaveTextContent('Kunde inte hämta ärenden');
    expect(screen.queryByText(/Inga ärenden kopplade/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('begär 100 åt gången och hämtar fler på begäran', () => {
    mocks.useTickets.mockReturnValue(result({
      tickets: [ticket('a'), ticket('b')],
      pagination: { page: 1, limit: 100, total: 250, totalPages: 3, hasNext: true, hasPrev: false },
    }));
    renderHistory();
    expect(mocks.useTickets).toHaveBeenLastCalledWith({ requester_id: 'c1', status: 'all', page: 1, limit: 100 });
    expect(screen.getByText('Visar 2 av 250 ärenden')).toBeInTheDocument();
    expect(screen.getByText('250 Totalt')).toBeInTheDocument();
    expect(screen.queryByText(/Öppna$/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Visa fler' }));
    expect(mocks.useTickets).toHaveBeenLastCalledWith({ requester_id: 'c1', status: 'all', page: 1, limit: 200 });
  });

  it('visar statusfördelning och ingen "Visa fler" när alla ärenden är laddade', () => {
    mocks.useTickets.mockReturnValue(result({
      tickets: [ticket('a'), ticket('b', 'closed')],
      pagination: { page: 1, limit: 100, total: 2, totalPages: 1, hasNext: false, hasPrev: false },
    }));
    renderHistory();
    expect(screen.getByText('1 Öppna')).toBeInTheDocument();
    expect(screen.getByText('1 Stängda')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Visa fler' })).not.toBeInTheDocument();
  });
});
