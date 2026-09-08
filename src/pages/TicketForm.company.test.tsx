// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import TicketForm from './TicketForm';

const data = vi.hoisted(() => ({
  contacts: [
    { id: 'a', name: 'Anna', email: 'anna@example.com', company_id: 'company-a', company_name: 'Bolag A', createdAt: new Date() },
    { id: 'b', name: 'Bertil', email: 'bertil@example.com', createdAt: new Date() },
  ],
  empty: [], noop: vi.fn(),
}));
vi.mock('@/hooks/useTicketMutations', () => ({ useTicketMutations: () => ({ addTicket: data.noop, updateTicket: data.noop }) }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: () => ({ users: data.contacts }) }));
vi.mock('@/hooks/useSystemUsers', () => ({ useSystemUsers: () => ({ users: data.empty }) }));
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: () => ({ companies: [{ id: 'company-a', name: 'Bolag A' }] }) }));
vi.mock('@/hooks/useCategories', () => ({ useCategories: () => ({ categories: data.empty, addCategory: data.noop }) }));
vi.mock('@/hooks/useTemplates', () => ({ useTemplates: () => ({ templates: data.empty }) }));
vi.mock('@/hooks/useTicketAttachments', () => ({ useTicketAttachments: () => ({ attachments: data.empty, fetchAttachments: data.noop }) }));
vi.mock('@/hooks/useTicketChecklists', () => ({ useTicketChecklists: () => ({ items: data.empty, fetchChecklists: data.noop }) }));
vi.mock('@/hooks/useChecklistTemplates', () => ({ useChecklistTemplates: () => ({ templates: data.empty, fetchTemplates: data.noop }) }));
vi.mock('@/components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/UserCombobox', () => ({ UserCombobox: ({ value, onValueChange }: { value: string; onValueChange: (id: string) => void }) =>
  <select aria-label="Beställare" value={value} onChange={event => onValueChange(event.target.value)}>
    <option value="">Välj</option><option value="a">Anna</option><option value="b">Bertil</option>
  </select>,
}));
vi.mock('@/components/CategoryCombobox', () => ({ CategoryCombobox: () => null }));
vi.mock('@/components/TemplateCombobox', () => ({ TemplateCombobox: () => null }));
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: () => null }));

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Företag härlett från beställare', () => {
  it('visar bolaget vid beställaren, behåller väljaren under Detaljer och rensar vid byte till kontakt utan bolag', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><TicketForm /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByLabelText('Företag')).toBeNull();
    fireEvent.change(screen.getByLabelText('Beställare'), { target: { value: 'a' } });
    expect(screen.getByText(/Företag: Bolag A/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Detaljer/ }));
    expect(screen.getByLabelText('Företag')).toHaveTextContent('Bolag A');
    fireEvent.change(screen.getByLabelText('Beställare'), { target: { value: 'b' } });
    expect(screen.queryByText(/Företag: Bolag A/)).toBeNull();
    expect(screen.getByLabelText('Företag')).toHaveTextContent('Inget företag');
  });
});
