// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TicketForm from './TicketForm';

const mocks = vi.hoisted(() => ({
  noop: vi.fn(),
  empty: [] as never[],
  getTicket: vi.fn(),
  getTemplate: vi.fn(),
  refetchCategories: vi.fn(),
  categoriesError: { value: false },
  ticket: { id: 't1', title: 'Skrivaren', description: '<p>Hej</p>', status: 'open', priority: 'medium', requester_id: 'c1',
    template_id: null, created_at: '2026-09-08T10:00:00Z', updated_at: '2026-09-08T10:00:00Z' },
}));
vi.mock('@/lib/api', () => ({ api: { getTicket: mocks.getTicket, getTemplate: mocks.getTemplate } }));
vi.mock('@/hooks/useTicketMutations', () => ({ useTicketMutations: () => ({ addTicket: mocks.noop, updateTicket: mocks.noop }) }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: () => ({ users: mocks.empty }) }));
vi.mock('@/hooks/useSystemUsers', () => ({ useSystemUsers: () => ({ users: mocks.empty }) }));
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: () => ({ companies: mocks.empty }) }));
vi.mock('@/hooks/useCategories', () => ({
  useCategories: () => ({ categories: mocks.empty, addCategory: mocks.noop, isError: mocks.categoriesError.value, refetch: mocks.refetchCategories }),
}));
vi.mock('@/hooks/useTemplates', () => ({ useTemplates: () => ({ templates: mocks.empty }) }));
vi.mock('@/hooks/useTicketAttachments', () => ({ useTicketAttachments: () => ({ attachments: mocks.empty }) }));
vi.mock('@/hooks/useTicketChecklists', () => ({ useTicketChecklists: () => ({ items: mocks.empty }) }));
vi.mock('@/hooks/useChecklistTemplates', () => ({ useChecklistTemplates: () => ({ templates: mocks.empty, fetchTemplates: mocks.noop }) }));
vi.mock('@/components/UserCombobox', () => ({ UserCombobox: () => null }));
vi.mock('@/components/CategoryCombobox', () => ({ CategoryCombobox: () => null }));
vi.mock('@/components/TemplateCombobox', () => ({ TemplateCombobox: () => null }));
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.categoriesError.value = false;
});
afterEach(cleanup);

const renderAt = (url: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/tickets" element={<p>Ärendelista</p>} />
        <Route path="/tickets/new" element={<TicketForm />} />
        <Route path="/tickets/:id/edit" element={<TicketForm />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);
const slow = { timeout: 3000 };

describe('TicketForm felhantering', () => {
  it('redigering: ärendet kunde inte hämtas → felpanel med "Försök igen" som laddar om', async () => {
    mocks.getTicket.mockRejectedValueOnce(new Error('Failed to fetch')).mockRejectedValueOnce(new Error('Failed to fetch'));
    renderAt('/tickets/t1/edit');
    expect(await screen.findByText('Kunde inte hämta ärendet', {}, slow)).toBeInTheDocument();

    mocks.getTicket.mockResolvedValue(mocks.ticket);
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    expect(await screen.findByDisplayValue('Skrivaren', {}, slow)).toBeInTheDocument();
  });

  it('redigering: 404 → "Ärendet finns inte" utan försök-igen', async () => {
    mocks.getTicket.mockRejectedValue(Object.assign(new Error('Ticket not found'), { status: 404 }));
    renderAt('/tickets/t1/edit');
    expect(await screen.findByText('Ärendet finns inte', {}, slow)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Försök igen' })).not.toBeInTheDocument();
  });

  it('redigering hämtar ärendet en enda gång', async () => {
    mocks.getTicket.mockResolvedValue(mocks.ticket);
    renderAt('/tickets/t1/edit');
    expect(await screen.findByDisplayValue('Skrivaren', {}, slow)).toBeInTheDocument();
    expect(mocks.getTicket).toHaveBeenCalledTimes(1);
  });

  it('kategorier som inte kunde hämtas visar notis med "Försök igen"', () => {
    mocks.categoriesError.value = true;
    renderAt('/tickets/new');
    fireEvent.click(screen.getByRole('button', { name: /Detaljer|Fler uppgifter/ }));
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Kunde inte hämta kategorier.');
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    expect(mocks.refetchCategories).toHaveBeenCalled();
  });
});
