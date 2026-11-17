/** Unread state belongs to the existing verified requester ownership, not staff accounts. */
import { createHash } from "node:crypto";
import { db } from "../db/connection.js";
import type { SupportIdentity } from "./supportIdentity.js";
const revision = (status: string, comments: unknown[], statusChange = "") =>
  createHash("sha256").update(JSON.stringify([status, comments, statusChange])).digest("hex");
const initialRevision = revision("open", []);
export function supportUpdates(identity: SupportIdentity, ticketId?: string) {
  const args = [identity.issuer, identity.subject, ...(ticketId ? [ticketId] : [])];
  const filter = ticketId ? " AND t.id=?" : "";
  const tickets = db.prepare(`SELECT t.id, t.status, o.read_revision,
    (SELECT h.id FROM ticket_history h WHERE h.ticket_id=t.id AND h.field_name='status' ORDER BY h.changed_at DESC, h.rowid DESC LIMIT 1) AS status_change
    FROM tickets t JOIN support_ticket_owners o ON o.ticket_id=t.id
    WHERE o.issuer=? AND o.subject=?${filter}`).all(...args) as
    {id: string; status: string; read_revision: string | null; status_change: string | null}[];
  // Use the same public/undeleted boundary as the requester detail route.
  // Own replies and internal notes never change this revision.
  const comments = db.prepare(`SELECT c.ticket_id, c.id, c.content FROM ticket_comments c
    JOIN tickets t ON t.id=c.ticket_id JOIN support_ticket_owners o ON o.ticket_id=t.id
    LEFT JOIN support_ticket_replies r ON r.comment_id=c.id
    WHERE o.issuer=? AND o.subject=?${filter}
      AND c.is_internal=0 AND c.deleted_at IS NULL AND r.comment_id IS NULL
    ORDER BY c.created_at, c.id`).all(...args) as {ticket_id: string; id: string; content: string}[];
  const grouped = new Map<string, unknown[]>();
  for (const c of comments) {
    const values = grouped.get(c.ticket_id) || [];
    values.push([c.id, c.content]); grouped.set(c.ticket_id, values);
  }
  return tickets.map(t => {
    const current = revision(t.status, grouped.get(t.id) || [], t.status_change || "");
    return {id: t.id, revision: current, unread: current !== (t.read_revision || initialRevision)};
  });
}
