import type { Database } from 'better-sqlite3';

export interface PublicTicketAttachment {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number | null;
}

function addReferences(target: Set<string>, content: string | null): void {
  if (!content) return;
  for (const match of content.matchAll(/\/api\/attachments\/file\/([0-9a-f-]{36})/gi)) {
    target.add(match[1].toLowerCase());
  }
}

/** One policy for external lists AND downloads. Staff read access is separate. */
export function getPublicTicketAttachments(db: Database, ticketId: string): PublicTicketAttachment[] {
  const ticket = db.prepare('SELECT description, solution, notes FROM tickets WHERE id = ?').get(ticketId) as
    { description: string; solution: string | null; notes: string | null } | undefined;
  if (!ticket) return [];

  const publicReferences = new Set<string>();
  const privateReferences = new Set<string>();
  addReferences(publicReferences, ticket.description);
  addReferences(publicReferences, ticket.solution);
  addReferences(privateReferences, ticket.notes);
  for (const row of db.prepare('SELECT field_value FROM ticket_field_values WHERE ticket_id = ?').all(ticketId) as { field_value: string | null }[]) {
    addReferences(publicReferences, row.field_value);
  }
  const comments = db.prepare('SELECT content, is_internal, deleted_at FROM ticket_comments WHERE ticket_id = ?').all(ticketId) as
    { content: string; is_internal: number | null; deleted_at: string | null }[];
  for (const comment of comments) {
    // A deleted internal comment is still private; deletion must not publish its files.
    if (comment.is_internal !== 0) addReferences(privateReferences, comment.content);
    else if (!comment.deleted_at) addReferences(publicReferences, comment.content);
  }

  const files = db.prepare(`
    SELECT id, file_name, file_path, file_type, file_size, share_visibility
    FROM ticket_attachments WHERE ticket_id = ? AND share_visibility <> 'internal'
  `).all(ticketId) as (PublicTicketAttachment & { share_visibility: string })[];
  return files.filter(file => !privateReferences.has(file.id.toLowerCase()) &&
    (file.share_visibility === 'public' || publicReferences.has(file.id.toLowerCase())))
    .map(({ share_visibility: _policy, ...file }) => file);
}
