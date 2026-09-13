// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isLoading: false }) }));
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ id, value, onChange, placeholder }: { id?: string; value: string; onChange: (value: string) => void; placeholder?: string }) =>
    <textarea id={id} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />,
}));

const submitPublicTicket = vi.fn().mockResolvedValue({ id: 'new-ticket' });
const getPublicCategories = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/api', () => ({
  api: {
    getPublicCategories: (...args: unknown[]) => getPublicCategories(...args),
    getPublicTemplates: vi.fn().mockResolvedValue([]),
    getBranding: vi.fn().mockResolvedValue({ logoUrl: null }),
    submitPublicTicket: (...args: unknown[]) => submitPublicTicket(...args),
    requestAiSuggestion: vi.fn(),
    reportDeflectionOutcome: vi.fn(),
  },
}));

import PublicTicketForm from './PublicTicketForm';

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><PublicTicketForm /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  submitPublicTicket.mockResolvedValue({ id: 'new-ticket' });
  getPublicCategories.mockResolvedValue([]);
});
afterEach(cleanup);

describe('PublicTicketForm — en sida, inga steg', () => {
  it('visar alla fält (namn, e-post, titel, beskrivning, prioritet) på en och samma vy', () => {
    renderForm();
    expect(screen.getByLabelText('Ditt namn *')).toBeTruthy();
    expect(screen.getByLabelText('Din e-post *')).toBeTruthy();
    expect(screen.getByLabelText('Ärendets titel *')).toBeTruthy();
    expect(screen.getByPlaceholderText('Beskriv ditt problem i detalj...')).toBeTruthy();
    expect(screen.getByText('Prioritet')).toBeTruthy();
    // Inget "Nästa"/steg-navigering ska finnas.
    expect(screen.queryByRole('button', { name: /Nästa/ })).toBeNull();
  });

  it('prioritet väljs som klickbara chips, inte en dropdown', () => {
    renderForm();
    const high = screen.getByRole('button', { name: 'Hög' });
    expect(high.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(high);
    expect(high.getAttribute('aria-pressed')).toBe('true');
    // Medium var förvalt (default 'medium') — ska nu vara avmarkerat.
    expect(screen.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe('false');
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
    fireEvent.click(screen.getByRole('button', { name: 'Hög' }));
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));

    await waitFor(() => expect(screen.getByText('Ärendet skickat!')).toBeTruthy());
    expect(submitPublicTicket).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Anna Andersson',
      email: 'anna@example.com',
      title: 'Skrivaren fungerar inte',
      description: 'Felkod E-04.',
      priority: 'high',
    }));
  });
});
