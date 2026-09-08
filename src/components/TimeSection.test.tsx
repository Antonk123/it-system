// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TimeSection from './TimeSection';
import type { TimeEntryRow } from '@/types/ticket';

const mocks = vi.hoisted(() => ({
  entries: [] as TimeEntryRow[], addEntry: vi.fn(), editTimeEntry: vi.fn(), deleteEntry: vi.fn(),
}));
vi.mock('@/hooks/useTimeEntries', () => ({
  useTimeEntries: () => ({ ...mocks, totalMinutes: 30, isLoading: false, isAdding: false, isEditing: false }),
}));
const entry: TimeEntryRow = {
  id: 'time-1', duration_minutes: 30,
  note: 'Historisk tid', billable: 1, work_date: '2026-09-07', invoice_id: null,
  created_at: '2026-09-07T10:00:00Z',
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.entries = [];
  mocks.editTimeEntry.mockResolvedValue(undefined);
});

describe('TimeSection efter borttagen fakturering', () => {
  it('loggar vanlig tid utan fakturering och visar inga faktureringsval', () => {
    render(<TimeSection ticketId="ticket-1" />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.change(screen.getByLabelText('Tid att logga'), { target: { value: '45m' } });
    fireEvent.click(screen.getByRole('button', { name: 'Logga tid' }));
    expect(mocks.addEntry).toHaveBeenCalledWith({
      duration_minutes: 45, note: undefined, billable: false, work_date: null,
    });
  });

  it('ändrar tid och anteckning utan att skriva över historisk fakturerbarhet', async () => {
    mocks.entries = [entry];
    render(<TimeSection ticketId="ticket-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Redigera tidpost' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.change(screen.getByLabelText('Tid'), { target: { value: '1h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));
    await waitFor(() => expect(mocks.editTimeEntry).toHaveBeenCalledWith({
      id: entry.id, payload: { duration_minutes: 60, note: entry.note, work_date: entry.work_date },
    }));
  });

  it('visar fakturerad historik utan redigerings- eller borttagningsknappar', () => {
    mocks.entries = [{ ...entry, invoice_id: 'historisk-faktura' }];
    render(<TimeSection ticketId="ticket-1" />);
    expect(screen.getByText('Historisk tid')).toBeTruthy();
    expect(screen.getByText('Fakturerad')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Redigera tidpost' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ta bort tidpost' })).toBeNull();
  });
});
