// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { useState } from 'react';
import { TicketTable } from './TicketTable';
import type { Ticket } from '@/types/ticket';

vi.mock('@/hooks/useCategories', () => ({ useCategories: () => ({ categories: [], getCategoryLabel: (id: string) => id }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useTicketChecklists', () => ({ useChecklistProgress: () => undefined }));
afterEach(cleanup);

const ticket = { id: 't1', title: 'Utskrift', priority: 'medium', status: 'open', createdAt: new Date(), requesterId: 'c1' } as Ticket;

function List() {
  const [ids, setIds] = useState<string[]>([]);
  return <TicketTable tickets={[ticket]} users={[]} checklistVisible={false} selectedIds={ids} onSelectionChange={setIds} />;
}
function Detail() {
  const location = useLocation();
  return <p>{location.state?.from}</p>;
}

function renderTable() {
  render(
    <MemoryRouter initialEntries={['/tickets?mine=1']}>
      <Routes>
        <Route path="/tickets" element={<List />} />
        <Route path="/tickets/:id" element={<Detail />} />
      </Routes>
    </MemoryRouter>,
  );
}

it('öppnar ärendet via en riktig länk som bevarar listans filter', () => {
  renderTable();
  expect(screen.queryByRole('button', { name: /Utskrift/ })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Utskrift' }));
  expect(screen.getByText('/tickets?mine=1')).toBeInTheDocument();
});

it('låter markeringsrutan hanteras oberoende av raden', () => {
  renderTable();
  const checkbox = screen.getByRole('checkbox', { name: 'Markera Utskrift' });
  fireEvent.click(checkbox);
  expect(checkbox).toBeChecked();
  expect(screen.getByRole('link', { name: 'Utskrift' })).toBeInTheDocument();
});
