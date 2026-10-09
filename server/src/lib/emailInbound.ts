import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { convert } from 'html-to-text';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { db } from '../db/connection.js';
import { randomUUID } from 'crypto';
import { dispatchWebhook } from './webhookDispatcher.js';
import { sendTicketReceivedConfirmation } from './email.js';
import { notifyAgentOfCustomerReply, notifyStaffOfNewTicket } from './ticketNotifications.js';
import { stripQuotedReply } from './emailQuote.js';
import { logger } from './logger.js';
import { logAudit } from './auditLog.js';
import { mintShareToken } from './shares.js';
import { getSystemUserId } from './systemUser.js';
import { sanitizePlainText, sanitizeRichText } from './htmlSanitizer.js';
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

const MAX_EMAIL_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TICKET = 50;
const DEFAULT_POLL_INTERVAL_SECONDS = 60;
const MIN_POLL_INTERVAL_SECONDS = 10;

/** IMAP_POLL_INTERVAL i sekunder; ogiltigt eller för lågt värde ger default (annars hot loop vid NaN). */
function pollIntervalSeconds(): number {
  const n = parseInt(process.env.IMAP_POLL_INTERVAL || '', 10);
  return Number.isFinite(n) && n >= MIN_POLL_INTERVAL_SECONDS ? n : DEFAULT_POLL_INTERVAL_SECONDS;
}

/** Max antal nya ärenden per avsändare och dygn via e-post (skydd mot mail-loopar och spam). */
function maxTicketsPerSenderPerDay(): number {
  const n = parseInt(process.env.EMAIL_INBOUND_MAX_PER_SENDER_PER_DAY || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/** Max antal nya ärenden via e-post per timme totalt (skydd mot översvämning från förfalskade/roterande avsändare). */
function maxNewTicketsPerHour(): number {
  const n = parseInt(process.env.EMAIL_INBOUND_MAX_NEW_PER_HOUR || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 60;
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
    // Default true: IMAP körs nästan alltid över TLS (port 993). Stäng av med IMAP_SECURE=false.
    secure: envBool(process.env.IMAP_SECURE, true),
    user,
    pollingInterval: pollIntervalSeconds(),
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
  // Prefix-intervall på primärnyckeln (id är gemena UUID:n) i stället för
  // LOWER(SUBSTR(id)) som tvingar en full tabellskanning per mail.
  return db
    .prepare('SELECT id FROM tickets WHERE id >= ? AND id < ? LIMIT 1')
    .get(shortId, `${shortId}\u{10FFFF}`) as { id: string } | undefined;
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
        AND c.email = ? COLLATE NOCASE
        AND t.status NOT IN ('closed')
      ORDER BY t.created_at DESC LIMIT 1
    `)
    .get(stripped, fromAddress) as { id: string } | undefined;
}

function resolveOrCreateContact(fromAddress: string, fromName: string, autoCreate: boolean) {
  let contact = db
    .prepare('SELECT id, company_id FROM contacts WHERE email = ? COLLATE NOCASE')
    .get(fromAddress) as { id: string; company_id: string | null } | undefined;

  if (!contact && autoCreate) {
    const contactId = randomUUID();
    db.prepare('INSERT INTO contacts (id, name, email, created_at) VALUES (?, ?, ?, ?)').run(
      contactId,
      fromName,
      fromAddress,
      new Date().toISOString()
    );
    contact = { id: contactId, company_id: null };
    logger.info('Created contact from inbound email', { email: fromAddress });
  }

  return contact;
}

function addCommentToTicket(
  ticketId: string,
  body: string,
  fromAddress: string,
  fromName: string,
  opts: { internal?: boolean; messageId?: string | null } = {}
): void {
  const commentId = randomUUID();
  const now = new Date().toISOString();

  // user_id måste peka på en riktig användare (FK), men systemanvändaren säger
  // inget om vem som faktiskt skrev — avsändaren bärs av email_from_*-kolumnerna
  // (migration 071) och renderas i kommentarhuvudet, inte i brödtexten.
  db.prepare(
    `INSERT INTO ticket_comments (id, ticket_id, user_id, content, is_internal, email_from_name, email_from_address, email_message_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    commentId,
    ticketId,
    getSystemUserId(),
    sanitizeRichText(body),
    opts.internal ? 1 : 0,
    fromName,
    fromAddress,
    opts.messageId ?? null,
    now,
    now
  );

  db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, ticketId);

  logger.info('Added email comment to ticket', { ticketId, from: fromAddress, internal: !!opts.internal });
}

/**
 * Är avsändaren någon som har med ärendet att göra: beställarens kontakt-mail,
 * en tidigare e-postavsändare vars kommentar var publik (alltså redan betrodd),
 * eller en inloggad användare som kommenterat publikt? Interna anteckningar räknas
 * inte — annars kunde en avvisad avsändare göra sig betrodd genom sitt eget mail.
 */
function isTrustedSender(ticketId: string, fromAddress: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM tickets t
         JOIN contacts c ON c.id = t.requester_id
         WHERE t.id = @ticketId AND c.email = @email COLLATE NOCASE
       UNION ALL
       SELECT 1 FROM ticket_comments tc
         LEFT JOIN users u ON u.id = tc.user_id
         WHERE tc.ticket_id = @ticketId AND tc.is_internal = 0
           AND (tc.email_from_address = @email COLLATE NOCASE
                OR (tc.email_from_address IS NULL AND u.email = @email COLLATE NOCASE))
       LIMIT 1`
    )
    .get({ ticketId, email: fromAddress });
  return !!row;
}

function headerText(parsed: ParsedMail, name: string): string {
  return String(parsed.headers?.get(name) ?? '');
}

const AUTOMATED_SENDER = /^(?:mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?|bounce[+._-].*)@/i;

/** Autosvar, studsar och listpost får aldrig skapa ärenden eller bekräftelser (backscatter/mail-loop). */
function isAutomatedMail(parsed: ParsedMail, fromAddress: string): boolean {
  const autoSubmitted = headerText(parsed, 'auto-submitted').trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (/^(?:bulk|junk|auto_reply|list)\b/i.test(headerText(parsed, 'precedence').trim())) return true;
  return AUTOMATED_SENDER.test(fromAddress);
}

/** Avsändare som SPF/DMARC underkänt kan vara förfalskade och får inte skriva publikt. */
function failedSenderAuthentication(parsed: ParsedMail): boolean {
  return /\b(?:spf|dmarc)=fail\b/i.test(headerText(parsed, 'authentication-results'));
}

function emailTicketsLastHour(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ticket_history
         WHERE field_name = 'created' AND new_value = 'email'
           AND datetime(changed_at) >= datetime('now', '-1 hour')`
    )
    .get() as { n: number };
  return row.n;
}

function senderTicketsLastDay(fromAddress: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tickets t
         JOIN contacts c ON c.id = t.requester_id
         JOIN ticket_history h ON h.ticket_id = t.id AND h.field_name = 'created' AND h.new_value = 'email'
         WHERE c.email = ? COLLATE NOCASE AND datetime(t.created_at) >= datetime('now', '-1 day')`
    )
    .get(fromAddress) as { n: number };
  return row.n;
}

/**
 * Parsar ett råmail (Buffer) och skapar antingen ett nytt ärende eller lägger till
 * en kommentar på ett befintligt ärende via trådnings-/ämneslogik.
 * Bilagor sparas via saveAttachments med MIME- och storleksvalidering.
 *
 * Returnerar 'rejected' när mailet avvisats och ska läggas i Errors-mappen
 * (för stort, eller avsändaren har nått dygnsgränsen); annars 'processed'.
 *
 * Före trådningen stoppas autosvar/studsar (inga ärenden, kontakter eller
 * bekräftelser) och dubbletter på Message-ID.
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
 * Träff via 1–2 blir en publik kommentar bara om avsändaren är beställaren eller
 * redan har kommenterat publikt på ärendet och SPF/DMARC inte underkänts —
 * annars en intern anteckning, så att ett förfalskat kort-id inte kan skriva
 * i kundens tråd.
 *
 * 4. **~60-sekunders nära-dubblett-fönster** — om inget av ovan matchar men
 *    ett ärende med samma titel och avsändare skapades inom de senaste 60
 *    sekunderna, läggs mailet till som kommentar på det ärendet i stället för
 *    att skapa ett nytt (skyddar mot snabba e-postklienter som skickar dubbelt).
 *
 * Om ingen av de fyra ovan stämmer skapas ett nytt ärende.
 *
 * Avsändare som SPF/DMARC underkänt får på alla tre vägarna: kommentar som intern
 * anteckning, ingen automatiskt skapad kontakt och ingen bekräftelsemejl. Nya
 * ärenden via e-post begränsas dessutom totalt (EMAIL_INBOUND_MAX_NEW_PER_HOUR).
 */
async function processEmail(source: Buffer, config: EmailConfig): Promise<'processed' | 'rejected'> {
  // Guard against oversized emails that could OOM the process during parsing.
  // 25 MB is generous — most legitimate emails are well under 10 MB.
  if (source.length > MAX_EMAIL_BYTES) {
    logger.warn('Skipping oversized email', { sizeMB: (source.length / 1024 / 1024).toFixed(1), limitMB: 25 });
    return 'rejected';
  }

  const parsed = await simpleParser(source);

  const fromAddress = parsed.from?.value?.[0]?.address;
  const fromName = parsed.from?.value?.[0]?.name || fromAddress || '';
  const subject = sanitizePlainText(parsed.subject) || '(Inget ämne)';
  const messageId = parsed.messageId || null;
  // Gäller alla tre vägar nedan: en avsändare som SPF/DMARC underkänt kan vara
  // förfalskad och får varken skriva publikt, skapa kontakt eller få bekräftelse.
  const unverifiedSender = failedSenderAuthentication(parsed);
  const autoCreateContact = config.autoCreateContact && !unverifiedSender;

  if (!fromAddress) {
    logger.warn('Email without from address, skipping');
    return 'processed';
  }

  if (isAutomatedMail(parsed, fromAddress)) {
    logger.info('Skipping automated email (auto-reply/bounce/list)', { from: fromAddress });
    return 'processed';
  }

  // --- Deduplication: samma Message-ID har redan blivit ärende eller kommentar ---
  if (messageId) {
    const duplicate = db
      .prepare(
        `SELECT id FROM tickets WHERE email_message_id = @messageId
         UNION ALL
         SELECT ticket_id FROM ticket_comments WHERE email_message_id = @messageId
         LIMIT 1`
      )
      .get({ messageId }) as { id: string } | undefined;
    if (duplicate) {
      logger.info('Duplicate email skipped', { messageId, existingTicketId: duplicate.id });
      return 'processed';
    }
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
    // `]` undantas: html-to-text renderar länkar som `text [href]`, och ett girigt
    // `\S*` slukar den avslutande hakparentesen så att den försvinner ur ärendetexten.
    .replace(/https?:\/\/[^\s\]]*safelinks\.protection\.outlook\.com[^\s\]]*/g, (match) => {
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
    // Bara svarsvägen strippar citat. Ett vidarebefordrat mail som skapar ett
    // NYTT ärende (längre ner) måste behålla hela texten — där är citatet
    // själva innehållet.
    const replyBody = stripQuotedReply(body);

    const trusted = !unverifiedSender && isTrustedSender(existingTicket.id, fromAddress);
    if (!trusted) {
      logger.warn('Reply from unverified sender stored as internal note', {
        ticketId: existingTicket.id,
        from: fromAddress,
      });
    }

    resolveOrCreateContact(fromAddress, fromName, autoCreateContact);
    addCommentToTicket(existingTicket.id, replyBody, fromAddress, fromName, { internal: !trusted, messageId });

    if (parsed.attachments && parsed.attachments.length > 0) {
      await saveAttachments(parsed.attachments, existingTicket.id);
    }

    // Close the loop the other way: surface the customer's reply to the assigned
    // technician (webhook + push + email). Fire-and-forget.
    notifyAgentOfCustomerReply(existingTicket.id, replyBody)
      .catch((err) => logger.error('notifyAgentOfCustomerReply failed', { error: String(err) }));
    return 'processed';
  }

  // --- Deduplication: check if a ticket with same sender + similar subject was created very recently ---
  const strippedSubject = stripReplyPrefix(subject);
  if (strippedSubject) {
    const recentDuplicate = db
      .prepare(
        `SELECT t.id FROM tickets t
         JOIN contacts c ON c.id = t.requester_id
         WHERE t.title = ?
           AND c.email = ? COLLATE NOCASE
           AND datetime(t.created_at) >= datetime('now', '-60 seconds')
         LIMIT 1`
      )
      .get(strippedSubject, fromAddress) as { id: string } | undefined;

    if (recentDuplicate) {
      logger.info('Near-duplicate email, adding as comment', { subject, from: fromAddress, ticketId: recentDuplicate.id });
      resolveOrCreateContact(fromAddress, fromName, autoCreateContact);
      addCommentToTicket(recentDuplicate.id, stripQuotedReply(body), fromAddress, fromName, {
        internal: unverifiedSender,
        messageId,
      });
      if (parsed.attachments && parsed.attachments.length > 0) {
        await saveAttachments(parsed.attachments, recentDuplicate.id);
      }
      return 'processed';
    }
  }

  // --- New ticket ---
  const dailyLimit = maxTicketsPerSenderPerDay();
  if (senderTicketsLastDay(fromAddress) >= dailyLimit) {
    logger.warn('Sender exceeded daily email-ticket limit, rejecting', { from: fromAddress, limit: dailyLimit });
    return 'rejected';
  }
  const hourlyLimit = maxNewTicketsPerHour();
  if (emailTicketsLastHour() >= hourlyLimit) {
    logger.warn('Hourly email-ticket limit reached, rejecting', { from: fromAddress, limit: hourlyLimit });
    return 'rejected';
  }

  const ticketId = randomUUID();
  const now = new Date().toISOString();

  // Kontakt, ärende och historik skapas atomärt — ett fel mitt i får inte lämna
  // en halv rad som nästa poll sedan dedupar bort.
  const createTicket = db.transaction(() => {
    const contact = resolveOrCreateContact(fromAddress, fromName, autoCreateContact);
    db.prepare(
      `INSERT INTO tickets (id, title, description, status, priority, requester_id, company_id, email_message_id, created_at, updated_at)
       VALUES (?, ?, ?, 'open', 'medium', ?, ?, ?, ?, ?)`
    ).run(ticketId, subject, sanitizeRichText(body), contact?.id || null, contact?.company_id || null, messageId, now, now);

    // FTS5 synkas automatiskt via triggers (migration 050)

    db.prepare(
      'INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), ticketId, null, 'created', null, 'email', now);
  });
  createTicket();

  if (parsed.attachments && parsed.attachments.length > 0) {
    await saveAttachments(parsed.attachments, ticketId);
  }

  const { shareToken, expiresAt } = mintShareToken(db, ticketId, null);
  // logAudit kräver ett userId — mejl-in har ingen inloggad användare, så vi
  // loggar med userId null (systemhändelse), samma mönster som ticket_history-
  // raden ovan ('created'/'email' med user_id NULL).
  logAudit(null, 'share_create', 'ticket_share', ticketId, `ticket_id: ${ticketId}, expires_at: ${expiresAt}, source: email`, undefined);
  const appBaseUrl = process.env.APP_BASE_URL || '';
  const shareUrl = `${appBaseUrl.replace(/\/$/, '')}/shared/${shareToken}`;

  dispatchWebhook('ticket.created', {
    id: ticketId,
    title: subject,
    status: 'open',
    priority: 'medium',
    source: 'email',
  }).catch((err: unknown) => logger.error('dispatchWebhook failed', { error: String(err) }));

  // Fire-and-forget web-push so staff get an instant notification on their
  // installed PWA (incl. iOS) for every incoming email ticket.
  notifyStaffOfNewTicket(ticketId, subject, body)
    .catch((err) => logger.error('notifyStaffOfNewTicket failed', { error: String(err) }));

  // Ingen bekräftelse till en möjligen förfalskad avsändare (backscatter).
  if (!unverifiedSender) {
    sendTicketReceivedConfirmation({
      toEmail: fromAddress,
      toName: fromName,
      ticketId,
      title: subject,
      shareUrl,
    }).catch(error => logger.error('Confirmation email failed', { error: String(error) }));
  }

  logger.info('Created ticket from email', { ticketId, subject, from: fromAddress });
  return 'processed';
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

  // Samma tak per ärende som HTTP-uppladdningen (routes/attachments.ts)
  const existing = (db.prepare('SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_id = ?').get(ticketId) as { n: number }).n;
  let remaining = MAX_ATTACHMENTS_PER_TICKET - existing;

  // Limit to 20 attachments per email to prevent abuse
  const limited = attachments.slice(0, 20);

  for (const attachment of limited) {
    if (remaining <= 0) {
      logger.warn('Attachment limit reached for ticket, skipping the rest', { ticketId, limit: MAX_ATTACHMENTS_PER_TICKET });
      break;
    }
    if (!attachment.filename) continue;

    // En trasig bilaga får inte stoppa resten av mailets bilagor.
    try {
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
        `INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path, file_size, file_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(attachId, ticketId, attachment.filename, storedName, attachment.size, attachment.contentType, new Date().toISOString());

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
        remaining--;
      } catch (writeErr) {
        // File write failed — remove the DB row to stay consistent
        db.prepare('DELETE FROM ticket_attachments WHERE id = ?').run(attachId);
        logger.error('Failed to write attachment file, DB row cleaned up', { storedName, error: String(writeErr) });
      }
    } catch (attachErr) {
      logger.error('Failed to save mail attachment, continuing with the rest', {
        filename: attachment.filename,
        error: String(attachErr),
      });
    }
  }
}

let pollingTimer: ReturnType<typeof setTimeout> | null = null;

// UID-nycklad felräknare för dead-lettering av giftiga meddelanden. Avsiktligt
// i minnet — en omstart av processen ger ett giftigt meddelande nya försök
// från noll, vilket är acceptabelt.
const emailFailureCounts = new Map<number, number>();
const EMAIL_DEAD_LETTER_THRESHOLD = 3;

// Minimal yta av ImapFlow som poll() faktiskt använder. Låter tester injicera
// en fake-klient utan att röra prod-vägen (default = riktig ImapFlow nedan).
type ImapClientLike = Pick<
  ImapFlow,
  | 'on'
  | 'connect'
  | 'mailboxCreate'
  | 'getMailboxLock'
  | 'search'
  | 'fetch'
  | 'fetchOne'
  | 'messageMove'
  | 'messageCopy'
  | 'messageFlagsAdd'
  | 'logout'
>;
type ImapClientFactory = (options: ConstructorParameters<typeof ImapFlow>[0]) => ImapClientLike;

const defaultImapClientFactory: ImapClientFactory = (options) => new ImapFlow(options);

function isImapConfigured(): boolean {
  return !!(process.env.IMAP_HOST && process.env.IMAP_USER && (process.env.IMAP_PASS || useOAuth2()));
}

/** Returnerar aktuell konfigurationsstatus för inkommande e-post (IMAP). */
export function getEmailInboundStatus() {
  const configured = isImapConfigured();
  return {
    configured,
    active: pollingTimer !== null,
    host: process.env.IMAP_HOST || null,
    user: process.env.IMAP_USER || null,
    polling_interval: pollIntervalSeconds(),
    auto_create_contact: envBool(process.env.IMAP_AUTO_CREATE_CONTACT, true),
  };
}

/**
 * Kör ett enskilt IMAP-pollningsvarv: ansluter, listar olästa meddelanden,
 * hämtar och processar dem ett i taget och flyttar varje meddelande till
 * "Processed"/"Errors" direkt när det är klart (så att ett senare fel inte
 * gör att redan lyckade mail körs om). Utbruten till modulnivå (från en
 * tidigare nested funktion i startEmailPolling) enbart för att göra
 * `createClient` injicerbar i tester.
 *
 * `config` kan vara null om OAuth-token inte gick att hämta vid uppstart —
 * konfigurationen slås då upp på nytt här.
 */
async function poll(config: EmailConfig | null, createClient: ImapClientFactory = defaultImapClientFactory) {
  let client: ImapClientLike | null = null;
  try {
    // Refresh token each poll for OAuth2
    const currentConfig = config && !useOAuth2() ? config : await getEmailConfig();
    if (!currentConfig) return;

    client = createClient({
      host: currentConfig.host,
      port: currentConfig.port,
      secure: currentConfig.secure,
      auth: currentConfig.auth,
      logger: false as any,
      socketTimeout: 90000,
    });
    const imap = client;

    let connectionDead = false;
    imap.on('error', (err: Error) => {
      connectionDead = true;
      logger.error('IMAP connection error', { error: err.message });
    });

    await imap.connect();

    // Ensure "Processed" mailbox exists
    try {
      await imap.mailboxCreate('Processed');
    } catch {
      // already exists
    }

    // Ensure "Errors" mailbox exists (dead-letter for repeatedly failing messages)
    try {
      await imap.mailboxCreate('Errors');
    } catch {
      // already exists
    }

    const moveTo = async (uids: number[], folder: 'Processed' | 'Errors') => {
      if (connectionDead) return;
      try {
        await imap.messageMove(uids, folder, { uid: true });
        logger.info(`Moved emails to ${folder} folder`, { count: uids.length });
      } catch (moveErr: any) {
        logger.warn(`MOVE to ${folder} failed, trying COPY+DELETE fallback`, { error: moveErr.message });
        try {
          await imap.messageCopy(uids, folder, { uid: true });
          await imap.messageFlagsAdd(uids, ['\\Deleted'], { uid: true });
          logger.info(`COPY+DELETE fallback to ${folder} succeeded`, { count: uids.length });
        } catch (fallbackErr: any) {
          logger.error(`COPY+DELETE fallback to ${folder} also failed`, { error: fallbackErr.message });
        }
      }
    };

    const lock = await imap.getMailboxLock('INBOX');

    try {
      const uids = await imap.search({ all: true }, { uid: true });
      const candidateUids: number[] = [];
      const oversizedUids: number[] = [];

      // Steg 1: bara storlek + kuvert, så att ett jättemail aldrig läses in i minnet.
      // IMAP-kommandon får inte köras mitt i en fetch-ström, därför hämtas
      // själva källorna först i steg 2.
      if (uids && uids.length > 0) {
        for await (const meta of imap.fetch(uids, { uid: true, size: true, envelope: true }, { uid: true })) {
          if (connectionDead) break;
          if ((meta.size ?? 0) > MAX_EMAIL_BYTES) {
            logger.warn('Skipping oversized email', {
              uid: meta.uid,
              sizeMB: ((meta.size ?? 0) / 1024 / 1024).toFixed(1),
              limitMB: MAX_EMAIL_BYTES / 1024 / 1024,
              subject: meta.envelope?.subject,
            });
            oversizedUids.push(meta.uid);
          } else {
            candidateUids.push(meta.uid);
          }
        }
      }

      if (oversizedUids.length > 0) await moveTo(oversizedUids, 'Errors');

      for (const uid of candidateUids) {
        if (connectionDead) break;
        try {
          const message = await imap.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
          if (!message || !message.source) continue;
          const outcome = await processEmail(message.source, currentConfig);
          emailFailureCounts.delete(uid);
          await moveTo([uid], outcome === 'rejected' ? 'Errors' : 'Processed');
        } catch (error) {
          logger.error('Error processing email', { error: String(error) });
          const failureCount = (emailFailureCounts.get(uid) ?? 0) + 1;
          if (failureCount >= EMAIL_DEAD_LETTER_THRESHOLD) {
            emailFailureCounts.delete(uid);
            logger.error('Dead-lettering email after repeated failures, will not be retried', {
              uid,
              failureCount,
            });
            await moveTo([uid], 'Errors');
          } else {
            emailFailureCounts.set(uid, failureCount);
          }
        }
      }
    } finally {
      lock.release();
    }

    await imap.logout();
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

/**
 * Startar periodisk IMAP-polling för inkommande e-post.
 * Använder rekursiv setTimeout för att undvika överlappande polls.
 * Hämtar ny OAuth2-token inför varje poll vid OAuth2-konfiguration.
 * Ett tillfälligt fel vid uppstart (t.ex. token-hämtning) stoppar inte
 * pollingen — första varvet schemaläggs ändå och löser konfigurationen själv.
 */
export async function startEmailPolling(): Promise<void> {
  let config: EmailConfig | null = null;
  try {
    config = await getEmailConfig();
  } catch (error) {
    logger.error('Could not resolve IMAP config at startup, will retry on next poll', { error: String(error) });
  }
  if (!config && !isImapConfigured()) {
    logger.info('IMAP not configured, email-to-ticket disabled');
    return;
  }

  const intervalSeconds = pollIntervalSeconds();
  logger.info('Starting email polling', {
    intervalSeconds,
    user: process.env.IMAP_USER,
    authMethod: useOAuth2() ? 'OAuth2' : 'Basic',
  });

  // Recursive setTimeout instead of setInterval prevents overlapping polls when
  // an IMAP fetch takes longer than the configured interval (mailbox lock, slow
  // network). Each new poll starts only after the previous one resolves.
  const intervalMs = intervalSeconds * 1000;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) return;
    pollingTimer = setTimeout(async () => {
      // Garantera att nästa poll alltid schemaläggs — även om poll() (mot
      // förmodan) kastar utanför sitt egna try/catch. Utan finally:n kunde
      // ett oväntat fel döda hela poll-loopen tyst tills processen startas om.
      try {
        await poll(config);
      } finally {
        scheduleNext();
      }
    }, intervalMs);
  };

  stopPolling = () => {
    stopped = true;
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
  };

  await poll(config);
  scheduleNext();
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
  poll,
  emailFailureCounts,
  EMAIL_DEAD_LETTER_THRESHOLD,
};
