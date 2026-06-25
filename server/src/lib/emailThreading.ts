import { randomUUID } from 'crypto';

/**
 * RFC 5322 threading headers for an outbound reply.
 *
 * Mail clients (Outlook/Gmail) thread by Message-ID/In-Reply-To/References. To
 * make a customer's reply land back on the right ticket, every outbound reply
 * carries a fresh Message-ID and points In-Reply-To/References at the thread
 * anchor — the Message-ID already stored on the ticket (`email_message_id`).
 *
 * For an email-origin ticket the anchor is the customer's original Message-ID,
 * which their client keeps in the References chain of every subsequent reply, so
 * `findTicketByMessageId` re-matches. For a web-origin ticket there is no anchor
 * on the first reply; the generated Message-ID becomes the anchor (persisted by
 * the caller) so the customer's reply (In-Reply-To: our id) matches next time.
 */
export function buildReplyHeaders(opts: {
  anchorMessageId: string | null;
  generatedMessageId: string;
}): { messageId: string; inReplyTo?: string; references?: string } {
  const headers: { messageId: string; inReplyTo?: string; references?: string } = {
    messageId: opts.generatedMessageId,
  };
  if (opts.anchorMessageId) {
    headers.inReplyTo = opts.anchorMessageId;
    headers.references = opts.anchorMessageId;
  }
  return headers;
}

/** Generate a unique Message-ID (angle-addr) for an outbound reply. */
export function generateMessageId(domain = 'itticket.local'): string {
  return `<reply-${randomUUID()}@${domain}>`;
}
