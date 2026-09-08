// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  noop: vi.fn(),
  lookupShare: vi.fn(async () => null),
  createShare: vi.fn(),
  deleteTicket: vi.fn(),
  ticket: { id: 't1', title: 'Testärende', description: '', status: 'open', priority: 'medium', created_at: '2026-09-08T10:00:00Z', updated_at: '2026-09-08T10:00:00Z' },
}));
vi.mock('@/lib/api', () => ({ api: { getTicket: async () => mocks.ticket } }));
vi.mock('@/hooks/useTicketMutations', () => ({ useTicketMutations: () => ({ updateTicket: mocks.noop, deleteTicket: mocks.deleteTicket }) }));
vi.mock('@/hooks/useCategories', () => ({ useCategories: () => ({ getCategoryLabel: mocks.noop }) }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: () => ({ getUserById: mocks.noop }) }));
vi.mock('@/hooks/useTicketAttachments', () => ({ useTicketAttachments: () => ({ attachments: [], fetchAttachments: mocks.noop }) }));
vi.mock('@/hooks/useTicketChecklists', () => ({ useTicketChecklists: () => ({ items: [], fetchChecklists: mocks.noop }) }));
vi.mock('@/hooks/useChecklistTemplates', () => ({ useChecklistTemplates: () => ({ templates: [], fetchTemplates: mocks.noop }) }));
vi.mock('@/hooks/useTicketComments', () => ({ useTicketComments: () => ({ comments: [] }) }));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({}) }));
vi.mock('@/hooks/useTicketLinks', () => ({ useTicketLinks: () => ({ links: [] }) }));
vi.mock('@/hooks/useTicketHistory', () => ({ useTicketHistory: () => ({ history: [] }) }));
vi.mock('@/hooks/useTicketReminders', () => ({ useTicketReminders: () => ({ reminders: [], createReminder: mocks.noop }) }));
vi.mock('@/hooks/useTicketSharing', () => ({ useTicketSharing: () => ({ getExistingShare: mocks.lookupShare, createShareLink: mocks.createShare, setShareUrl: mocks.noop }) }));
vi.mock('@/components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/TicketComments', () => ({ TicketComments: () => null }));
vi.mock('@/components/TicketLinks', () => ({ TicketLinks: () => null }));
vi.mock('@/components/TicketActivity', () => ({ TicketActivity: () => null }));
vi.mock('@/components/KBLinksSection', () => ({ KBLinksSection: () => null }));
vi.mock('@/components/TagSelector', () => ({ TagSelector: () => null }));
import TicketDetail from './TicketDetail';

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function setup(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: width >= 640, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/tickets/t1']}><Routes><Route path="/tickets/new" element={<p>Nytt ärende</p>} /><Route path="/tickets/:id" element={<TicketDetail />} /></Routes></MemoryRouter></QueryClientProvider>);
  const trigger = await screen.findByRole('button', { name: 'Fler åtgärder' });
  return trigger;
}
async function openMenu(trigger: HTMLElement) {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menu');
}

describe('TicketDetail gemensam åtgärdsmeny', () => {
  it.each([375, 640, 1024])('delning fungerar med tangentbord vid %ipx och återställer fokus', async width => {
    const trigger = await setup(width);
    expect(screen.getByRole('button', { name: 'Redigera ärende' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Påminn mig' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dela' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tid' })).not.toBeInTheDocument();
    await openMenu(trigger);
    const share = screen.getByRole('menuitem', { name: 'Dela' });
    share.focus();
    fireEvent.keyDown(share, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'Dela ärende' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(mocks.lookupShare).toHaveBeenCalledWith('t1');
    expect(mocks.createShare).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it('låter Escape stänga menyn och Klona öppna nytt ärende', async () => {
    const trigger = await setup(1024);
    const menu = await openMenu(trigger);
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    await openMenu(trigger);
    const clone = screen.getByRole('menuitem', { name: 'Klona' });
    clone.focus();
    fireEvent.keyDown(clone, { key: 'Enter' });
    expect(await screen.findByText('Nytt ärende')).toBeInTheDocument();
  });
  it('kräver bekräftelse för radering och återställer fokus efter Avbryt', async () => {
    const trigger = await setup(1024);
    await openMenu(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ta bort' }));
    await screen.findByRole('alertdialog', { name: 'Ta bort ärende' });
    expect(mocks.deleteTicket).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mocks.deleteTicket).not.toHaveBeenCalled();
  });
});
