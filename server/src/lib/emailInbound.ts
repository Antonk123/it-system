import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { convert } from 'html-to-text';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { db } from '../db/connection.js';
import { randomUUID, randomBytes } from 'crypto';
import { dispatchWebhook } from './webhookDispatcher.js';
import { sendTicketReceivedConfirmation } from './email.js';
import { notifyAgentOfCustomerReply } from './ticketNotifications.js';
import { logger } from './logger.js';
import { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, MAX_FILE_SIZE, hasMagicByteMatch } from '../routes/attachments.js';

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

/**
 * Explicit boolean-parsning av env-vars. Bevarar exakt den tidigare semantiken
 * `value !== 'false'`: variabeln är PÅ som standard och stängs bara av med det
 * uttryckliga (skiftlägesokänsliga) värdet "false". Allt annat (unset, "0",
 * "no", "FALSE"→"false" osv.) tolkas mot defaultvärdet `def`.
 *
 * OBS: medvetet `!== 'false'` snarare än `=== 'true'` — annars skulle "1"/"yes"
 * (som tidigare gav true) och "FALSE" (skiftlägeskänsligt → tidigare true)
 * tyst byta innebörd. Defaulten för båda nedanstående variabler är `true`.
 */
const envBool = (v: string | undefined, def: boolean): boolean =>
  v == null ? def : v.toLowerCase() !== 'false';

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
    // Default true: IMAP körs nästan alltid över TLS (port 993). Stäng av med IMAP_SECURE=false.
    secure: envBool(process.env.IMAP_SECURE, true),
    user,
    pollingInterval: parseInt(process.env.IMAP_POLL_INTERVAL || '60'),
    // Default true: okända avsändare får automatiskt en kontakt. Stäng av med IMAP_AUTO_CREATE_CONTACT=false.
    autoCreateContact: envBool(process.env.IMAP_AUTO_CREATE_CONTACT, true),
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

function findTicketByShortId(subject: string): { id: string } | undefined {
  const match = subject.match(/\[#([A-F0-9]{8})\]/i);
  if (!match) return undefined;
  const shortId = match[1].toLowerCase();
  return db
    .prepare('SELECT id FROM tickets WHERE LOWER(SUBSTR(id, 1, 8)) = ? LIMIT 1')
    .get(shortId) as { id: string } | undefined;
}

/**
 * Söker efter ett befintligt öppet ärende vars titel matchar det avstrippade
 * ämnet OCH vars beställare har samma e-postadress som avsändaren.
 * Utan avsändarkontrollen skulle externa svar på ett ämne som råkar matcha
 * en befintlig ärendetitel kopplas till fel ärende.
 */
function findTicketBySubject(subject: string, fromAddress: string): { id: string } | undefined {
  const stripped = stripReplyPrefix(subject);
  if (!stripped) return undefined;
  // Require the sender to match the ticket's requester. Without this guard,
  // any external sender replying "Re: <existing title>" would have their
  // email body attached as a public comment to someone else's ticket.
  return db
    .prepare(`
      SELECT t.id FROM tickets t
      JOIN contacts c ON c.id = t.requester_id
      WHERE t.title = ?
        AND LOWER(c.email) = LOWER(?)
        AND t.status NOT IN ('closed')
      ORDER BY t.created_at DESC LIMIT 1
    `)
    .get(stripped, fromAddress) as { id: string } | undefined;
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
    logger.info('Created contact from inbound email', { email: fromAddress });
  }

  return contact;
}

function addCommentToTicket(ticketId: string, body: string, fromAddress: string, fromName: string): void {
  const commentId = randomUUID();
  const systemUserId = (db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined)?.id;
  if (!systemUserId) {
    logger.warn('No system user found, cannot add email comment');
    return;
  }

  const attribution = `**Från:** ${fromName} (${fromAddress})\n\n`;
  db.prepare(
    'INSERT INTO ticket_comments (id, ticket_id, user_id, content, is_internal) VALUES (?, ?, ?, ?, 0)'
  ).run(commentId, ticketId, systemUserId, attribution + body);

  db.prepare('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ticketId);

  logger.info('Added email comment to ticket', { ticketId, from: fromAddress });
}

/**
 * Parsar ett råmail (Buffer) och skapar antingen ett nytt ärende eller lägger till
 * en kommentar på ett befintligt ärende via trådnings-/ämneslogik.
 * Bilagor sparas via saveAttachments med MIME- och storleksvalidering.
 *
 * Tråd- och dedupliceringsordning (i prioritetsordning):
 *
 * 1. **Message-ID-match** — om mailets `In-Reply-To`- eller `References`-header
 *    innehåller ett message-id som matchar ett befintligt ärendes
 *    `email_message_id`, kopplas mailet till det ärendet som en kommentar.
 *
 * 2. **Kort-id i ämnesraden** — om ämnet innehåller ett mönster `[#XXXXXXXX]`
 *    (8 hex-tecken) som matchar de första 8 tecknen av ett ärendes UUID,
 *    används det ärendet.
 *
 * 3. **Ämne + avsändare på öppet ärende** — om ämnet börjar med ett
 *    svarsprefix (Re/Sv/Fwd/Fw/VS) och det finns ett öppet ärende med exakt
 *    matchande titel OCH vars beställare har samma e-postadress som avsändaren,
 *    kopplas mailet till det ärendet. Avsändarkontrollen förhindrar att externa
 *    svar på ett slumpmässigt matchande ämne kopplas till fel ärende.
 *
 * 4. **~60-sekunders nära-dubblett-fönster** — om inget av ovan matchar men
 *    ett ärende med samma titel och avsändare skapades inom de senaste 60
 *    sekunderna, läggs mailet till som kommentar på det ärendet i stället för
 *    att skapa ett nytt (skyddar mot snabba e-postklienter som skickar dubbelt).
 *
 * Om ingen av de fyra ovan stämmer skapas ett nytt ärende.
 */
async function processEmail(source: Buffer, config: EmailConfig): Promise<void> {
  // Guard against oversized emails that could OOM the process during parsing.
  // 25 MB is generous — most legitimate emails are well under 10 MB.
  if (source.length > 25 * 1024 * 1024) {
    logger.warn('Skipping oversized email', { sizeMB: (source.length / 1024 / 1024).toFixed(1), limitMB: 25 });
    return;
  }

  const parsed = await simpleParser(source);

  const fromAddress = parsed.from?.value?.[0]?.address;
  const fromName = parsed.from?.value?.[0]?.name || fromAddress || '';
  const subject = parsed.subject || '(Inget ämne)';
  const messageId = parsed.messageId || null;

  if (!fromAddress) {
    logger.warn('Email without from address, skipping');
    return;
  }

  let body = '';
  if (parsed.html) {
    body = convert(parsed.html as string, {
      wordwrap: false,
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
      ],
    });
  } else if (parsed.text) {
    body = parsed.text;
  }
  body = body
    .replace(/\[data:image\/[^\]]+\]/g, '')
    .replace(/data:image\/[^\s)]+/g, '')
    .replace(/https?:\/\/\S*safelinks\.protection\.outlook\.com\S*/g, (match) => {
      try {
        const url = new URL(match);
        return decodeURIComponent(url.searchParams.get('url') || match);
      } catch { return match; }
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

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

  if (!existingTicket) {
    existingTicket = findTicketByShortId(subject);
  }

  if (!existingTicket && /^(Re|Sv|Fwd|Fw|VS)\s*:/i.test(subject)) {
    existingTicket = findTicketBySubject(subject, fromAddress);
  }

  if (existingTicket) {
    resolveOrCreateContact(fromAddress, fromName, config.autoCreateContact);
    addCommentToTicket(existingTicket.id, body, fromAddress, fromName);

    if (parsed.attachments && parsed.attachments.length > 0) {
      await saveAttachments(parsed.attachments, existingTicket.id);
    }

    // Close the loop the other way: surface the customer's reply to the assigned
    // technician (webhook + push + email). Fire-and-forget.
    notifyAgentOfCustomerReply(existingTicket.id, body)
      .catch((err) => logger.error('notifyAgentOfCustomerReply failed', { error: String(err) }));
    return;
  }

  // --- Deduplication: skip if this messageId already created a ticket ---
  if (messageId) {
    const duplicate = db
      .prepare('SELECT id FROM tickets WHERE email_message_id = ? LIMIT 1')
      .get(messageId) as { id: string } | undefined;
    if (duplicate) {
      logger.info('Duplicate email skipped', { messageId, existingTicketId: duplicate.id });
      return;
    }
  }

  // --- Deduplication: check if a ticket with same sender + similar subject was created very recently ---
  const strippedSubject = stripReplyPrefix(subject);
  if (strippedSubject) {
    const recentDuplicate = db
      .prepare(
        `SELECT t.id FROM tickets t
         JOIN contacts c ON c.id = t.requester_id
         WHERE t.title = ?
           AND LOWER(c.email) = LOWER(?)
           AND t.created_at >= datetime('now', '-60 seconds')
         LIMIT 1`
      )
      .get(strippedSubject, fromAddress) as { id: string } | undefined;

    if (recentDuplicate) {
      logger.info('Near-duplicate email, adding as comment', { subject, from: fromAddress, ticketId: recentDuplicate.id });
      resolveOrCreateContact(fromAddress, fromName, config.autoCreateContact);
      addCommentToTicket(recentDuplicate.id, body, fromAddress, fromName);
      if (parsed.attachments && parsed.attachments.length > 0) {
        await saveAttachments(parsed.attachments, recentDuplicate.id);
      }
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

  // FTS5 synkas automatiskt via triggers (migration 050)

  db.prepare(
    'INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(randomUUID(), ticketId, null, 'created', null, 'email');

  if (parsed.attachments && parsed.attachments.length > 0) {
    await saveAttachments(parsed.attachments, ticketId);
  }

  const shareToken = randomBytes(12).toString('hex');
  db.prepare('INSERT INTO ticket_shares (id, ticket_id, share_token, created_by) VALUES (?, ?, ?, NULL)')
    .run(randomUUID(), ticketId, shareToken);
  const appBaseUrl = process.env.APP_BASE_URL || '';
  const shareUrl = `${appBaseUrl.replace(/\/$/, '')}/shared/${shareToken}`;

  dispatchWebhook('ticket.created', {
    id: ticketId,
    title: subject,
    status: 'open',
    priority: 'medium',
    source: 'email',
  }).catch((err: unknown) => logger.error('dispatchWebhook failed', { error: String(err) }));

  sendTicketReceivedConfirmation({
    toEmail: fromAddress,
    toName: fromName,
    ticketId,
    title: subject,
    shareUrl,
  }).catch(error => logger.error('Confirmation email failed', { error: String(error) }));

  logger.info('Created ticket from email', { ticketId, subject, from: fromAddress });
}

function isSignatureImage(attachment: any): boolean {
  if (attachment.contentDisposition !== 'inline' || !attachment.contentId) return false;
  if (!attachment.contentType?.startsWith('image/')) return false;
  const name = (attachment.filename || '').toLowerCase();
  if (/^image\d{3,4}\.(png|jpg|jpeg|gif)$/.test(name)) return true;
  if (attachment.size && attachment.size < 15000) return true;
  return false;
}

async function saveAttachments(attachments: any[], ticketId: string): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data/uploads');

  // Limit to 20 attachments per email to prevent abuse
  const limited = attachments.slice(0, 20);

  for (const attachment of limited) {
    if (!attachment.filename) continue;
    if (isSignatureImage(attachment)) {
      logger.debug('Skipping signature image', { filename: attachment.filename, size: attachment.size });
      continue;
    }

    // Validera MIME-typ och filändelse mot samma whitelist som HTTP-uppladdningar
    const mime: string = (attachment.contentType || '').toLowerCase().split(';')[0].trim();
    const extNoDot = path.extname(attachment.filename).replace(/^\./, '').toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(mime)) {
      logger.warn('Skipping mail attachment with disallowed MIME type', { filename: attachment.filename, mime });
      continue;
    }
    if (!ALLOWED_EXTENSIONS.includes(extNoDot)) {
      logger.warn('Skipping mail attachment with disallowed extension', { filename: attachment.filename, ext: extNoDot });
      continue;
    }

    // Kontrollera storleksgräns (samma som HTTP-gränsen)
    const attachmentSize: number = attachment.size ?? (attachment.content?.length ?? 0);
    if (attachmentSize > MAX_FILE_SIZE) {
      logger.warn('Skipping mail attachment exceeding size limit', {
        filename: attachment.filename,
        sizeMB: (attachmentSize / 1024 / 1024).toFixed(1),
        limitMB: MAX_FILE_SIZE / 1024 / 1024,
      });
      continue;
    }

    const attachId = randomUUID();
    const ext = path.extname(attachment.filename);
    const storedName = `${attachId}${ext}`;
    const filePath = path.join(uploadDir, storedName);

    // Insert DB row first, then write file. If file write fails, clean up the DB row.
    // This avoids orphaned files on disk when the DB insert would have failed.
    db.prepare(
      `INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path, file_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(attachId, ticketId, attachment.filename, storedName, attachment.size, attachment.contentType);

    try {
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(filePath, attachment.content);
      // Verifiera magiska bytes mot deklarerad MIME — samma skydd som HTTP-uppladdningar.
      // En avsändarstyrd Content-Type kan ljuga; vägra filer vars innehåll inte matchar.
      if (!hasMagicByteMatch(filePath, mime)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        db.prepare('DELETE FROM ticket_attachments WHERE id = ?').run(attachId);
        logger.warn('Skipping mail attachment failing magic-byte check', { filename: attachment.filename, mime });
        continue;
      }
    } catch (writeErr) {
      // File write failed — remove the DB row to stay consistent
      db.prepare('DELETE FROM ticket_attachments WHERE id = ?').run(attachId);
      logger.error('Failed to write attachment file, DB row cleaned up', { storedName, error: String(writeErr) });
    }
  }
}

let pollingTimer: ReturnType<typeof setTimeout> | null = null;

/** Returnerar aktuell konfigurationsstatus för inkommande e-post (IMAP). */
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
    auto_create_contact: envBool(process.env.IMAP_AUTO_CREATE_CONTACT, true),
  };
}

/**
 * Startar periodisk IMAP-polling för inkommande e-post.
 * Använder rekursiv setTimeout för att undvika överlappande polls.
 * Hämtar ny OAuth2-token inför varje poll vid OAuth2-konfiguration.
 */
export async function startEmailPolling(): Promise<void> {
  const config = await getEmailConfig();
  if (!config) {
    logger.info('IMAP not configured, email-to-ticket disabled');
    return;
  }

  const authMethod = useOAuth2() ? 'OAuth2' : 'Basic';
  logger.info('Starting email polling', {
    intervalSeconds: config.pollingInterval,
    user: config.user,
    authMethod,
  });

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
        logger.error('IMAP connection error', { error: err.message });
      });

      await client.connect();

      // Ensure "Processed" mailbox exists
      try {
        await client.mailboxCreate('Processed');
      } catch {
        // already exists
      }

      const lock = await client.getMailboxLock('INBOX');

      try {
        const uids = await client.search({ all: true }, { uid: true });
        const processedMsgUids: number[] = [];

        if (uids && uids.length > 0) {
          const messages = client.fetch(
            uids,
            { source: true, envelope: true, uid: true },
            { uid: true }
          );

          for await (const message of messages) {
            if (connectionDead) break;
            try {
              if (!message.source) continue;
              await processEmail(message.source, currentConfig);
              processedMsgUids.push(message.uid);
            } catch (error) {
              logger.error('Error processing email', { error: String(error) });
            }
          }
        }

        // Move all processed messages to "Processed" folder
        if (processedMsgUids.length > 0 && !connectionDead) {
          try {
            await client.messageMove(processedMsgUids, 'Processed', { uid: true });
            logger.info('Moved emails to Processed folder', { count: processedMsgUids.length });
          } catch (moveErr: any) {
            logger.warn('MOVE failed, trying COPY+DELETE fallback', { error: moveErr.message });
            try {
              await client.messageCopy(processedMsgUids, 'Processed', { uid: true });
              await client.messageFlagsAdd(processedMsgUids, ['\\Deleted'], { uid: true });
              logger.info('COPY+DELETE fallback succeeded', { count: processedMsgUids.length });
            } catch (fallbackErr: any) {
              logger.error('COPY+DELETE fallback also failed', { error: fallbackErr.message });
            }
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (error: any) {
      if (error?.code !== 'ETIMEOUT') {
        logger.error('IMAP polling error', { error: String(error) });
      }
      try {
        if (client) await client.logout();
      } catch {
        // ignore logout errors
      }
    }
  }

  // Recursive setTimeout instead of setInterval prevents overlapping polls when
  // an IMAP fetch takes longer than the configured interval (mailbox lock, slow
  // network). Each new poll starts only after the previous one resolves.
  const intervalMs = config.pollingInterval * 1000;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) return;
    pollingTimer = setTimeout(async () => {
      // Garantera att nästa poll alltid schemaläggs — även om poll() (mot
      // förmodan) kastar utanför sitt egna try/catch. Utan finally:n kunde
      // ett oväntat fel döda hela poll-loopen tyst tills processen startas om.
      try {
        await poll();
      } finally {
        scheduleNext();
      }
    }, intervalMs);
  };

  await poll();
  scheduleNext();

  stopPolling = () => {
    stopped = true;
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
  };
}

let stopPolling: (() => void) | null = null;

/** Stoppar den aktiva IMAP-pollingen om den körs. */
export function stopEmailPolling(): void {
  if (stopPolling) {
    stopPolling();
    stopPolling = null;
  }
}

// Exponerat enbart för enhetstester (privata för modulens normala konsumenter).
export const __test__ = {
  findTicketByMessageId,
  findTicketByShortId,
  findTicketBySubject,
  resolveOrCreateContact,
  addCommentToTicket,
  stripReplyPrefix,
  processEmail,
};
