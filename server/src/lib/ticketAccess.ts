import { db } from '../db/connection.js';
import type { AuthUser } from '../middleware/auth.js';

interface TicketAccessRow {
  requester_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
}

// SQLite bound-parameter ceiling (SQLITE_MAX_VARIABLE_NUMBER default 999).
// Chunk batched IN(...) queries below this so large id lists never hit it.
const SQLITE_MAX_PARAMS = 900;

/**
 * Shared access predicate: does this row (requester/assignee/creator) belong
 * to the given non-admin user? Single source of truth so canAccessTicket and
 * filterAccessibleTicketIds cannot diverge in semantics.
 */
function rowIsAccessible(user: Pick<AuthUser, 'id'>, row: TicketAccessRow): boolean {
  return row.requester_id === user.id || row.assigned_to === user.id || row.created_by === user.id;
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
  return rowIsAccessible(user, t);
}

/**
 * Batched variant of canAccessTicket for filtering a list of candidate ticket
 * ids down to the subset the caller may access — avoids the N+1 of calling
 * canAccessTicket() per id (one SELECT per ticket) when a caller (e.g. batch
 * checklist progress) hands in up to hundreds of ids at once.
 *
 * Same access semantics as canAccessTicket (admin → everything; otherwise
 * requester/assignee/creator match), via the shared rowIsAccessible()
 * predicate. Non-existent ids are simply absent from the result, matching
 * canAccessTicket's false-for-missing-ticket behavior.
 *
 * Chunks the id list at SQLITE_MAX_PARAMS to stay under SQLite's bound
 * parameter limit (999) for large batches.
 */
export function filterAccessibleTicketIds(
  user: Pick<AuthUser, 'id' | 'role'>,
  ticketIds: string[]
): string[] {
  if (ticketIds.length === 0) return [];
  if (user.role === 'admin') return [...ticketIds];

  const accessible: string[] = [];
  for (let i = 0; i < ticketIds.length; i += SQLITE_MAX_PARAMS) {
    const chunk = ticketIds.slice(i, i + SQLITE_MAX_PARAMS);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, requester_id, assigned_to, created_by FROM tickets WHERE id IN (${placeholders})`
    ).all(...chunk) as (TicketAccessRow & { id: string })[];

    for (const row of rows) {
      if (rowIsAccessible(user, row)) accessible.push(row.id);
    }
  }
  return accessible;
}
