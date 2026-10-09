// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Archive from './Archive';

const mocks = vi.hoisted(() => ({
  setSelectedIds: vi.fn(),
  refetch: vi.fn(),
  bulkUpdateTickets: vi.fn(),
  bulkDeleteTickets: vi.fn(),
  tickets: { value: [] as { id: string; status: string }[] },
  isError: { value: false },
}));

vi.mock('@/hooks/useTickets', () => ({
  useTickets: () => ({
    tickets: mocks.tickets.value, pagination: null, isLoading: false, isError: mocks.isError.value,
    bulkUpdateTickets: mocks.bulkUpdateTickets, bulkDeleteTickets: mocks.bulkDeleteTickets, refetch: mocks.refetch,
  }),
}));
vi.mock('@/hooks/useTicketListNavigation', () => ({
  useTicketListNavigation: () => ({
    searchParams: new URLSearchParams('page=1&limit=10'), setSearchParams: vi.fn(), statuses: ['resolved', 'closed'],
    mine: false, page: 1, pageSize: 10, search: '', priorityFilter: 'all', categoryFilter: 'all', checklistFilter: '',
    dateField: 'updated_at', sortKey: 'createdAt', sortDirection: 'desc', dateFrom: '', dateTo: '', companyFilter: 'all',
    selectedIds: ['a', 'b'], setSelectedIds: mocks.setSelectedIds, updateFilters: vi.fn(), handlePageChange: vi.fn(),
    handlePageSizeChange: vi.fn(), handleSortChange: vi.fn(), handleTicketClick: vi.fn(),
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: () => ({ companies: [] }) }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: () => ({ users: [] }) }));
vi.mock('@/components/TicketViewNavigation', () => ({ TicketViewNavigation: () => null }));
vi.mock('@/components/UnifiedFilterBar', () => ({ UnifiedFilterBar: () => null }));
vi.mock('@/components/ImportDialog', () => ({ ImportDialog: () => null }));
vi.mock('@/components/TicketTable', () => ({ TicketTable: () => <p>tabell</p> }));
vi.mock('@/components/BulkActionBar', () => ({
  BulkActionBar: ({ onReopen, onDeletePermanently }: { onReopen: () => void; onDeletePermanently: () => void }) => (
    <>
      <button onClick={onReopen}>Öppna igen</button>
      <button onClick={onDeletePermanently}>Radera</button>
    </>
  ),
}));
vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tickets.value = [{ id: 'a', status: 'closed' }, { id: 'b', status: 'resolved' }];
  mocks.isError.value = false;
  mocks.bulkUpdateTickets.mockResolvedValue({ updated: 2 });
  mocks.bulkDeleteTickets.mockResolvedValue({ deleted: 2 });
});
afterEach(cleanup);

const renderPage = () => render(<MemoryRouter><Archive /></MemoryRouter>);

describe('Avslutade ärenden', () => {
  it('visar felpanel med "Försök igen" när listan inte kunde hämtas', () => {
    mocks.isError.value = true;
    mocks.tickets.value = [];
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Kunde inte hämta avslutade ärenden');
    expect(screen.queryByText('Inga avslutade ärenden ännu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('öppnar markerade ärenden igen via useTickets och rensar markeringen', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Öppna igen' }));
    await waitFor(() => expect(mocks.setSelectedIds).toHaveBeenCalledWith([]));
    expect(mocks.bulkUpdateTickets).toHaveBeenCalledWith(['a', 'b'], { status: 'open' });
  });

  it('raderar markerade ärenden via useTickets (som tar bort detaljcachen)', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Radera' }));
    await waitFor(() => expect(mocks.setSelectedIds).toHaveBeenCalledWith([]));
    expect(mocks.bulkDeleteTickets).toHaveBeenCalledWith(['a', 'b']);
  });

  it('behåller markeringen när massåtgärden misslyckas (hooken visar felet)', async () => {
    mocks.bulkDeleteTickets.mockRejectedValue(new Error('nej'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Radera' }));
    await waitFor(() => expect(mocks.bulkDeleteTickets).toHaveBeenCalled());
    expect(mocks.setSelectedIds).not.toHaveBeenCalledWith([]);
  });
});
