// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TicketForm from './TicketForm';

const noop = vi.hoisted(() => vi.fn());
const empty = vi.hoisted(() => [] as never[]);
vi.mock('@/hooks/useTicketMutations', () => ({ useTicketMutations: () => ({ addTicket: noop, updateTicket: noop }) }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: () => ({ users: empty }) }));
vi.mock('@/hooks/useSystemUsers', () => ({ useSystemUsers: () => ({ users: empty }) }));
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: () => ({ companies: empty }) }));
vi.mock('@/hooks/useCategories', () => ({ useCategories: () => ({ categories: empty, addCategory: noop }) }));
vi.mock('@/hooks/useTemplates', () => ({ useTemplates: () => ({ templates: empty }) }));
vi.mock('@/hooks/useTicketAttachments', () => ({ useTicketAttachments: () => ({ attachments: empty, fetchAttachments: noop }) }));
vi.mock('@/hooks/useTicketChecklists', () => ({ useTicketChecklists: () => ({ items: empty, fetchChecklists: noop }) }));
vi.mock('@/hooks/useChecklistTemplates', () => ({ useChecklistTemplates: () => ({ templates: empty, fetchTemplates: noop }) }));
vi.mock('@/components/UserCombobox', () => ({ UserCombobox: () => null }));
vi.mock('@/components/CategoryCombobox', () => ({ CategoryCombobox: () => null }));
vi.mock('@/components/TemplateCombobox', () => ({ TemplateCombobox: () => null }));
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ value }: { value: string }) => <div data-testid="editor" data-html={value} />,
}));

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderAt = (url: string) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[url]}><TicketForm /></MemoryRouter></QueryClientProvider>
);

describe('Förifyllning från query', () => {
  it('fyller titel och beskrivning (avkodat, radbrytning blir stycken)', () => {
    renderAt('/tickets/new?title=Skrivaren%20g%C3%A5r%20inte&description=Rad%20ett%0ARad%20tv%C3%A5');
    expect(screen.getByLabelText(/Titel/)).toHaveValue('Skrivaren går inte');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-html', '<p>Rad ett</p><p>Rad två</p>');
  });

  it('utkast vinner över query', () => {
    store.set('it-ticket:new-ticket-draft', JSON.stringify({ title: 'Mitt utkast', description: '<p>x</p>' }));
    renderAt('/tickets/new?title=Fr%C3%A5n%20query');
    expect(screen.getByLabelText(/Titel/)).toHaveValue('Mitt utkast');
  });

  it('ett tomt editor-utkast (<p></p>) blockerar inte förifyllningen', () => {
    store.set('it-ticket:new-ticket-draft', JSON.stringify({ title: '', description: '<p></p>', priority: 'medium' }));
    renderAt('/tickets/new?title=Fr%C3%A5n%20query&description=Hej');
    expect(screen.getByLabelText(/Titel/)).toHaveValue('Från query');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-html', '<p>Hej</p>');
  });

  it('injicerar inte HTML från query', () => {
    renderAt('/tickets/new?description=' + encodeURIComponent('<img src=x onerror=alert(1)><b>hej</b>'));
    const html = screen.getByTestId('editor').getAttribute('data-html')!;
    expect(html).toBe('<p>&lt;img src=x onerror=alert(1)&gt;&lt;b&gt;hej&lt;/b&gt;</p>');
    expect(document.querySelector('img')).toBeNull();
  });

  it('begränsar längd (titel 200, beskrivning 2000)', () => {
    renderAt('/tickets/new?title=' + 'a'.repeat(300) + '&description=' + 'b'.repeat(3000));
    expect((screen.getByLabelText(/Titel/) as HTMLInputElement).value).toHaveLength(200);
    expect(screen.getByTestId('editor').getAttribute('data-html')).toBe(`<p>${'b'.repeat(2000)}</p>`);
  });
});
