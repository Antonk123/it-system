import { describe, expect, it } from 'vitest';
import { mapTicketRow } from './mapTicket';
import type { TicketRow } from './api';

const listRow: TicketRow = {
  id: 't1', title: 'Skrivaren', status: 'open', priority: 'high', category_id: null, requester_id: 'c1',
  company_id: 'co1', company_name: 'Prefab', assigned_to: 'u1', assigned_to_name: 'Anna',
  created_at: '2026-09-08 10:00:00', updated_at: '2026-09-08 10:00:00', resolved_at: null, closed_at: null,
};

describe('mapTicketRow', () => {
  it('klarar listrader utan description, notes och solution', () => {
    const ticket = mapTicketRow(listRow);
    expect(ticket.description).toBe('');
    expect(ticket.notes).toBeUndefined();
    expect(ticket.solution).toBeUndefined();
  });

  it('mappar tilldelning och företag till camelCase-fälten', () => {
    expect(mapTicketRow(listRow)).toMatchObject({
      assignedTo: 'u1', assignedToName: 'Anna', companyId: 'co1', companyName: 'Prefab',
    });
  });

  it('behåller text-fälten från ärendedetaljen', () => {
    expect(mapTicketRow({ ...listRow, description: '<p>x</p>', notes: 'n', solution: 's' }))
      .toMatchObject({ description: '<p>x</p>', notes: 'n', solution: 's' });
  });
});
