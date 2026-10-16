// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const bridge = vi.hoisted(() => ({ profile: null as null | { name: string; email: string; photo: string | null }, user: null as null | { id: string } }));
vi.mock('@/hooks/useSupportProfile', () => ({ useSupportProfile: () => bridge.profile }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: bridge.user, isLoading: false }) }));
vi.mock('./TicketForm', () => ({ MISSING_CONTENT_MESSAGE: 'Skriv en kort beskrivning eller bifoga en bild.', default: ({ selfService, embedded }: { selfService: boolean; embedded: boolean }) =>
  <div data-testid="signed-in-form" data-self-service={selfService} data-embedded={embedded} /> }));
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ id, value, onChange, placeholder, required }: { id?: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) =>
    <textarea id={id} value={value} placeholder={placeholder} data-required={required} onChange={event => onChange(event.target.value)} />,
}));

const submitPublicTicket = vi.fn().mockResolvedValue({ id: 'new-ticket' });
const getPublicCategories = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/api', () => ({
  api: {
    getPublicCategories: (...args: unknown[]) => getPublicCategories(...args),
    getPublicTemplates: vi.fn().mockResolvedValue([]),
    getBranding: vi.fn().mockResolvedValue({ logoUrl: null }),
    submitPublicTicket: (...args: unknown[]) => submitPublicTicket(...args),
  },
}));

import PublicTicketForm from './PublicTicketForm';
vi.mock('@/hooks/useTicketDraft', () => ({ useTicketDraft: () => ({ ready: true, storageError: false, clear: async () => {}, resume: () => {} }) }));

function renderForm(path = '/submit-ticket') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><PublicTicketForm /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  submitPublicTicket.mockResolvedValue({ id: 'new-ticket' });
  getPublicCategories.mockResolvedValue([]);
});
afterEach(() => { cleanup(); bridge.profile = null; bridge.user = null; });

describe('PublicTicketForm — en sida, inga steg', () => {
  it('visar alla fält (namn, e-post, titel, beskrivning) på en och samma vy, utan prioritetsval', () => {
    renderForm();
    expect(screen.getByLabelText('Ditt namn *')).toBeTruthy();
    expect(screen.getByLabelText('Din e-post *')).toBeTruthy();
    expect(screen.getByLabelText('Ärendets titel *')).toBeTruthy();
    expect(screen.getByPlaceholderText('Beskriv ditt problem i detalj...')).toBeTruthy();
    // Prioritet sätts av IT vid triage, inte av den som rapporterar — inget
    // prioritetsval ska finnas i det publika formuläret.
    expect(screen.queryByText('Prioritet')).toBeNull();
    // Inget "Nästa"/steg-navigering ska finnas.
    expect(screen.queryByRole('button', { name: /Nästa/ })).toBeNull();
  });

  it('kategori visas som chips när kategorier finns, och kan togglas av', async () => {
    getPublicCategories.mockResolvedValue([{ id: 'cat-1', label: 'Nätverk' }]);
    renderForm();
    const chip = await screen.findByRole('button', { name: 'Nätverk' });
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('skickar in ärendet med samtliga fält från en och samma vy', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Skrivaren fungerar inte' } });
    fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: 'Felkod E-04.' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));

    await waitFor(() => expect(screen.getByText('Ärendet skickat!')).toBeTruthy());
    expect(submitPublicTicket).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Anna Andersson',
      email: 'anna@example.com',
      title: 'Skrivaren fungerar inte',
      description: 'Felkod E-04.',
      priority: 'medium',
    }), expect.objectContaining({ images: [], idempotencyKey: expect.any(String) }));
  });

  it('skickar ett ärende med enbart bilaga utan beskrivning', async () => {
    const { container } = renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Fel på skärmen' } });
    const file = new File(['%PDF-1.4 test'], 'fel.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });

    expect(screen.getByPlaceholderText('Beskriv ditt problem i detalj...')).toHaveAttribute('data-required', 'false');
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));

    await waitFor(() => expect(submitPublicTicket).toHaveBeenCalledWith(
      expect.objectContaining({ description: '' }),
      expect.objectContaining({ attachments: [file] }),
    ));
  });

  it('visar ett fel i formuläret när både beskrivning och bilagor saknas', async () => {
    const { container } = renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Fel på skärmen' } });

    expect(container.querySelector('form')).toHaveAttribute('novalidate');
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Skriv en kort beskrivning eller bifoga en bild.');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Beskriv ditt problem i detalj...')).toHaveFocus();
    expect(submitPublicTicket).not.toHaveBeenCalled();
  });

  it('tar bort innehållsfelet när en bilaga läggs till och visar det inte igen när bilagan tas bort', async () => {
    const { container } = renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Fel på skärmen' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Skriv en kort beskrivning eller bifoga en bild.');

    const file = new File(['%PDF-1.4 test'], 'fel.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Ta bort bilaga' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submitPublicTicket).not.toHaveBeenCalled();
  });

  it('tar bort innehållsfelet när beskrivningen får text', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Fel på skärmen' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Skriv en kort beskrivning eller bifoga en bild.');

    fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: '   ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Skriv en kort beskrivning eller bifoga en bild.');
    fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: 'Skärmen flimrar.' } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('låter rubrikfelet ligga kvar när en bilaga läggs till', async () => {
    const { container } = renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ärenderubrik krävs.');

    const file = new File(['%PDF-1.4 test'], 'fel.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
    await screen.findByText('fel.pdf');
    expect(screen.getByRole('alert')).toHaveTextContent('Ärenderubrik krävs.');
  });

  it('visar ärenderubrikens fel före innehållsfelet', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ärenderubrik krävs.');
    expect(screen.getByLabelText('Ärendets titel *')).toHaveFocus();
    expect(submitPublicTicket).not.toHaveBeenCalled();
  });

  it('fokuserar namn och e-post när de saknas eller är ogiltiga', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Skärmfel' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));
    expect(screen.getByLabelText('Ditt namn *')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'ogiltig' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));
    expect(screen.getByLabelText('Din e-post *')).toHaveFocus();
  });

  it('visar vilket numeriskt mallfält som har ogiltig inmatning', () => {
    const { container } = renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Skärmfel' } });
    const label = document.createElement('label');
    label.htmlFor = 'antal'; label.textContent = 'Antal *';
    const input = document.createElement('input');
    input.id = 'antal'; input.type = 'number';
    Object.defineProperty(input, 'validity', { value: { badInput: true } });
    container.querySelector('form')!.append(label, input);
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ange ett giltigt värde för Antal.');
    expect(input).toHaveFocus();
    expect(submitPublicTicket).not.toHaveBeenCalled();
  });

  it('skickar en bild i beskrivningen utan text', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Fel på skärmen' } });
    fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: '<p><img src="/api/attachments/file/12345678-1234-1234-1234-123456789abc"></p>' } });

    expect(screen.getByPlaceholderText('Beskriv ditt problem i detalj...')).toHaveAttribute('data-required', 'false');
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));

    await waitFor(() => expect(submitPublicTicket).toHaveBeenCalled());
  });
});


describe('PublicTicketForm — skräpskydd', () => {
  it('har ett dolt, onåbart honeypot-fält som inte annonseras för skärmläsare', () => {
    const { container } = renderForm();
    const honeypot = container.querySelector<HTMLInputElement>('input[name="website"]');
    expect(honeypot).toBeTruthy();
    expect(honeypot!.tabIndex).toBe(-1);
    expect(honeypot!.getAttribute('autocomplete')).toBe('off');
    expect(honeypot!.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('skickar med tomt website-fält och tidpunkten då formuläret öppnades', async () => {
    const before = Date.now();
    renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Skrivaren fungerar inte' } });
    fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: 'Felkod E-04.' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));

    await waitFor(() => expect(submitPublicTicket).toHaveBeenCalled());
    const payload = submitPublicTicket.mock.calls[0][0] as { website: string; formStartedAt: number };
    expect(payload.website).toBe('');
    expect(payload.formStartedAt).toBeGreaterThanOrEqual(before);
    expect(payload.formStartedAt).toBeLessThanOrEqual(Date.now());
  });

  it('visar serverns felmeddelande, t.ex. vid för snabb inskickning', async () => {
    submitPublicTicket.mockRejectedValue(new Error('Formuläret skickades för snabbt. Försök igen.'));
    renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Titel' } });
    fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: 'Text' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));

    expect(await screen.findByText('Formuläret skickades för snabbt. Försök igen.')).toBeTruthy();
  });

  it('skrollar till och fokuserar felbannern när inget fält kan fokuseras', async () => {
    submitPublicTicket.mockRejectedValue(new Error('Kunde inte skicka ärendet.'));
    renderForm();
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Titel' } });
    fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: 'Text' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));
    const banner = await screen.findByRole('alert');
    await waitFor(() => expect(banner).toHaveFocus());
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(banner).toHaveAttribute('tabIndex', '-1');
  });

  it('visar en notis i stället för att tyst ignorera misslyckad laddning av kategorier och mallar', async () => {
    getPublicCategories.mockRejectedValue(new Error('nät'));
    renderForm();
    expect(await screen.findByText(/Kunde inte ladda kategorier och mallar/)).toBeTruthy();
  });
});


describe('PublicTicketForm — inbäddad i Prefabnavet', () => {
  it('använder det inloggade självserviceformuläret utan yttre marginal i embed-läge', () => {
    bridge.user = { id: 'admin' };
    const { container } = renderForm('/submit-ticket?embed=1');
    expect(screen.getByTestId('signed-in-form')).toHaveAttribute('data-self-service', 'true');
    expect(screen.getByTestId('signed-in-form')).toHaveAttribute('data-embedded', 'true');
    expect(container.firstElementChild).not.toHaveClass('px-4', 'py-6');
  });
  it('behåller logotyp, rubrik och tillbaka-länk i fristående läge', () => {
    renderForm();
    expect(screen.getByRole('heading', { name: 'Skicka en supportförfrågan' })).toBeTruthy();
    expect(screen.getByAltText('IT-Ticket')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Tillbaka till inloggning/ })).toBeTruthy();
  });

  it('döljer egen sidchrome med ?embed=1 men behåller hela formuläret', () => {
    const { container } = renderForm('/submit-ticket?embed=1');
    // Värden (Navets Felanmälan-vy) har redan rubrik och navigation.
    expect(screen.queryByRole('heading', { name: 'Skicka en supportförfrågan' })).toBeNull();
    expect(screen.queryByAltText('IT-Ticket')).toBeNull();
    expect(screen.queryByRole('link', { name: /Tillbaka till inloggning/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Vad behöver du hjälp med?' })).toBeNull();
    expect(container.querySelector('.min-h-dvh')).toBeNull();
    expect(screen.getByLabelText('Ditt namn *')).toBeTruthy();
    expect(screen.getByLabelText('Din e-post *')).toBeTruthy();
    expect(screen.getByLabelText('Kort rubrik *')).toBeRequired();
    expect(screen.getByRole('button', { name: /Skicka till IT/ })).toBeTruthy();
  });

  it('visar bekräftelsen utan tillbaka-länk i inbäddat läge', async () => {
    renderForm('/submit-ticket?embed=1');
    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Kort rubrik *'), { target: { value: 'Skrivaren fungerar inte' } });
    fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: 'Felkod E-04.' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka till IT/ }));

    await waitFor(() => expect(screen.getByText('Ärendet skickat!')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Skicka ett nytt ärende' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Tillbaka till inloggning/ })).toBeNull();
  });
});


it('uses the Navet profile and sends a file without asking for contact details', async () => {
  bridge.profile = { name: 'Anna Andersson', email: 'anna@example.com', photo: null };
  const { container } = renderForm('/submit-ticket?embed=1');
  expect(screen.queryByLabelText('Ditt namn *')).toBeNull();
  expect(screen.getByText('Anna Andersson')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Kort rubrik *'), { target: { value: 'Hjälp med Outlook' } });
  fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: 'Felmeddelande vid start.' } });
  const file = new File(['%PDF-1.4 test'], 'error.pdf', { type: 'application/pdf' });
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Skicka till IT' }));
  await waitFor(() => expect(submitPublicTicket).toHaveBeenCalledWith(expect.objectContaining({ name: 'Anna Andersson', email: 'anna@example.com', template_id: undefined }), expect.objectContaining({ attachments: [file] })));
  bridge.profile = null;
});
