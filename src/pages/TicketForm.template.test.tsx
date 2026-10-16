// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TicketForm from './TicketForm';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test-user', email: 'anna@example.com' } }) }));
vi.mock('@/hooks/useTicketDraft', () => ({ useTicketDraft: () => ({ ready: true, storageError: false, clear: async () => {}, resume: () => {} }) }));

const data = vi.hoisted(() => ({
  contacts: [
    { id: 'a', name: 'Anna', email: 'anna@example.com', company_id: 'company-a', company_name: 'Bolag A', createdAt: new Date() },
    { id: 'b', name: 'Bertil', email: 'bertil@example.com', createdAt: new Date() },
  ],
  empty: [], noop: vi.fn(), addTicket: vi.fn(async (): Promise<{ id: string } | null> => null),
  uploadAttachment: vi.fn(async (): Promise<{ id: string } | null> => null),
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
vi.mock('@/hooks/useTicketAttachments', () => ({ useTicketAttachments: () => ({
  attachments: data.empty, fetchAttachments: data.noop, uploadAttachment: data.uploadAttachment,
}) }));
vi.mock('@/hooks/useTicketChecklists', () => ({ useTicketChecklists: () => ({ items: data.empty, fetchChecklists: data.noop }) }));
vi.mock('@/hooks/useChecklistTemplates', () => ({ useChecklistTemplates: () => ({ templates: data.empty, fetchTemplates: data.noop }) }));
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

describe('Spara ärende med bilagor', () => {
  it('behåller en misslyckad bilaga vid skapande och återförsök tills den faktiskt laddats upp', async () => {
    data.addTicket.mockResolvedValue({ id: 'new-ticket' });
    data.uploadAttachment
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'uploaded' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={client}><MemoryRouter><TicketForm /></MemoryRouter></QueryClientProvider>);

    fireEvent.change(screen.getByLabelText('Beställare'), { target: { value: 'a' } });
    fireEvent.change(container.querySelector('#title')!, { target: { value: 'Skrivaren fungerar inte' } });
    fireEvent.change(container.querySelector('textarea')!, { target: { value: '<p>Kan inte skriva ut</p>' } });
    const file = new File(['data'], 'felbild.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(data.addTicket).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(data.uploadAttachment).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Ärendet sparades, men 1 fil/)).toBeInTheDocument();
    fireEvent.submit(container.querySelector('form')!);
    expect(data.addTicket).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    await waitFor(() => expect(data.uploadAttachment).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Ärendet sparades, men 1 fil/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    await waitFor(() => expect(screen.queryByText(/Ärendet sparades, men 1 fil/)).toBeNull());
    expect(data.addTicket).toHaveBeenCalledTimes(1);
    expect(data.uploadAttachment).toHaveBeenCalledTimes(3);
  });
});


describe('Snabb felanmälan', () => {
  it('skickar som inloggad utan beställarval, obligatoriska mallfält eller handläggning', async () => {
    data.addTicket.mockResolvedValueOnce({ id: 'support-ticket' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/tickets/new?support=1']}><TicketForm /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByLabelText('Beställare')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fler uppgifter|Checklista/ })).not.toBeInTheDocument();
    expect(screen.getByText('Skickas som')).toBeInTheDocument();
    expect(screen.getByText('Anna')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Välj testmall' }));
    expect(screen.queryByLabelText('Antal')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Berätta lite mer/), { target: { value: 'Behöver åtkomst till Outlook.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    await waitFor(() => expect(data.addTicket).toHaveBeenCalledWith(expect.objectContaining({
      selfService: true, requesterId: '', company_id: undefined, description: 'Behöver åtkomst till Outlook.', category: 'none', priority: 'medium',
    }), undefined));
    expect(data.addTicket).toHaveBeenCalledWith(expect.not.objectContaining({ templateId: 'tmpl' }), undefined);
    expect(await screen.findByText('Ärendet skickat!')).toBeInTheDocument();
  });

  it('visar svensk banner och fokuserar editorn vid tomt självserviceärende', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/submit-ticket?embed=1']}><TicketForm selfService embedded /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByRole('heading', { name: 'Vad behöver du hjälp med?' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Skriv en kort beskrivning eller bifoga en bild.');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByLabelText(/Berätta lite mer/)).toHaveFocus();
    expect(data.addTicket).not.toHaveBeenCalled();
  });

  it('ger kortets innehåll toppmarginal när rubriken är dold i inbäddat supportläge', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/submit-ticket?embed=1']}><TicketForm selfService embedded /></MemoryRouter></QueryClientProvider>);
    const form = container.querySelector('form');
    expect(form?.parentElement).toHaveClass('pt-4');
    expect(form?.parentElement).not.toHaveClass('pt-0');
  });

  it('visar rubrikfel i bannern och fokuserar rubriken', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/submit-ticket?embed=1']}><TicketForm selfService embedded /></MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText(/Berätta lite mer/), { target: { value: 'Skrivaren startar inte.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ärenderubrik krävs.');
    expect(screen.getByLabelText('Kort rubrik *')).toHaveFocus();
    expect(data.addTicket).not.toHaveBeenCalled();
  });

  it('visar längdfelet för en rubrik över schemats gräns', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/submit-ticket?embed=1']}><TicketForm selfService embedded /></MemoryRouter></QueryClientProvider>);
    const title = screen.getByLabelText('Kort rubrik *');
    fireEvent.change(title, { target: { value: 'A'.repeat(201) } });
    fireEvent.change(screen.getByLabelText(/Berätta lite mer/), { target: { value: 'Beskrivning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ärenderubriken får vara högst 200 tecken.');
    expect(title).toHaveAttribute('maxLength', '200');
    expect(data.addTicket).not.toHaveBeenCalled();
  });

  it('skrollar till och fokuserar felbannern när fältet saknas i DOM', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/submit-ticket?embed=1']}><TicketForm selfService embedded /></MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText(/Berätta lite mer/), { target: { value: 'Beskrivning' } });
    const getElementById = document.getElementById.bind(document);
    const lookup = vi.spyOn(document, 'getElementById').mockImplementation(id => id === 'title' ? null : getElementById(id));
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
      const banner = screen.getByRole('alert');
      expect(banner).toHaveTextContent('Ärenderubrik krävs.');
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
      expect(banner).toHaveFocus();
      expect(banner).toHaveAttribute('tabIndex', '-1');
    } finally {
      lookup.mockRestore();
    }
  });

  const MISSING = 'Skriv en kort beskrivning eller bifoga en bild.';
  const renderEmbedded = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/submit-ticket?embed=1']}><TicketForm selfService embedded /></MemoryRouter></QueryClientProvider>);
  };

  it('tar bort innehållsfelet (banner och fältfel) när en bilaga läggs till och visar det inte igen när den tas bort', async () => {
    const { container } = renderEmbedded();
    fireEvent.change(screen.getByLabelText('Kort rubrik *'), { target: { value: 'Skärmfel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    expect(screen.getAllByText(MISSING)).toHaveLength(2);
    expect(document.getElementById('description-error')).toHaveTextContent(MISSING);

    const file = new File(['%PDF-1.4 test'], 'fel.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(screen.queryByText(MISSING)).toBeNull());
    expect(document.getElementById('description-error')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ta bort bilaga' }));
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(data.addTicket).not.toHaveBeenCalled();
  });

  it('tar bort innehållsfelet när beskrivningen får text', async () => {
    renderEmbedded();
    fireEvent.change(screen.getByLabelText('Kort rubrik *'), { target: { value: 'Skärmfel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    expect(screen.getAllByText(MISSING)).toHaveLength(2);

    fireEvent.change(screen.getByLabelText(/Berätta lite mer/), { target: { value: 'Skärmen flimrar.' } });
    await waitFor(() => expect(screen.queryByText(MISSING)).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('låter bannern med innehållsfelet stå kvar medan beskrivningen bara är blanksteg', () => {
    renderEmbedded();
    fireEvent.change(screen.getByLabelText('Kort rubrik *'), { target: { value: 'Skärmfel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    fireEvent.change(screen.getByLabelText(/Berätta lite mer/), { target: { value: '<p> </p>' } });
    expect(screen.getByRole('alert')).toHaveTextContent(MISSING);
  });

  it('låter rubrikfelet ligga kvar när en bilaga läggs till', async () => {
    const { container } = renderEmbedded();
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    expect(screen.getByRole('alert')).toHaveTextContent(MISSING);
    fireEvent.change(screen.getByLabelText('Kort rubrik *'), { target: { value: '' } });
    // Fyll i beskrivningen så att nästa inskick fastnar på rubriken i stället.
    fireEvent.change(screen.getByLabelText(/Berätta lite mer/), { target: { value: 'Text.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ärenderubrik krävs.');

    const file = new File(['%PDF-1.4 test'], 'fel.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await screen.findByText('fel.pdf');
    expect(screen.getByRole('alert')).toHaveTextContent('Ärenderubrik krävs.');
    expect(data.addTicket).not.toHaveBeenCalled();
  });

  it('skickar självserviceärende med enbart bilaga', async () => {
    data.addTicket.mockResolvedValueOnce({ id: 'attachment-ticket' });
    data.uploadAttachment.mockResolvedValueOnce({ id: 'file-id' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/submit-ticket?embed=1']}><TicketForm selfService embedded /></MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText('Kort rubrik *'), { target: { value: 'Skärmfel' } });
    const file = new File(['%PDF-1.4 test'], 'fel.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    await waitFor(() => expect(data.addTicket).toHaveBeenCalledWith(expect.objectContaining({
      selfService: true, description: '', title: 'Skärmfel', submission: expect.objectContaining({ attachments: [file] }),
    }), undefined));
    expect(data.uploadAttachment).not.toHaveBeenCalled();
  });

  it('skickar självserviceärende med enbart bild i editorn', async () => {
    data.addTicket.mockResolvedValueOnce({ id: 'image-ticket' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/submit-ticket?embed=1']}><TicketForm selfService embedded /></MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText('Kort rubrik *'), { target: { value: 'Skärmfel' } });
    fireEvent.change(screen.getByLabelText(/Berätta lite mer/), { target: { value: '<p><img src="/api/attachments/file/12345678-1234-1234-1234-123456789abc"></p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
    await waitFor(() => expect(data.addTicket).toHaveBeenCalledWith(expect.objectContaining({
      selfService: true, description: expect.stringContaining('<img'), title: 'Skärmfel',
    }), undefined));
  });
});
