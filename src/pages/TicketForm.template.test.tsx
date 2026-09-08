// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import TicketForm from './TicketForm';

const data = vi.hoisted(() => ({
  contacts: [
    { id: 'a', name: 'Anna', email: 'anna@example.com', company_id: 'company-a', company_name: 'Bolag A', createdAt: new Date() },
    { id: 'b', name: 'Bertil', email: 'bertil@example.com', createdAt: new Date() },
  ],
  empty: [], noop: vi.fn(), addTicket: vi.fn(async () => null),
  template: { id: 'tmpl', name: 'Testmall', titleTemplate: 'Beställning', priority: 'medium', category: 'aaf71e4e-c3bf-4000-b000-123456789012', fields: [
    { id: 'count', field_name: 'count', field_label: 'Antal', field_type: 'number', required: 1 },
    { id: 'reason', field_name: 'reason', field_label: 'Motivering', field_type: 'textarea', required: 1 },
  ] },
}));
vi.mock('@/hooks/useTicketMutations', () => ({ useTicketMutations: () => ({ addTicket: data.addTicket, updateTicket: data.noop }) }));
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
vi.mock('@/components/TemplateCombobox', () => ({ TemplateCombobox: ({ onSelect }: { onSelect: (template: typeof data.template) => void }) => <button type="button" onClick={() => onSelect(data.template)}>Välj testmall</button> }));
vi.mock('@/components/ui/rich-text-editor', () => ({ RichTextEditor: ({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) => <textarea id={id} value={value} onChange={event => onChange(event.target.value)} /> }));

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Mall till ärende', () => {
  it('behåller mallkategori och kräver faktiska fältvärden innan skapande', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={client}><MemoryRouter><TicketForm /></MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText('Beställare'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Välj testmall' }));
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    expect(data.addTicket).not.toHaveBeenCalled();
    expect(await screen.findByText('Antal krävs')).toBeTruthy();
    fireEvent.change(container.querySelector('#count')!, { target: { value: '0' } });
    fireEvent.change(container.querySelector('#reason')!, { target: { value: '<p><br></p>' } });
    fireEvent.submit(form);
    expect(data.addTicket).not.toHaveBeenCalled();
    expect(screen.getByText('Motivering krävs')).toBeTruthy();
    fireEvent.change(container.querySelector('#reason')!, { target: { value: '<p>Behövs för arbetet</p>' } });
    fireEvent.submit(form);
    await waitFor(() => expect(data.addTicket).toHaveBeenCalled());
    expect(data.addTicket).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'tmpl', category: data.template.category, title: 'Beställning' }),
      expect.arrayContaining([{ fieldName: 'count', fieldLabel: 'Antal', fieldValue: '0' }, { fieldName: 'reason', fieldLabel: 'Motivering', fieldValue: '<p>Behövs för arbetet</p>' }]),
    );
  });
});
