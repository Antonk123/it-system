// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactElement } from 'react';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isLoading: false }) }));
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ id, value, onChange, placeholder }: { id?: string; value: string; onChange: (value: string) => void; placeholder?: string }) =>
    <textarea id={id} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />,
}));

const submitPublicTicket = vi.fn().mockResolvedValue({ id: 'new-ticket' });
vi.mock('@/lib/api', () => ({
  api: {
    getPublicCategories: vi.fn().mockResolvedValue([]),
    getPublicTemplates: vi.fn().mockResolvedValue([]),
    getBranding: vi.fn().mockResolvedValue({ logoUrl: null }),
    submitPublicTicket: (...args: unknown[]) => submitPublicTicket(...args),
    requestAiSuggestion: vi.fn(),
    reportDeflectionOutcome: vi.fn(),
  },
}));

import PublicTicketForm from './PublicTicketForm';

function renderForm(): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><PublicTicketForm /></MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => { vi.clearAllMocks(); submitPublicTicket.mockResolvedValue({ id: 'new-ticket' }); });
afterEach(cleanup);

describe('PublicTicketForm — tvåstegsflöde', () => {
  it('visar steg 1 (beskriv problemet) som standard, inte namn/e-post', () => {
    renderForm();
    expect(screen.getByLabelText('Ärendets titel *')).toBeTruthy();
    expect(screen.queryByLabelText('Ditt namn *')).toBeNull();
    expect(screen.queryByLabelText('Din e-post *')).toBeNull();
  });

  it('blockerar Nästa utan titel/beskrivning och stannar på steg 1', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /Nästa/ }));
    expect(screen.getByText('Ärenderubrik krävs.')).toBeTruthy();
    expect(screen.queryByLabelText('Ditt namn *')).toBeNull();
  });

  it('går vidare till steg 2 med ifylld titel och beskrivning, och tillbaka igen med data kvar', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Skrivaren fungerar inte' } });
    fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: 'Felkod E-04.' } });
    fireEvent.click(screen.getByRole('button', { name: /Nästa/ }));

    expect(screen.getByLabelText('Ditt namn *')).toBeTruthy();
    expect(screen.queryByLabelText('Ärendets titel *')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tillbaka' }));
    expect(screen.getByLabelText('Ärendets titel *')).toHaveValue('Skrivaren fungerar inte');
  });

  it('skickar in ärendet med data från båda stegen och visar bekräftelse', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Ärendets titel *'), { target: { value: 'Skrivaren fungerar inte' } });
    fireEvent.change(screen.getByPlaceholderText('Beskriv ditt problem i detalj...'), { target: { value: 'Felkod E-04.' } });
    fireEvent.click(screen.getByRole('button', { name: /Nästa/ }));

    fireEvent.change(screen.getByLabelText('Ditt namn *'), { target: { value: 'Anna Andersson' } });
    fireEvent.change(screen.getByLabelText('Din e-post *'), { target: { value: 'anna@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Skicka ärende/ }));

    await waitFor(() => expect(screen.getByText('Ärendet skickat!')).toBeTruthy());
    expect(submitPublicTicket).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Anna Andersson',
      email: 'anna@example.com',
      title: 'Skrivaren fungerar inte',
      description: 'Felkod E-04.',
    }));
  });
});
