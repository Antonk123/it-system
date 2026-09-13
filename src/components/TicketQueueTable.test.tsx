// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

// Desktop table och mobil kortvy renderas båda i DOM:en samtidigt (CSS-media
// queries appliceras inte i jsdom) — assertions scopas till tabellen för att
// undvika dubbletter mot den responsiva kortvyn.
describe('TicketQueueTable', () => {
  it('visar namn från ärendet även när kontakt- och kategorilistan saknas', () => {
    render(<MemoryRouter><TicketQueueTable tickets={[{ ...ticket, requesterName: 'Anna Andersson', categoryLabel: 'Telefoni' }]} isLoading={false} /></MemoryRouter>);
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Beställare: Anna Andersson')).toBeTruthy();
    expect(table.getByText('Telefoni')).toBeTruthy();
  });
  it('visar beställare och kategorinamn i stället för internt kategori-ID', () => {
    render(<MemoryRouter><TicketQueueTable tickets={[ticket]} isLoading={false}
      categories={[{ id: ticket.category!, label: 'Telefoni' }]}
      getUserName={id => id === ticket.requesterId ? 'Anna Andersson' : undefined} />
    </MemoryRouter>);
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Beställare: Anna Andersson')).toBeTruthy();
    expect(table.getByText('Telefoni')).toBeTruthy();
    expect(table.getByText('Prefabmästarna')).toBeTruthy();
    expect(screen.queryAllByText(ticket.category!)).toHaveLength(0);
  });

  it('läcker inte interna ID:n när uppslagsdata saknas och behåller tangentbordsöppning', () => {
    render(<MemoryRouter><Routes>
      <Route path="/" element={<TicketQueueTable tickets={[ticket]} isLoading={false} />} />
      <Route path="/tickets/:id" element={<p>Ärendedetalj</p>} />
    </Routes></MemoryRouter>);
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Beställare: Okänd beställare')).toBeTruthy();
    expect(screen.queryAllByText(ticket.category!)).toHaveLength(0);
    expect(screen.queryAllByText(ticket.requesterId)).toHaveLength(0);
    fireEvent.keyDown(table.getByRole('button'), { key: 'Enter' });
    expect(screen.getByText('Ärendedetalj')).toBeTruthy();
  });

  it('mobil kortvy visar samma status/prioritet som tabellen, inte bara ID och titel', () => {
    render(<MemoryRouter><TicketQueueTable tickets={[{ ...ticket, requesterName: 'Anna Andersson' }]} isLoading={false} /></MemoryRouter>);
    // Mobil kortvy är ett separat träd (md:hidden) bredvid tabellen (hidden md:block),
    // så "Pågående"/"Medium" finns en gång per vy — verifiera att kortvyn har sin egen.
    expect(screen.getAllByText('Pågående')).toHaveLength(2);
    expect(screen.getAllByText('Medium')).toHaveLength(2);
  });
});
