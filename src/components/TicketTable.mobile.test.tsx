// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { useState } from 'react';
import { TicketTable } from './TicketTable';
import type { Ticket } from '@/types/ticket';
vi.mock('@/hooks/useCategories', () => ({ useCategories: () => ({ categories: [] }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));
vi.mock('@/hooks/useTicketChecklists', () => ({ useChecklistProgress: () => undefined }));
afterEach(cleanup);
const ticket = { id: 't1', title: 'Utskrift', priority: 'medium', status: 'open', createdAt: new Date(), requesterId: 'c1' } as Ticket;
function List() { const [ids, setIds] = useState<string[]>([]); return <TicketTable tickets={[ticket]} users={[]} checklistVisible={false} selectedIds={ids} onSelectionChange={setIds} onBulkAction={vi.fn()} />; }
function Detail() { const location = useLocation(); return <p>{location.state?.from}</p>; }
it('bevarar listans filter vid mobilnavigering och låter användaren välja ett ärende', () => {
  render(<MemoryRouter initialEntries={['/tickets?mine=1&priority=high']}><Routes><Route path="/tickets" element={<List />} /><Route path="/tickets/:id" element={<Detail />} /></Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Välj' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Markera Utskrift' }));
  expect(screen.getByText('1 valda')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: /Utskrift/ }));
  expect(screen.getByText('/tickets?mine=1&priority=high')).toBeInTheDocument();
});
