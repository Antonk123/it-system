import nodemailer from 'nodemailer';
import { db } from '../db/connection.js';

interface TicketEmailPayload {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  categoryId: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
}

// ── Config & Transport ──────────────────────────────────────────────

const getEmailConfig = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM;
  const to = process.env.EMAIL_TO;
  const appBaseUrl = process.env.APP_BASE_URL;

  if (!host || !from || !to) {
    return null;
  }

  return { host, port, user, pass, from, to, appBaseUrl };
};

const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: user && pass ? { user, pass } : undefined,
    tls: { ciphers: 'TLSv1.2' },
  });
};

// ── Data helpers ────────────────────────────────────────────────────

const getCategoryLabel = (categoryId: string | null) => {
  if (!categoryId) return null;
  const row = db.prepare('SELECT label FROM categories WHERE id = ?').get(categoryId) as { label: string } | undefined;
  return row?.label || null;
};

const getStatusStyle = (status: string): { bg: string; text: string; dot: string } => {
  const styles: Record<string, { bg: string; text: string; dot: string }> = {
    open:          { bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6' },
    'in-progress': { bg: '#fefce8', text: '#854d0e', dot: '#eab308' },
    waiting:       { bg: '#f0f9ff', text: '#075985', dot: '#0ea5e9' },
    resolved:      { bg: '#f0fdf4', text: '#166534', dot: '#22c55e' },
    closed:        { bg: '#f8fafc', text: '#64748b', dot: '#94a3b8' },
  };
  return styles[status] || { bg: '#f8fafc', text: '#64748b', dot: '#94a3b8' };
};

const getPriorityStyle = (priority: string): { bg: string; text: string; dot: string } => {
  const styles: Record<string, { bg: string; text: string; dot: string }> = {
    low:      { bg: '#f0fdf4', text: '#166534', dot: '#22c55e' },
    medium:   { bg: '#fefce8', text: '#854d0e', dot: '#eab308' },
    high:     { bg: '#fff7ed', text: '#9a3412', dot: '#f97316' },
    critical: { bg: '#fef2f2', text: '#991b1b', dot: '#ef4444' },
  };
  return styles[priority] || { bg: '#f8fafc', text: '#64748b', dot: '#94a3b8' };
};

const getStatusLabel = (status: string): string => {
  const labels: Record<string, string> = {
    open: 'Öppen',
    'in-progress': 'Pågående',
    waiting: 'Väntar',
    resolved: 'Löst',
    closed: 'Stängd',
  };
  return labels[status] || status;
};

const getPriorityLabel = (priority: string): string => {
  const labels: Record<string, string> = {
    low: 'Låg',
    medium: 'Medium',
    high: 'Hög',
    critical: 'Kritisk',
  };
  return labels[priority] || priority;
};

// ── Text utilities ──────────────────────────────────────────────────

const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");

const markdownToEmailHtml = (text: string): string => {
  const cleanText = stripHtml(text);
  return escapeHtml(cleanText)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
};

// ── Design tokens ───────────────────────────────────────────────────
const F = `'Segoe UI', -apple-system, Helvetica, Arial, sans-serif`;
const FM = `'SF Mono', 'Cascadia Code', Consolas, monospace`;

const T = {
  bg:       '#eef2f7',
  card:     '#ffffff',
  text:     '#1a1a2e',
  textSec:  '#4a5568',
  textMut:  '#a0aec0',
  accent:   '#2563eb',
  surface:  '#f7f8fb',
  btnBg:    '#1a1a2e',
  btnText:  '#ffffff',
  line:     '#edf0f5',
};

// ── Shell ───────────────────────────────────────────────────────────

const buildEmailShell = (content: string, footerNote: string): string => `
<!DOCTYPE html>
<html lang="sv" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <!--[if mso]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:PixelsPerInch>96</o:PixelsPerInch>
      <o:AllowPNG/>
    </o:OfficeDocumentSettings>
  </xml>
  <style type="text/css">
    table { border-collapse: collapse; }
    td { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; }
  </style>
  <![endif]-->
  <style type="text/css">
    :root { color-scheme: light; }
    body, #bodyTable { margin: 0 !important; padding: 0 !important; width: 100% !important; -webkit-text-size-adjust: 100%; }
    img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${T.bg}; font-family: ${F}; -webkit-text-size-adjust: 100%;" bgcolor="${T.bg}">
  <table id="bodyTable" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${T.bg}" style="background-color: ${T.bg};">
    <tr>
      <td align="center" style="padding: 36px 16px;" bgcolor="${T.bg}">

        <!-- Brand -->
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width: 560px; max-width: 560px;">
          <tr>
            <td style="padding: 0 0 14px 2px;">
              <span style="font-family: ${F}; font-size: 13px; font-weight: 700; color: ${T.text}; letter-spacing: 0.03em; mso-line-height-rule: exactly;">Prefabm&#228;starna</span>
              <span style="font-family: ${F}; font-size: 13px; font-weight: 400; color: ${T.textMut}; mso-line-height-rule: exactly;"> &middot; IT</span>
            </td>
          </tr>
        </table>

        <!-- Card -->
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width: 560px; max-width: 560px;">
          <tr>
            <td bgcolor="${T.card}" style="background-color: ${T.card};">
              ${content}
            </td>
          </tr>
        </table>

        <!-- Spacer between card and footer -->
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width: 560px; max-width: 560px;">
          <tr><td height="24" style="height: 24px; font-size: 0; line-height: 0;">&nbsp;</td></tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width: 560px; max-width: 560px;">
          <tr>
            <td style="padding: 0 2px; border-top: 1px solid #dde3ea;">
              <p style="margin: 12px 0 0 0; font-family: ${F}; color: ${T.textMut}; font-size: 11px; line-height: 1.5; mso-line-height-rule: exactly;">
                ${footerNote}
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>
`;

// ── Reusable fragments ──────────────────────────────────────────────

const buildBadge = (label: string, style: { bg: string; text: string; dot: string }): string => `
<td style="padding-right: 12px;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td bgcolor="${style.dot}" width="6" height="6" style="width: 6px; height: 6px; font-size: 0; line-height: 0; background-color: ${style.dot};">&nbsp;</td>
      <td width="6" style="width: 6px; font-size: 0;">&nbsp;</td>
      <td style="font-family: ${F}; font-size: 12px; font-weight: 600; color: ${style.text}; white-space: nowrap; mso-line-height-rule: exactly;">${label}</td>
    </tr>
  </table>
</td>`;

const buildInfoRow = (label: string, value: string): string => `
<tr>
  <td style="padding: 8px 0; border-bottom: 1px solid ${T.line}; font-family: ${F}; color: ${T.textMut}; font-size: 13px; font-weight: 400; width: 35%; mso-line-height-rule: exactly;">${label}</td>
  <td style="padding: 8px 0; border-bottom: 1px solid ${T.line}; font-family: ${F}; color: ${T.text}; font-size: 13px; font-weight: 600; text-align: right; mso-line-height-rule: exactly;">${value}</td>
</tr>
`;

const buildCta = (url: string, label: string): string => `
<table role="presentation" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td>
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="${url}" style="height:40px;v-text-anchor:middle;width:150px;" arcsize="10%"
        fillcolor="${T.btnBg}" strokecolor="${T.btnBg}">
        <w:anchorlock/>
        <center style="color:${T.btnText};font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:600;">${label} &rarr;</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${url}" style="display: inline-block; padding: 10px 24px; background-color: ${T.btnBg}; color: ${T.btnText}; text-decoration: none; border-radius: 5px; font-family: ${F}; font-size: 13px; font-weight: 600; mso-hide: all;">
        ${label} &rarr;
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;

// ── Content builders ────────────────────────────────────────────────

const buildTicketContent = (opts: {
  typeLabel: string;
  typeLabelBg?: string;
  typeLabelColor?: string;
  title: string;
  shortId: string;
  statusLabel: string;
  statusStyle: { bg: string; text: string; dot: string };
  priorityLabel: string;
  priorityStyle: { bg: string; text: string; dot: string };
  callout?: { text: string; borderColor: string; bg: string; color: string };
  infoRows: string;
  description: string;
  ctaUrl: string | null;
}): string => `
  <!-- Header -->
  <tr>
    <td style="padding: 32px 36px 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 6px;">
        <tr>
          <td style="font-family: ${F}; font-size: 11px; font-weight: 700; color: ${opts.typeLabelColor || T.accent}; text-transform: uppercase; letter-spacing: 0.06em; mso-line-height-rule: exactly;">${opts.typeLabel}</td>
          <td align="right" style="font-family: ${FM}; font-size: 11px; color: ${T.textMut}; mso-line-height-rule: exactly;">${opts.shortId}</td>
        </tr>
      </table>
      <h1 style="margin: 0 0 16px 0; font-family: ${F}; color: ${T.text}; font-size: 21px; font-weight: 700; line-height: 1.3; mso-line-height-rule: exactly;">
        ${opts.title}
      </h1>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
        <tr>
          ${buildBadge(opts.statusLabel, opts.statusStyle)}
          ${buildBadge(opts.priorityLabel, opts.priorityStyle)}
        </tr>
      </table>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding: 0 36px 32px;">

      ${opts.callout ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 20px;">
        <tr>
          <td bgcolor="${opts.callout.bg}" style="background-color: ${opts.callout.bg}; padding: 12px 16px; border-left: 3px solid ${opts.callout.borderColor};">
            <p style="margin: 0; font-family: ${F}; color: ${opts.callout.color}; font-size: 14px; line-height: 1.5; font-weight: 600; mso-line-height-rule: exactly;">
              ${opts.callout.text}
            </p>
          </td>
        </tr>
      </table>
      ` : ''}

      ${opts.infoRows ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 20px;">
        ${opts.infoRows}
      </table>
      ` : ''}

      <p style="margin: 0 0 6px 0; font-family: ${F}; font-size: 11px; font-weight: 600; color: ${T.textSec}; letter-spacing: 0.03em; mso-line-height-rule: exactly;">Beskrivning</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
        <tr>
          <td bgcolor="${T.surface}" style="background-color: ${T.surface}; padding: 14px 16px; border-left: 3px solid ${T.accent};">
            <p style="margin: 0; font-family: ${F}; color: ${T.textSec}; font-size: 14px; line-height: 1.65; mso-line-height-rule: exactly;">
              ${opts.description}
            </p>
          </td>
        </tr>
      </table>

      ${opts.ctaUrl ? buildCta(opts.ctaUrl, 'Visa &#228;rende') : ''}

    </td>
  </tr>
`;

// ── Ticket email (created / closed) ────────────────────────────────

const formatTicketHtml = (payload: TicketEmailPayload, headerLabel: string, appBaseUrl?: string) => {
  const categoryLabel = getCategoryLabel(payload.categoryId);
  const ticketUrl = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/tickets/${payload.id}` : null;
  const shortId = payload.id.slice(0, 8).toUpperCase();

  let infoRows = '';
  if (categoryLabel) infoRows += buildInfoRow('Kategori', escapeHtml(categoryLabel));
  if (payload.requesterName) infoRows += buildInfoRow('Best&#228;llare', escapeHtml(payload.requesterName));
  if (payload.requesterEmail) infoRows += buildInfoRow('E-post', `<a href="mailto:${escapeHtml(payload.requesterEmail)}" style="color: ${T.accent}; text-decoration: none;">${escapeHtml(payload.requesterEmail)}</a>`);

  const content = buildTicketContent({
    typeLabel: headerLabel,
    title: escapeHtml(payload.title),
    shortId: `#${shortId}`,
    statusLabel: getStatusLabel(payload.status),
    statusStyle: getStatusStyle(payload.status),
    priorityLabel: getPriorityLabel(payload.priority),
    priorityStyle: getPriorityStyle(payload.priority),
    infoRows,
    description: markdownToEmailHtml(payload.description),
    ctaUrl: ticketUrl,
  });

  return buildEmailShell(content, 'Automatiskt meddelande fr&#229;n IT-&#228;rendesystemet &middot; Svara inte p&#229; detta mail');
};

// ── Send helpers ────────────────────────────────────────────────────

const sendEmail = async (subject: string, payload: TicketEmailPayload) => {
  const config = getEmailConfig();
  if (!config) {
    console.warn('Email not configured. Set SMTP_HOST, EMAIL_FROM, and EMAIL_TO to enable email.');
    return;
  }

  const transporter = createTransporter();
  if (!transporter) {
    return;
  }

  const isClosing = subject.includes('stängt');
  const html = formatTicketHtml(payload, isClosing ? '&#196;rende st&#228;ngt' : 'Nytt &#228;rende', config.appBaseUrl);
  const text = [
    subject,
    `Titel: ${payload.title}`,
    `Status: ${payload.status}`,
    `Prioritet: ${payload.priority}`,
    `Kategori: ${getCategoryLabel(payload.categoryId) || '—'}`,
    payload.requesterName ? `Beställare: ${payload.requesterName}` : null,
    payload.requesterEmail ? `Beställarens e-post: ${payload.requesterEmail}` : null,
    '',
    'Beskrivning:',
    payload.description,
    config.appBaseUrl ? `Länk: ${config.appBaseUrl.replace(/\/$/, '')}/tickets/${payload.id}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  await transporter.sendMail({
    from: config.from,
    to: config.to,
    subject,
    text,
    html,
  });
};

export const sendTicketCreatedEmail = async (payload: TicketEmailPayload) => {
  await sendEmail(`Nytt ärende skapat: ${payload.title}`, payload);
};

export const sendTicketClosedEmail = async (payload: TicketEmailPayload) => {
  await sendEmail(`Ärende stängt: ${payload.title}`, payload);
};

export const sendTicketReceivedConfirmation = async (opts: {
  toEmail: string;
  toName: string;
  ticketId: string;
  title: string;
  shareUrl?: string;
}) => {
  const transporter = createTransporter();
  const from = process.env.EMAIL_FROM;
  if (!transporter || !from) return;

  const replyTo = process.env.IMAP_USER || from;
  const shortId = opts.ticketId.slice(0, 8).toUpperCase();
  const ticketUrl = opts.shareUrl || null;

  const content = `
  <tr>
    <td style="padding: 32px 36px 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 6px;">
        <tr>
          <td style="font-family: ${F}; font-size: 11px; font-weight: 700; color: #16a34a; text-transform: uppercase; letter-spacing: 0.06em;">Bekr&#228;ftelse</td>
          <td align="right" style="font-family: ${FM}; font-size: 11px; color: ${T.textMut};">#${shortId}</td>
        </tr>
      </table>
      <h1 style="margin: 0 0 16px 0; font-family: ${F}; color: ${T.text}; font-size: 21px; font-weight: 700; line-height: 1.3;">
        Vi har mottagit ditt &#228;rende
      </h1>
    </td>
  </tr>
  <tr>
    <td style="padding: 0 36px 32px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 20px;">
        <tr>
          <td bgcolor="${T.surface}" style="background-color: ${T.surface}; padding: 14px 16px; border-left: 3px solid #16a34a;">
            <p style="margin: 0 0 4px 0; font-family: ${F}; color: ${T.textSec}; font-size: 14px; line-height: 1.65;">
              Hej ${escapeHtml(opts.toName)},
            </p>
            <p style="margin: 0 0 4px 0; font-family: ${F}; color: ${T.textSec}; font-size: 14px; line-height: 1.65;">
              Ditt &#228;rende <strong>${escapeHtml(opts.title)}</strong> har registrerats med referensnummer <strong>#${shortId}</strong>.
            </p>
            <p style="margin: 0; font-family: ${F}; color: ${T.textSec}; font-size: 14px; line-height: 1.65;">
              Vi &#229;terkommer s&#229; snart vi kan. Svara p&#229; detta mail om du vill l&#228;gga till mer information.
            </p>
          </td>
        </tr>
      </table>
      ${ticketUrl ? buildCta(ticketUrl, 'F&#246;lj &#228;rendet') : ''}
    </td>
  </tr>`;

  const html = buildEmailShell(content, 'Automatiskt meddelande fr&#229;n IT-support &middot; Prefabm&#228;starna');

  const text = [
    `Hej ${opts.toName},`,
    '',
    `Ditt ärende "${opts.title}" har registrerats med referensnummer #${shortId}.`,
    'Vi återkommer så snart vi kan. Svara på detta mail om du vill lägga till mer information.',
    '',
    ticketUrl ? `Följ ärendet: ${ticketUrl}` : null,
  ].filter(Boolean).join('\n');

  await transporter.sendMail({
    from,
    replyTo,
    to: opts.toEmail,
    subject: `[#${shortId}] Ärende mottaget: ${opts.title}`,
    text,
    html,
  }).catch(error => {
    console.error('[email-inbound] Failed to send confirmation:', error);
  });
};

// ── Reminder email ──────────────────────────────────────────────────

export const sendTicketReminderEmail = async (data: {
  ticket: TicketEmailPayload;
  reminderMessage?: string;
  userEmail: string;
  userName: string;
}) => {
  const host = process.env.SMTP_HOST;
  const from = process.env.EMAIL_FROM;
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!host || !from) {
    console.warn('Email not configured. Set SMTP_HOST and EMAIL_FROM to enable reminder emails.');
    return;
  }

  const transporter = createTransporter();
  if (!transporter) {
    return;
  }

  const { ticket, reminderMessage, userEmail, userName } = data;
  const categoryLabel = getCategoryLabel(ticket.categoryId);
  const ticketUrl = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/tickets/${ticket.id}` : null;
  const shortId = ticket.id.slice(0, 8).toUpperCase();

  const subject = `Påminnelse: ${ticket.title}`;

  let infoRows = '';
  if (categoryLabel) infoRows += buildInfoRow('Kategori', escapeHtml(categoryLabel));
  if (ticket.requesterName) infoRows += buildInfoRow('Best&#228;llare', escapeHtml(ticket.requesterName));

  const reminderContent = buildTicketContent({
    typeLabel: 'P&#229;minnelse',
    typeLabelColor: '#b45309',
    title: escapeHtml(ticket.title),
    shortId: `#${shortId}`,
    statusLabel: getStatusLabel(ticket.status),
    statusStyle: getStatusStyle(ticket.status),
    priorityLabel: getPriorityLabel(ticket.priority),
    priorityStyle: getPriorityStyle(ticket.priority),
    callout: reminderMessage ? {
      text: escapeHtml(reminderMessage),
      borderColor: '#d97706',
      bg: '#fffbeb',
      color: '#78350f',
    } : undefined,
    infoRows,
    description: markdownToEmailHtml(ticket.description),
    ctaUrl: ticketUrl,
  });

  const html = buildEmailShell(reminderContent, 'Automatisk p&#229;minnelse fr&#229;n IT-&#228;rendesystemet &middot; Svara inte p&#229; detta mail');

  const text = [
    `PÅMINNELSE: ${ticket.title}`,
    '',
    reminderMessage ? `Meddelande: ${reminderMessage}` : null,
    reminderMessage ? '' : null,
    `Status: ${getStatusLabel(ticket.status)}`,
    `Prioritet: ${getPriorityLabel(ticket.priority)}`,
    `Kategori: ${categoryLabel || '—'}`,
    ticket.requesterName ? `Beställare: ${ticket.requesterName}` : null,
    '',
    'Beskrivning:',
    ticket.description,
    '',
    ticketUrl ? `Länk: ${ticketUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  await transporter.sendMail({
    from,
    to: userEmail,
    subject,
    text,
    html,
  }).catch(error => {
    console.error('Failed to send reminder email:', error);
  });
};
