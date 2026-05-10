import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { convert } from 'html-to-text';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { db } from '../db/connection.js';
import { randomUUID } from 'crypto';
import { dispatchWebhook } from './webhookDispatcher.js';
import { sendTicketReceivedConfirmation } from './email.js';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pollingInterval: number;
  autoCreateContact: boolean;
  auth: { user: string; accessToken: string } | { user: string; pass: string };
}

function useOAuth2(): boolean {
  return !!(process.env.IMAP_CLIENT_ID && process.env.IMAP_CLIENT_SECRET && process.env.IMAP_TENANT_ID);
}

let msalClient: ConfidentialClientApplication | null = null;

function getMsalClient(): ConfidentialClientApplication {
  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.IMAP_CLIENT_ID!,
        authority: `https://login.microsoftonline.com/${process.env.IMAP_TENANT_ID!}`,
        clientSecret: process.env.IMAP_CLIENT_SECRET!,
      },
    });
  }
  return msalClient;
}

async function getAccessToken(): Promise<string> {
  const client = getMsalClient();
  const result = await client.acquireTokenByClientCredential({
    scopes: ['https://outlook.office365.com/.default'],
  });
  if (!result?.accessToken) {
    throw new Error('Failed to acquire OAuth2 access token');
  }
  return result.accessToken;
}

async function getEmailConfig(): Promise<EmailConfig | null> {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;

  if (!host || !user) return null;

  const base = {
    host,
    port: parseInt(process.env.IMAP_PORT || '993'),
    secure: process.env.IMAP_SECURE !== 'false',
    user,
    pollingInterval: parseInt(process.env.IMAP_POLL_INTERVAL || '60'),
    autoCreateContact: process.env.IMAP_AUTO_CREATE_CONTACT !== 'false',
  };

  if (useOAuth2()) {
    const accessToken = await getAccessToken();
    return { ...base, auth: { user, accessToken } };
  }

  const pass = process.env.IMAP_PASS;
  if (!pass) return null;
  return { ...base, auth: { user, pass } };
}

function findTicketByMessageId(messageIds: string[]): { id: string } | undefined {
  if (messageIds.length === 0) return undefined;
  const placeholders = messageIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT id FROM tickets WHERE email_message_id IN (${placeholders}) LIMIT 1`)
    .get(...messageIds) as { id: string } | undefined;
}

function stripReplyPrefix(subject: string): string {
  return subject.replace(/^(Re|Sv|Fwd|Fw|VS)\s*:\s*/i, '').trim();
}

function findTicketBySubject(subject: string): { id: string } | undefined {
  const stripped = stripReplyPrefix(subject);
  if (!stripped) return undefined;
  return db
    .prepare('SELECT id FROM tickets WHERE title = ? AND status NOT IN (\'closed\') ORDER BY created_at DESC LIMIT 1')
    .get(stripped) as { id: string } | undefined;
}

function resolveOrCreateContact(fromAddress: string, fromName: string, autoCreate: boolean) {
  let contact = db
    .prepare('SELECT id, company_id FROM contacts WHERE LOWER(email) = LOWER(?)')
    .get(fromAddress) as { id: string; company_id: string | null } | undefined;

  if (!contact && autoCreate) {
    const contactId = randomUUID();
    db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)').run(
      contactId,
      fromName,
      fromAddress
    );
    contact = { id: contactId, company_id: null };
    console.log(`[email-inbound] Created contact for ${fromAddress}`);
  }

  return contact;
}

function addCommentToTicket(ticketId: string, body: string, fromAddress: string, fromName: string): void {
  const commentId = randomUUID();
  const systemUserId = (db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined)?.id;
  if (!systemUserId) {
    console.warn('[email-inbound] No system user found, cannot add comment');
    return;
  }

  const attribution = `**Från:** ${fromName} (${fromAddress})\n\n`;
  db.prepare(
    'INSERT INTO ticket_comments (id, ticket_id, user_id, content, is_internal) VALUES (?, ?, ?, ?, 0)'
  ).run(commentId, ticketId, systemUserId, attribution + body);

  db.prepare('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ticketId);

  console.log(`[email-inbound] Added comment to ticket ${ticketId} from ${fromAddress}`);
}

async function processEmail(source: Buffer, config: EmailConfig): Promise<void> {
  const parsed = await simpleParser(source);

  const fromAddress = parsed.from?.value?.[0]?.address;
  const fromName = parsed.from?.value?.[0]?.name || fromAddress || '';
  const subject = parsed.subject || '(Inget ämne)';
  const messageId = parsed.messageId || null;

  if (!fromAddress) {
    console.warn('[email-inbound] Email without from address, skipping');
    return;
  }

  let body = '';
  if (parsed.html) {
    body = convert(parsed.html as string, { wordwrap: false });
  } else if (parsed.text) {
    body = parsed.text;
  }
  body = body.replace(/\n{3,}/g, '\n\n').trim();

  // --- Threading: check if this is a reply to an existing ticket ---
  const referencedIds: string[] = [];
  if (parsed.inReplyTo) {
    referencedIds.push(parsed.inReplyTo);
  }
  if (parsed.references) {
    const refs = Array.isArray(parsed.references) ? parsed.references : [parsed.references];
    for (const ref of refs) {
      if (!referencedIds.includes(ref)) referencedIds.push(ref);
    }
  }

  let existingTicket = findTicketByMessageId(referencedIds);

  if (!existingTicket && /^(Re|Sv|Fwd|Fw|VS)\s*:/i.test(subject)) {
    existingTicket = findTicketBySubject(subject);
  }

  if (existingTicket) {
    resolveOrCreateContact(fromAddress, fromName, config.autoCreateContact);
    addCommentToTicket(existingTicket.id, body, fromAddress, fromName);

    if (parsed.attachments && parsed.attachments.length > 0) {
      await saveAttachments(parsed.attachments, existingTicket.id);
    }
    return;
  }

  // --- Deduplication: skip if this messageId already created a ticket ---
  if (messageId) {
    const duplicate = db
      .prepare('SELECT id FROM tickets WHERE email_message_id = ? LIMIT 1')
      .get(messageId) as { id: string } | undefined;
    if (duplicate) {
      console.log(`[email-inbound] Duplicate email ${messageId}, ticket ${duplicate.id} already exists — skipping`);
      return;
    }
  }

  // --- New ticket ---
  const contact = resolveOrCreateContact(fromAddress, fromName, config.autoCreateContact);

  const ticketId = randomUUID();
  const companyId = contact?.company_id || null;

  db.prepare(
    `INSERT INTO tickets (id, title, description, status, priority, requester_id, company_id, email_message_id)
     VALUES (?, ?, ?, 'open', 'medium', ?, ?, ?)`
  ).run(ticketId, subject, body, contact?.id || null, companyId, messageId);

  const row = db
    .prepare('SELECT rowid FROM tickets WHERE id = ?')
    .get(ticketId) as { rowid: number } | undefined;
  if (row) {
    db.prepare(
      'INSERT INTO tickets_fts(rowid, title, description, notes, solution) VALUES (?,?,?,?,?)'
    ).run(row.rowid, subject, body, '', '');
  }

  db.prepare(
    'INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(randomUUID(), ticketId, null, 'created', null, 'email');

  if (parsed.attachments && parsed.attachments.length > 0) {
    await saveAttachments(parsed.attachments, ticketId);
  }

  dispatchWebhook('ticket.created', {
    id: ticketId,
    title: subject,
    status: 'open',
    priority: 'medium',
    source: 'email',
  }).catch(console.error);

  sendTicketReceivedConfirmation({
    toEmail: fromAddress,
    toName: fromName,
    ticketId,
    title: subject,
  }).catch(error => console.error('[email-inbound] Confirmation email failed:', error));

  console.log(`[email-inbound] Created ticket "${subject}" from ${fromAddress}`);
}

async function saveAttachments(attachments: any[], ticketId: string): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data/uploads');

  for (const attachment of attachments) {
    if (!attachment.filename) continue;

    const attachId = randomUUID();
    const ext = path.extname(attachment.filename);
    const storedName = `${attachId}${ext}`;
    const filePath = path.join(uploadDir, storedName);

    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(filePath, attachment.content);

    db.prepare(
      `INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path, file_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(attachId, ticketId, attachment.filename, storedName, attachment.size, attachment.contentType);
  }
}

let pollingTimer: ReturnType<typeof setInterval> | null = null;

export function getEmailInboundStatus() {
  const configured = !!(
    process.env.IMAP_HOST &&
    process.env.IMAP_USER &&
    (process.env.IMAP_PASS || useOAuth2())
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
  const config = await getEmailConfig();
  if (!config) {
    console.log('[email-inbound] IMAP not configured, email-to-ticket disabled');
    return;
  }

  const authMethod = useOAuth2() ? 'OAuth2' : 'Basic';
  console.log(
    `[email-inbound] Starting email polling (every ${config.pollingInterval}s) from ${config.user} [${authMethod}]`
  );

  async function poll() {
    let client: ImapFlow | null = null;
    try {
      // Refresh token each poll for OAuth2
      const currentConfig = useOAuth2() ? await getEmailConfig() : config;
      if (!currentConfig) return;

      client = new ImapFlow({
        host: currentConfig.host,
        port: currentConfig.port,
        secure: currentConfig.secure,
        auth: currentConfig.auth,
        logger: false as any,
        socketTimeout: 90000,
      });

      let connectionDead = false;
      client.on('error', (err: Error) => {
        connectionDead = true;
        console.error('[email-inbound] IMAP connection error:', err.message);
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        const messages = client.fetch({ seen: false }, { source: true, envelope: true });

        for await (const message of messages) {
          if (connectionDead) break;
          try {
            if (!message.source) {
              console.warn('[email-inbound] Message without source, skipping');
              continue;
            }
            await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
            await processEmail(message.source, currentConfig);
          } catch (error) {
            console.error('[email-inbound] Error processing email:', error);
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (error: any) {
      if (error?.code !== 'ETIMEOUT') {
        console.error('[email-inbound] IMAP polling error:', error);
      }
      try {
        if (client) await client.logout();
      } catch {
        // ignore logout errors
      }
    }
  }

  await poll();
  pollingTimer = setInterval(poll, config.pollingInterval * 1000);
}

export function stopEmailPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}
