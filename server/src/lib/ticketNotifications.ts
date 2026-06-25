import { db } from '../db/connection.js';
import { dispatchWebhook } from './webhookDispatcher.js';
import { sendPushToAllSubscriptions } from './push.js';
import { sendTicketReplyEmail, sendAgentReplyNotificationEmail } from './email.js';
import { stripHtml } from './htmlUtils.js';
import { logger } from './logger.js';

const SNIPPET_LEN = 200;

function snippet(content: string): string {
  return stripHtml(content).slice(0, SNIPPET_LEN);
}

/**
 * A technician posted a PUBLIC comment → close the loop toward the customer:
 * fire the comment.created webhook and email the requester (threaded). Called
 * fire-and-forget from the comments route; safe on missing data/SMTP.
 */
export async function notifyCustomerOfPublicReply(ticketId: string, content: string): Promise<void> {
  const ticket = db.prepare(`
    SELECT t.id, t.title, c.email AS requester_email, c.name AS requester_name
    FROM tickets t
    LEFT JOIN contacts c ON c.id = t.requester_id
    WHERE t.id = ?
  `).get(ticketId) as
    | { id: string; title: string; requester_email: string | null; requester_name: string | null }
    | undefined;
  if (!ticket) return;

  await dispatchWebhook('comment.created', {
    ticket_id: ticket.id,
    ticket_title: ticket.title,
    is_internal: false,
    content_snippet: snippet(content),
  }).catch((err) => logger.error('comment.created webhook failed', { error: String(err) }));

  if (ticket.requester_email) {
    await sendTicketReplyEmail({
      ticketId: ticket.id,
      toEmail: ticket.requester_email,
      toName: ticket.requester_name || 'där',
      title: ticket.title,
      body: content,
    }).catch((err) => logger.error('reply email failed', { error: String(err) }));
  }
}

/**
 * A customer replied (inbound email became a public comment) → notify the
 * assigned technician: fire the comment.created webhook and push + email the
 * assignee. Called fire-and-forget from the inbound-email path.
 */
export async function notifyAgentOfCustomerReply(ticketId: string, content: string): Promise<void> {
  const ticket = db.prepare('SELECT id, title, assigned_to FROM tickets WHERE id = ?')
    .get(ticketId) as { id: string; title: string; assigned_to: string | null } | undefined;
  if (!ticket) return;

  const snip = snippet(content);

  await dispatchWebhook('comment.created', {
    ticket_id: ticket.id,
    ticket_title: ticket.title,
    is_internal: false,
    source: 'email',
    content_snippet: snip,
  }).catch((err) => logger.error('comment.created webhook failed', { error: String(err) }));

  // Only notify the assigned technician — never broadcast the ticket title (which
  // may contain customer data) to every staff member's devices.
  if (ticket.assigned_to) {
    await sendPushToAllSubscriptions(
      { type: 'comment.created', ticketId: ticket.id, title: `Nytt svar: ${ticket.title}`, body: snip },
      ticket.assigned_to,
    ).catch((err) => logger.error('reply push failed', { error: String(err) }));

    const agent = db.prepare('SELECT email, display_name FROM users WHERE id = ?')
      .get(ticket.assigned_to) as { email: string; display_name: string | null } | undefined;
    if (agent?.email) {
      await sendAgentReplyNotificationEmail({
        toEmail: agent.email,
        toName: agent.display_name || agent.email,
        ticketId: ticket.id,
        title: ticket.title,
        snippet: snip,
      }).catch((err) => logger.error('agent notify email failed', { error: String(err) }));
    }
  }
}
