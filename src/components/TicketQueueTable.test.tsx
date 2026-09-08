// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TicketQueueTable } from './TicketQueueTable';
import type { Ticket } from '@/types/ticket';

afterEach(cleanup);

const ticket: Ticket = {
  id: '4db688-ticket', title: 'Beställning av nytt mobilnummer', description: '',
  status: 'in-progress', priority: 'medium', category: '752ac875-47f6-4a2a-986e-accb8cbe39c3',
  requesterId: 'contact-123', companyName: 'Prefabmästarna',
  createdAt: new Date(), updatedAt: new Date(),
};

describe('TicketQueueTable', () => {
  it('visar namn från ärendet även när kontakt- och kategorilistan saknas', () => {
    render(<MemoryRouter><TicketQueueTable tickets={[{ ...ticket, requesterName: 'Anna Andersson', categoryLabel: 'Telefoni' }]} isLoading={false} /></MemoryRouter>);
    expect(screen.getByText('Beställare: Anna Andersson')).toBeTruthy();
    expect(screen.getByText('Telefoni')).toBeTruthy();
  });
  it('visar beställare och kategorinamn i stället för internt kategori-ID', () => {
    render(<MemoryRouter><TicketQueueTable tickets={[ticket]} isLoading={false}
      categories={[{ id: ticket.category!, label: 'Telefoni' }]}
      getUserName={id => id === ticket.requesterId ? 'Anna Andersson' : undefined} />
    </MemoryRouter>);
    expect(screen.getByText('Beställare: Anna Andersson')).toBeTruthy();
    expect(screen.getByText('Telefoni')).toBeTruthy();
    expect(screen.getByText('Prefabmästarna')).toBeTruthy();
    expect(screen.queryByText(ticket.category!)).toBeNull();
  });

  it('läcker inte interna ID:n när uppslagsdata saknas och behåller tangentbordsöppning', () => {
    render(<MemoryRouter><Routes>
      <Route path="/" element={<TicketQueueTable tickets={[ticket]} isLoading={false} />} />
      <Route path="/tickets/:id" element={<p>Ärendedetalj</p>} />
    </Routes></MemoryRouter>);
    expect(screen.getByText('Beställare: Okänd beställare')).toBeTruthy();
    expect(screen.queryByText(ticket.category!)).toBeNull();
    expect(screen.queryByText(ticket.requesterId)).toBeNull();
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(screen.getByText('Ärendedetalj')).toBeTruthy();
  });
});
