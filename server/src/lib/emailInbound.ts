import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { convert } from 'html-to-text';
import { db } from '../db/connection.js';
import { randomUUID } from 'crypto';
import { dispatchWebhook } from './webhookDispatcher.js';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  pollingInterval: number; // seconds
  autoCreateContact: boolean;
}

function getEmailConfig(): EmailConfig | null {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASS;

  if (!host || !user || !pass) return null;

  return {
    host,
    port: parseInt(process.env.IMAP_PORT || '993'),
    secure: process.env.IMAP_SECURE !== 'false',
    auth: { user, pass },
    pollingInterval: parseInt(process.env.IMAP_POLL_INTERVAL || '60'),
    autoCreateContact: process.env.IMAP_AUTO_CREATE_CONTACT !== 'false',
  };
}

async function processEmail(source: Buffer, config: EmailConfig): Promise<void> {
  const parsed = await simpleParser(source);

  const fromAddress = parsed.from?.value?.[0]?.address;
  const fromName = parsed.from?.value?.[0]?.name || fromAddress;
  const subject = parsed.subject || '(Inget ämne)';

  if (!fromAddress) {
    console.warn('[email-inbound] Email without from address, skipping');
    return;
  }

  // Convert HTML to plain text, or use text body
  let body = '';
  if (parsed.html) {
    body = convert(parsed.html as string, { wordwrap: false });
  } else if (parsed.text) {
    body = parsed.text;
  }

  // Trim excessive whitespace
  body = body.replace(/\n{3,}/g, '\n\n').trim();

  // Look up contact by email
  let contact = db
    .prepare('SELECT id, company_id FROM contacts WHERE LOWER(email) = LOWER(?)')
    .get(fromAddress) as { id: string; company_id: string | null } | undefined;

  // Auto-create contact if enabled
  if (!contact && config.autoCreateContact) {
    const contactId = randomUUID();
    db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)').run(
      contactId,
      fromName,
      fromAddress
    );
    contact = { id: contactId, company_id: null };
    console.log(`[email-inbound] Created contact for ${fromAddress}`);
  }

  // Create ticket
  const ticketId = randomUUID();
  const companyId = contact?.company_id || null;

  db.prepare(
    `INSERT INTO tickets (id, title, description, status, priority, requester_id, company_id)
     VALUES (?, ?, ?, 'open', 'medium', ?, ?)`
  ).run(ticketId, subject, body, contact?.id || null, companyId);

  // Add to FTS index
  const row = db
    .prepare('SELECT rowid FROM tickets WHERE id = ?')
    .get(ticketId) as { rowid: number } | undefined;
  if (row) {
    db.prepare(
      'INSERT INTO tickets_fts(rowid, title, description, notes, solution) VALUES (?,?,?,?,?)'
    ).run(row.rowid, subject, body, '', '');
  }

  // Log in history
  db.prepare(
    'INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(randomUUID(), ticketId, null, 'created', null, 'email');

  // Handle attachments
  if (parsed.attachments && parsed.attachments.length > 0) {
    const fs = await import('fs');
    const path = await import('path');
    const uploadDir =
      process.env.UPLOAD_DIR || path.join(process.cwd(), 'data/uploads');

    for (const attachment of parsed.attachments) {
      if (!attachment.filename) continue;

      const attachId = randomUUID();
      const ext = path.extname(attachment.filename);
      const storedName = `${attachId}${ext}`;
      const filePath = path.join(uploadDir, storedName);

      // Ensure upload dir exists
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(filePath, attachment.content);

      db.prepare(
        `INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path, file_size, file_type)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        attachId,
        ticketId,
        attachment.filename,
        storedName,
        attachment.size,
        attachment.contentType
      );
    }
  }

  // Apply SLA (optional — does not block ticket creation)
  try {
    const { applySLAToTicket } = await import('./slaHelper.js');
    applySLAToTicket(ticketId, companyId, 'medium');
  } catch {
    // SLA module may not exist or may throw — safe to ignore
  }

  // Dispatch webhook
  dispatchWebhook('ticket.created', {
    id: ticketId,
    title: subject,
    status: 'open',
    priority: 'medium',
    source: 'email',
  }).catch(console.error);

  console.log(`[email-inbound] Created ticket "${subject}" from ${fromAddress}`);
}

let pollingTimer: ReturnType<typeof setInterval> | null = null;

export function getEmailInboundStatus() {
  const configured = !!(
    process.env.IMAP_HOST &&
    process.env.IMAP_USER &&
    process.env.IMAP_PASS
  );
  return {
    configured,
    active: pollingTimer !== null,
    host: process.env.IMAP_HOST || null,
    user: process.env.IMAP_USER || null,
    polling_interval: parseInt(process.env.IMAP_POLL_INTERVAL || '60'),
    auto_create_contact: process.env.IMAP_AUTO_CREATE_CONTACT !== 'false',
  };
}

export async function startEmailPolling(): Promise<void> {
  const config = getEmailConfig();
  if (!config) {
    console.log('[email-inbound] IMAP not configured, email-to-ticket disabled');
    return;
  }

  console.log(
    `[email-inbound] Starting email polling (every ${config.pollingInterval}s) from ${config.auth.user}`
  );

  async function poll() {
    let client: ImapFlow | null = null;
    try {
      client = new ImapFlow({
        host: config!.host,
        port: config!.port,
        secure: config!.secure,
        auth: config!.auth,
        logger: false as any,
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        // Search for unseen messages
        const messages = client.fetch({ seen: false }, { source: true, envelope: true });

        for await (const message of messages) {
          try {
            if (!message.source) {
              console.warn('[email-inbound] Message without source, skipping');
              continue;
            }
            await processEmail(message.source, config!);
            // Mark as seen
            await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
          } catch (error) {
            console.error('[email-inbound] Error processing email:', error);
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (error) {
      console.error('[email-inbound] IMAP polling error:', error);
      // Ensure we clean up the connection on error
      try {
        if (client) await client.logout();
      } catch {
        // ignore logout errors
      }
    }
  }

  // Initial poll
  await poll();

  // Schedule periodic polling
  pollingTimer = setInterval(poll, config.pollingInterval * 1000);
}

export function stopEmailPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}
