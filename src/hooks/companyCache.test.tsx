// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CompanyRow, ContactRow, TicketRow } from '@/lib/api';
import { useCompanies, useCompanyDetail } from './useCompanies';
import { useUsers } from './useUsers';
import { useTicketMutations } from './useTicketMutations';

const api = vi.hoisted(() => ({
  getCompanies: vi.fn(), getCompany: vi.fn(), getContacts: vi.fn(),
  createContact: vi.fn(), updateContact: vi.fn(), deleteContact: vi.fn(),
  createTicket: vi.fn(), updateTicket: vi.fn(), deleteTicket: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));

const STAMP = '2026-11-17T10:00:00.000Z';
let contacts: ContactRow[];
let tickets: TicketRow[];
let companies: { id: string; name: string }[];
const clients: QueryClient[] = [];
const contact = (id: string, companyId: string, name = id): ContactRow => ({
  id, name, email: `${id}@example.test`, company_id: companyId, company_name: companyId,
  phone: null, department: null, created_at: STAMP,
});
const ticket = (id: string, companyId: string): TicketRow => ({
  id, title: id, status: 'open', priority: 'medium', company_id: companyId, requester_id: 'contact-a',
  category_id: null, assigned_to: null, created_at: STAMP, updated_at: STAMP, resolved_at: null, closed_at: null,
});
const companyRows = (): CompanyRow[] => companies.map(company => ({
  ...company, org_number: null, email: null, phone: null, address: null, created_at: STAMP, updated_at: STAMP,
  contact_count: contacts.filter(contact => contact.company_id === company.id).length,
  open_ticket_count: tickets.filter(ticket => ticket.company_id === company.id && !['closed', 'resolved'].includes(ticket.status)).length,
  total_ticket_count: tickets.filter(ticket => ticket.company_id === company.id).length,
}));

beforeEach(() => {
  vi.resetAllMocks();
  contacts = [contact('contact-a', 'company-a')];
  tickets = [ticket('ticket-a', 'company-a')];
  companies = [{ id: 'company-a', name: 'Alpha AB' }, { id: 'company-b', name: 'Beta AB' }];
  api.getCompanies.mockImplementation(async () => companyRows());
  api.getCompany.mockImplementation(async (id: string) => {
    const company = companyRows().find(company => company.id === id)!;
    return { ...company, contacts: contacts.filter(contact => contact.company_id === id).map(contact => ({ ...contact })),
      stats: { total: company.total_ticket_count, open_count: company.open_ticket_count, closed_count: 0, avg_resolution_days: null } };
  });
  api.getContacts.mockImplementation(async () => contacts.map(contact => ({ ...contact })));
  api.createContact.mockImplementation(async (data: Partial<ContactRow>) => {
    const created = { ...contact('created-contact', data.company_id!), ...data };
    contacts.push(created);
    return { ...created };
  });
  api.updateContact.mockImplementation(async (id: string, updates: Partial<ContactRow>) => {
    contacts = contacts.map(contact => contact.id === id ? { ...contact, ...updates } : contact);
  });
  api.deleteContact.mockImplementation(async (id: string) => { contacts = contacts.filter(contact => contact.id !== id); });
  api.createTicket.mockImplementation(async (data: Partial<TicketRow>) => {
    const created = { ...ticket('created-ticket', data.company_id!), ...data };
    tickets.push(created);
    return { ...created };
  });
  api.updateTicket.mockImplementation(async (id: string, updates: Partial<TicketRow>) => {
    tickets = tickets.map(ticket => ticket.id === id ? { ...ticket, ...updates } : ticket);
    return { ...tickets.find(ticket => ticket.id === id)! };
  });
  api.deleteTicket.mockImplementation(async (id: string) => { tickets = tickets.filter(ticket => ticket.id !== id); });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const rendered = renderHook(() => ({
    list: useCompanies().companies,
    alpha: useCompanyDetail('company-a').company,
    beta: useCompanyDetail('company-b').company,
    contacts: useUsers({ enabled: false }),
    tickets: useTicketMutations(),
  }), { wrapper });
  await waitFor(() => {
    expect(rendered.result.current.list).toHaveLength(2);
    expect(rendered.result.current.alpha?.contacts).toHaveLength(1);
    expect(rendered.result.current.beta?.contacts).toHaveLength(0);
  });
  // Every real company query is still within its two/five minute staleTime.
  expect(client.getQueryCache().getAll().filter(query => query.queryKey[0] === 'companies').every(query => !query.isStale())).toBe(true);
  return rendered;
}

describe('mounted company list/detail caches after contact writes', () => {
  it('refetches contacts and the company list count after creating a contact', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.contacts.addUser({ name: 'Ny kontakt', email: 'new@example.test', company_id: 'company-a' }); });
    await waitFor(() => {
      expect(result.current.alpha?.contacts.map(contact => contact.name)).toContain('Ny kontakt');
      expect(result.current.list.find(company => company.id === 'company-a')?.contact_count).toBe(2);
    });
  });

  it('refreshes both old and new company details/counts after moving a contact', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.contacts.updateUser('contact-a', { company_id: 'company-b' }); });
    await waitFor(() => {
      expect(result.current.alpha?.contacts).toHaveLength(0);
      expect(result.current.beta?.contacts.map(contact => contact.id)).toEqual(['contact-a']);
      expect(result.current.list.map(company => company.contact_count)).toEqual([0, 1]);
    });
  });

  it('refreshes embedded contact names after updating a contact', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.contacts.updateUser('contact-a', { name: 'Nytt namn', company_id: 'company-a' }); });
    await waitFor(() => expect(result.current.alpha?.contacts[0].name).toBe('Nytt namn'));
  });

  it('removes a deleted contact from company details and list counts', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.contacts.deleteUser('contact-a'); });
    await waitFor(() => {
      expect(result.current.alpha?.contacts).toHaveLength(0);
      expect(result.current.list[0].contact_count).toBe(0);
    });
  });

  it('refreshes company data through the contacts refetch path used after CSV import', async () => {
    const { result } = await setup();
    // CSV import can create a company even when an individual contact fails.
    companies.push({ id: 'company-c', name: 'Import AB' });
    contacts.push(contact('imported-contact', 'company-a'));
    act(() => result.current.contacts.refetch());
    await waitFor(() => {
      expect(result.current.list.map(company => company.name)).toContain('Import AB');
      expect(result.current.alpha?.contacts).toHaveLength(2);
      expect(result.current.list[0].contact_count).toBe(2);
    });
  });
});

describe('mounted company list/detail caches after ticket writes', () => {
  it('refreshes totals and open counts after creating a ticket', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.tickets.addTicket({ title: 'Nytt ärende', description: '', status: 'open', priority: 'medium', requesterId: 'contact-a', company_id: 'company-a' }); });
    await waitFor(() => {
      expect(result.current.alpha?.stats).toMatchObject({ total: 2, open_count: 2 });
      expect(result.current.list[0]).toMatchObject({ total_ticket_count: 2, open_ticket_count: 2 });
    });
  });

  it('refreshes open counts after a status update', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.tickets.updateTicket('ticket-a', { status: 'closed' }); });
    await waitFor(() => {
      expect(result.current.alpha?.stats).toMatchObject({ total: 1, open_count: 0 });
      expect(result.current.list[0]).toMatchObject({ total_ticket_count: 1, open_ticket_count: 0 });
    });
  });

  it('refreshes both old and new company counts after moving a ticket', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.tickets.updateTicket('ticket-a', { company_id: 'company-b' }); });
    await waitFor(() => {
      expect(result.current.alpha?.stats).toMatchObject({ total: 0, open_count: 0 });
      expect(result.current.beta?.stats).toMatchObject({ total: 1, open_count: 1 });
      expect(result.current.list.map(company => company.total_ticket_count)).toEqual([0, 1]);
    });
  });

  it('refreshes totals and open counts after deleting a ticket', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.tickets.deleteTicket('ticket-a'); });
    await waitFor(() => {
      expect(result.current.alpha?.stats).toMatchObject({ total: 0, open_count: 0 });
      expect(result.current.list[0]).toMatchObject({ total_ticket_count: 0, open_ticket_count: 0 });
    });
  });
});
