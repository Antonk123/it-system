// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useTickets, ticketKeys } from './useTickets';
import { statusCountsKeys } from './useStatusCounts';
import { dashboardOverviewKeys } from './useDashboardOverview';
import { activeQueueKeys } from './useActiveQueue';
import { activityFeedKeys } from './useActivityFeed';
import { reportsKeys } from './useReportsSummary';
import { ticketHistoryKeys } from './useTicketHistory';
import { requesterOpenCountsKeys } from './invalidateTicketDerived';

const row = vi.hoisted(() => ({
  id: 't1', title: 'Skrivare', status: 'open', priority: 'medium', category_id: null, requester_id: 'c1',
  company_id: null, assigned_to: null, created_at: '2026-09-08 10:00:00', updated_at: '2026-09-08 10:00:00',
  resolved_at: null, closed_at: null,
}));
const api = vi.hoisted(() => ({
  getTickets: vi.fn(),
  createTicket: vi.fn(),
  updateTicket: vi.fn(),
  deleteTicket: vi.fn(),
  bulkUpdateTickets: vi.fn(),
  bulkDeleteTickets: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));

const derivedKeys = [
  ticketKeys.all,
  statusCountsKeys.all,
  dashboardOverviewKeys.all,
  activeQueueKeys.all,
  activityFeedKeys.all,
  reportsKeys.all,
  requesterOpenCountsKeys.all,
];

let client: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;
let remove: ReturnType<typeof vi.spyOn>;

function setup() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  invalidate = vi.spyOn(client, 'invalidateQueries');
  remove = vi.spyOn(client, 'removeQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useTickets({}, false), { wrapper });
}

const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);

beforeEach(() => {
  vi.clearAllMocks();
  api.createTicket.mockResolvedValue(row);
  api.updateTicket.mockResolvedValue(row);
  api.deleteTicket.mockResolvedValue({ message: 'ok' });
  api.bulkUpdateTickets.mockResolvedValue({ updated: 2 });
  api.bulkDeleteTickets.mockResolvedValue({ deleted: 2 });
});
afterEach(cleanup);

describe('useTickets – härledda queries ogiltigförklaras efter mutation', () => {
  it('skapa: ärendelistor, räknare, dashboard, kö, aktivitet, rapporter och beställarantal', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.addTicket({ title: 'Skrivare', description: '', status: 'open', priority: 'medium', requesterId: 'c1' });
    });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([...derivedKeys, ticketHistoryKeys.ticket('t1')]));
  });

  it('uppdatera: samma nycklar samt ärendets historik', async () => {
    const { result } = setup();
    await act(async () => { await result.current.updateTicket('t1', { status: 'closed' }); });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([...derivedKeys, ticketHistoryKeys.ticket('t1')]));
  });

  it('ta bort: tar bort detaljcachen och ogiltigförklarar härledda nycklar', async () => {
    const { result } = setup();
    await act(async () => { await result.current.deleteTicket('t1'); });
    expect(remove).toHaveBeenCalledWith({ queryKey: ticketKeys.detail('t1') });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([...derivedKeys, ticketHistoryKeys.ticket('t1')]));
  });

  it('massuppdatering: härledda nycklar (ticketKeys.all täcker öppna detaljvyer)', async () => {
    const { result } = setup();
    await act(async () => { await result.current.bulkUpdateTickets(['t1', 't2'], { status: 'open' }); });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining(derivedKeys));
  });

  it('massradering: tar bort detaljcachen för varje id och ogiltigförklarar härledda nycklar', async () => {
    const { result } = setup();
    await act(async () => { await result.current.bulkDeleteTickets(['t1', 't2']); });
    expect(remove).toHaveBeenCalledWith({ queryKey: ticketKeys.detail('t1') });
    expect(remove).toHaveBeenCalledWith({ queryKey: ticketKeys.detail('t2') });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining(derivedKeys));
  });
});

describe('useTickets – felmeddelanden', () => {
  it('403 vid skrivning ger en enda svensk toast', async () => {
    api.updateTicket.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    const { result } = setup();
    await act(async () => { await result.current.updateTicket('t1', { status: 'closed' }).catch(() => undefined); });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Du har inte behörighet att ändra det här ärendet');
  });

  it('massradering som misslyckas visar serverns meddelande en gång', async () => {
    api.bulkDeleteTickets.mockRejectedValue(new Error('Något gick fel'));
    const { result } = setup();
    await act(async () => { await result.current.bulkDeleteTickets(['t1']).catch(() => undefined); });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Något gick fel');
  });
});
