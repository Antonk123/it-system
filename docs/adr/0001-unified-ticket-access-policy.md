# 0001 — Unified ticket access policy

Status: Accepted (2026-10-09)

## Context

Access to a ticket and its sub-resources (comments, attachments, checklists, links, shares,
reminders, KB links) was decided route by route. Some routes required admin, requester,
assignee or creator for *reads*; others only checked `authenticate`; links and comments used
different rules for the same ticket. The result was inconsistent `403`s: a user could open a
ticket but not list its comments, or see the comments but not the attachments. IT-Ticket is an
internal, single-tenant tool where every signed-in user is a colleague on the same support
team — there is no customer who must be walled off from other customers' tickets.

## Decision

One rule, implemented once in `server/src/lib/ticketAccess.ts` (`canAccessTicket`,
`canWriteTicketRow`):

- **Read:** every authenticated user may read every ticket and all its sub-resources.
- **Write:** admin, the ticket's assignee, the ticket's creator, **or anyone when the ticket is
  unassigned** (self-service pickup of the queue). Everyone else gets `403`.
- **Delete / bulk delete** of tickets stays admin-only.
- "Admin" is `isEffectiveAdmin` (`server/src/middleware/auth.ts`), not `user.role`: an API key
  without `admin` scope never counts as admin even when its owner is one.
- Bulk update applies the write rule per ticket and reports the ones it refused in `skipped`
  instead of failing the batch (`PUT /api/tickets/bulk`).

## Consequences

- One place to audit and test (`server/src/lib/ticketAccess.test.ts`); routes call the helper
  instead of re-implementing the rule, so a new sub-resource gets the right behaviour by
  default.
- Removes the old `403` on reads, which hid tickets from colleagues who legitimately help each
  other — at the price that any signed-in user can read internal comments and notes. This is
  acceptable only because accounts are created by an admin for staff; if customers or
  contractors ever get accounts, this ADR must be superseded with a scoping rule.
- Unassigned tickets are writable by anyone, so assigning a ticket is also what *protects* it
  from edits by others. Reassignment is itself a write: anyone can take an unassigned ticket,
  but only admin/assignee/creator can move an assigned one.
- API docs state the policy once (`docs/API.md` → *Ticket access policy*,
  `docs/openapi.yaml` info section).
