// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
const mocks = vi.hoisted(() => ({ useTickets: vi.fn(), exportTickets: vi.fn(async (_query: string) => {}), storageGet: vi.fn() }));
vi.mock('@/hooks/useTickets', () => ({ useTickets: mocks.useTickets }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: () => ({ users: [] }) }));
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: () => ({ companies: [] }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', role: 'admin' } }) }));
vi.mock('@/lib/api', () => ({ api: { exportTickets: mocks.exportTickets } }));
vi.mock('@/components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/ImportDialog', () => ({ ImportDialog: () => null }));
vi.mock('@/components/TicketTable', () => ({ TicketTable: ({ selectedIds, onSelectionChange }: { selectedIds: string[]; onSelectionChange: (ids: string[]) => void }) => <><button onClick={() => onSelectionChange(['t1'])}>Markera ärende</button><span>Markerade: {selectedIds.length}</span></> }));
vi.mock('@/components/BulkActionBar', () => ({ BulkActionBar: () => null }));
vi.mock('@/components/UnifiedFilterBar', () => ({ UnifiedFilterBar: ({ mine, onMineChange, dateField }: { mine: boolean; onMineChange: (value: boolean) => void; dateField: string }) => <><button onClick={() => onMineChange(!mine)}>Bara mina: {String(mine)}</button><span>Datumfält: {dateField}</span></> }));
import TicketList from './TicketList';
import Archive from './Archive';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.storageGet.mockReturnValue(null);
  vi.stubGlobal('localStorage', { getItem: mocks.storageGet, setItem: vi.fn() });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  mocks.useTickets.mockReturnValue({ tickets: [], pagination: null, isLoading: false, refetch: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(url: string) {
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/tickets" element={<TicketList />} /><Route path="/my-tickets" element={<TicketList />} /><Route path="/archive" element={<Archive />} /></Routes></MemoryRouter>);
}
function query() { return mocks.useTickets.mock.calls.at(-1)![0]; }
async function exported(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  await waitFor(() => expect(mocks.exportTickets).toHaveBeenCalled());
  return new URLSearchParams(mocks.exportTickets.mock.calls[0][0] as string);
}
describe('Ärendesidornas statusflikar och separata personfilter', () => {
  it('läser aldrig sparade filtervyer och använder Aktiva som standard', () => {
    setup('/tickets');
    expect(query().status).toBe('open,in-progress,waiting');
    expect(mocks.storageGet).not.toHaveBeenCalledWith('filter-views');
  });
  it('exporterar exakt samma status, person och övriga filter som listan', async () => {
    setup('/tickets?status=open&mine=1&category=network&priority=high&company_id=co&dateFrom=2026-09-01&dateField=updated_at&checklist=has_checklist&search=wifi');
    expect(query()).toMatchObject({ status: 'open', assigned_to: 'me', category: 'network', dateField: 'updated_at' });
    const params = await exported('Exportera');
    expect(Object.fromEntries(params)).toEqual({ status: 'open', assigned_to: 'me', category: 'network', priority: 'high', company_id: 'co', dateFrom: '2026-09-01', dateField: 'updated_at', checklist: 'has_checklist', search: 'wifi' });
  });
  it('kan avmarkera Bara mina även från den äldre /my-tickets-adressen', async () => {
    setup('/my-tickets?status=waiting&category=network');
    expect(query().assigned_to).toBe('me');
    fireEvent.click(screen.getByRole('button', { name: 'Bara mina: true' }));
    await waitFor(() => expect(query().assigned_to).toBeUndefined());
    expect(query()).toMatchObject({ status: 'waiting', category: 'network' });
  });
  it('rensar markerade ärenden när användaren byter statusflik', async () => {
    mocks.useTickets.mockReturnValue({
      tickets: [{ id: 't1', title: 'Test', status: 'open', priority: 'medium', createdAt: new Date(), updatedAt: new Date() }],
      pagination: null, isLoading: false, refetch: vi.fn(),
    });
    setup('/tickets');
    fireEvent.click(screen.getByRole('button', { name: 'Markera ärende' }));
    expect(screen.getByText('Markerade: 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Öppna' }));
    await waitFor(() => expect(screen.getByText('Markerade: 0')).toBeInTheDocument());
    expect(query().status).toBe('open');
  });
  it('Avslutade inkluderar lösta och stängda och matchar exportens uppdateringsdatum', async () => {
    setup('/archive?status=open&mine=1&dateFrom=2026-09-01&dateField=closed_at');
    expect(query()).toMatchObject({ status: 'resolved,closed', assigned_to: 'me', dateField: 'updated_at', dateFrom: '2026-09-01' });
    expect(screen.getByText('Datumfält: updated_at')).toBeInTheDocument();
    const params = await exported('Exportera Excel');
    expect(Object.fromEntries(params)).toEqual({ status: 'resolved,closed', assigned_to: 'me', dateField: 'updated_at', dateFrom: '2026-09-01' });
  });
});
