import { db } from '../db/connection.js';
import type { AuthUser } from '../middleware/auth.js';

interface TicketAccessRow {
  requester_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
}

/**
 * Single source of truth for "may this user act on this ticket (or its
 * sub-resources: checklists, links, shares, KB-links)?".
 *
 * Admins always; otherwise the ticket's requester, its assignee, or its
 * creator. Returns false for a non-existent ticket (caller maps to 404/403).
 *
 * NOTE: This intentionally does NOT grant access to unassigned tickets — that
 * "self-service pickup" allowance is specific to claiming/editing the ticket
 * itself (see PUT /tickets/:id) and must not leak to sub-resource mutations.
 */
export function canAccessTicket(user: Pick<AuthUser, 'id' | 'role'>, ticketId: string): boolean {
  if (user.role === 'admin') return true;
  const t = db.prepare(
    'SELECT requester_id, assigned_to, created_by FROM tickets WHERE id = ?'
  ).get(ticketId) as TicketAccessRow | undefined;
  if (!t) return false;
  return t.requester_id === user.id || t.assigned_to === user.id || t.created_by === user.id;
}
