// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import UserList from './UserList';

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  api: {
    getContactsPage: vi.fn(),
    getContacts: vi.fn(),
    deleteContact: vi.fn(),
    getRequesterOpenCounts: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mocks.api }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/UserTicketHistory', () => ({ UserTicketHistory: () => null }));
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: () => ({ companies: [{ id: 'co1', name: 'Prefab AB' }] }) }));

const contact = (id: string, name: string) => ({
  id, name, email: `${id}@example.com`, phone: null, company_id: null, company_name: null, department: 'IT', created_at: '2026-09-08T10:00:00Z',
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/users']}><UserList /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.getContactsPage.mockResolvedValue({
    data: [contact('c1', 'Anna Andersson'), contact('c2', 'Bo Berg')],
    pagination: { page: 1, limit: 50, total: 2 },
  });
  mocks.api.getContacts.mockResolvedValue([]);
  mocks.api.getRequesterOpenCounts.mockResolvedValue({ c1: 2 });
  mocks.api.deleteContact.mockResolvedValue({ message: 'ok' });
});
afterEach(cleanup);

describe('UserList', () => {
  it('hämtar kontakter sidvis från servern och visar dem', async () => {
    setup();

    expect(await screen.findByText('Anna Andersson')).toBeInTheDocument();
    expect(screen.getByText('Bo Berg')).toBeInTheDocument();
    expect(mocks.api.getContactsPage).toHaveBeenCalledWith({ page: 1, limit: 50, search: '' });
    expect(mocks.api.getContacts).not.toHaveBeenCalled();
    expect(screen.getByText('2 kontakter i systemet')).toBeInTheDocument();
  });

  it('skickar sökningen till servern', async () => {
    setup();
    await screen.findByText('Anna Andersson');

    fireEvent.change(screen.getByPlaceholderText('Sök kontakter...'), { target: { value: 'berg' } });

    await waitFor(() => expect(mocks.api.getContactsPage).toHaveBeenLastCalledWith({ page: 1, limit: 50, search: 'berg' }));
  });

  it('tar bort en kontakt efter bekräftelse och visar ett meddelande', async () => {
    setup();
    await screen.findByText('Anna Andersson');

    fireEvent.click(screen.getAllByRole('button', { name: 'Ta bort kontakt' })[0]);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ta bort' }));

    await waitFor(() => expect(mocks.api.deleteContact).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Kontakt borttagen'));
  });

  it('fångar fel vid borttagning utan unhandled rejection', async () => {
    mocks.api.deleteContact.mockRejectedValue(new Error('Kontakten har ärenden'));
    setup();
    await screen.findByText('Anna Andersson');

    fireEvent.click(screen.getAllByRole('button', { name: 'Ta bort kontakt' })[0]);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Ta bort' }));

    await waitFor(() => expect(mocks.api.deleteContact).toHaveBeenCalled());
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Kunde inte ta bort användare'));
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});
