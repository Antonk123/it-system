// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  noop: vi.fn(),
  getTicket: vi.fn(),
  ticket: { id: 't1', title: 'Testärende', description: '', status: 'open', priority: 'medium', created_at: '2026-09-08T10:00:00Z', updated_at: '2026-09-08T10:00:00Z' },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'agent', role: 'admin' } }) }));
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: () => null }));
vi.mock('@/lib/api', () => ({ api: { getTicket: mocks.getTicket } }));
vi.mock('@/hooks/useTicketMutations', () => ({ useTicketMutations: () => ({ updateTicket: mocks.noop, deleteTicket: mocks.noop }) }));
vi.mock('@/hooks/useCategories', () => ({ useCategories: () => ({ getCategoryLabel: mocks.noop }) }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: () => ({ getUserById: mocks.noop }) }));
vi.mock('@/hooks/useTicketAttachments', () => ({ useTicketAttachments: () => ({ attachments: [], uploadAttachment: mocks.noop }) }));
vi.mock('@/hooks/useTicketChecklists', () => ({ useTicketChecklists: () => ({ items: [] }) }));
vi.mock('@/hooks/useChecklistTemplates', () => ({ useChecklistTemplates: () => ({ templates: [], fetchTemplates: mocks.noop }) }));
vi.mock('@/hooks/useTicketComments', () => ({ useTicketComments: () => ({ comments: [] }) }));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({}) }));
vi.mock('@/hooks/useTicketLinks', () => ({ useTicketLinks: () => ({ links: [] }) }));
vi.mock('@/hooks/useTicketHistory', () => ({ useTicketHistory: () => ({ history: [] }) }));
vi.mock('@/hooks/useTicketReminders', () => ({ useTicketReminders: () => ({ reminders: [], createReminder: mocks.noop }) }));
vi.mock('@/hooks/useTicketSharing', () => ({ useTicketSharing: () => ({ getExistingShare: mocks.noop, setShareUrl: mocks.noop }) }));
vi.mock('@/components/TicketComments', () => ({ TicketComments: () => null }));
vi.mock('@/components/TicketLinks', () => ({ TicketLinks: () => null }));
vi.mock('@/components/TicketActivity', () => ({ TicketActivity: () => null }));
vi.mock('@/components/KBLinksSection', () => ({ KBLinksSection: () => null }));
import TicketDetail from './TicketDetail';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/tickets/t1']}>
      <Routes>
        <Route path="/tickets" element={<p>Ärendelista</p>} />
        <Route path="/tickets/:id" element={<TicketDetail />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);
const slow = { timeout: 3000 };

describe('TicketDetail felhantering', () => {
  it('404: "Ärendet finns inte" med länk till listan och utan försök-igen-knapp', async () => {
    mocks.getTicket.mockRejectedValue(Object.assign(new Error('Ticket not found'), { status: 404 }));
    renderPage();
    expect(await screen.findByText('Ärendet finns inte', {}, slow)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tillbaka till ärenden' })).toHaveAttribute('href', '/tickets');
    expect(screen.queryByRole('button', { name: 'Försök igen' })).not.toBeInTheDocument();
    expect(mocks.getTicket).toHaveBeenCalledTimes(1);
  });

  it('övriga fel: anslutningsfel med "Försök igen" som hämtar ärendet på nytt', async () => {
    mocks.getTicket.mockRejectedValueOnce(new Error('Failed to fetch')).mockRejectedValueOnce(new Error('Failed to fetch'));
    renderPage();
    expect(await screen.findByText('Kunde inte hämta ärendet', {}, slow)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    mocks.getTicket.mockResolvedValue(mocks.ticket);
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    expect(await screen.findByRole('heading', { name: 'Testärende' }, slow)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Kunde inte hämta ärendet')).not.toBeInTheDocument());
  });
});
