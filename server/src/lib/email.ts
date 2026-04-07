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
  const config = getEmailConfig();
  if (!config) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port === 587,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    tls: { ciphers: 'TLSv1.2' },
  });
};

// ── Data helpers ────────────────────────────────────────────────────

const getCategoryLabel = (categoryId: string | null) => {
  if (!categoryId) return null;
  const row = db.prepare('SELECT label FROM categories WHERE id = ?').get(categoryId) as { label: string } | undefined;
  return row?.label || null;
};

const getStatusColor = (status: string): { bg: string; text: string } => {
  const colors: Record<string, { bg: string; text: string }> = {
    open:          { bg: '#dbeafe', text: '#1e40af' },
    'in-progress': { bg: '#fef9c3', text: '#854d0e' },
    waiting:       { bg: '#e0f2fe', text: '#075985' },
    resolved:      { bg: '#dcfce7', text: '#166534' },
    closed:        { bg: '#f1f5f9', text: '#475569' },
  };
  return colors[status] || { bg: '#f1f5f9', text: '#475569' };
};

const getPriorityColor = (priority: string): { bg: string; text: string } => {
  const colors: Record<string, { bg: string; text: string }> = {
    low:    { bg: '#dcfce7', text: '#166534' },
    medium: { bg: '#fef9c3', text: '#854d0e' },
    high:   { bg: '#fed7aa', text: '#9a3412' },
    urgent: { bg: '#fecaca', text: '#991b1b' },
  };
  return colors[priority] || { bg: '#f1f5f9', text: '#475569' };
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
    urgent: 'Akut',
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

// ── Shared font stacks ─────────────────────────────────────────────
const FONT = `'Source Sans 3', 'Segoe UI', Helvetica, Arial, sans-serif`;
const FONT_MONO = `'SF Mono', 'Cascadia Code', Consolas, monospace`;

// ── Design tokens ───────────────────────────────────────────────────
const T = {
  bg:        '#f1f5f9',   // slate-100
  card:      '#ffffff',
  border:    '#e2e8f0',   // slate-200
  borderAlt: '#cbd5e1',   // slate-300
  text:      '#0f172a',   // slate-900
  textSec:   '#475569',   // slate-600
  textMuted: '#94a3b8',   // slate-400
  accent:    '#0369a1',   // sky-800 — deeper, more authoritative blue
  accentLt:  '#e0f2fe',   // sky-100
  surface:   '#f8fafc',   // slate-50
  btnBg:     '#0f172a',   // slate-900 — dark, confident CTA
  btnText:   '#ffffff',
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
  <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
  <style type="text/css">
    :root { color-scheme: light; }
    body, #bodyTable { margin: 0 !important; padding: 0 !important; width: 100% !important; -webkit-text-size-adjust: 100%; }
    img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
    a { color: ${T.accent}; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${T.bg}; font-family: ${FONT}; -webkit-text-size-adjust: 100%;" bgcolor="${T.bg}">
  <table id="bodyTable" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${T.bg}" style="background-color: ${T.bg};">
    <tr>
      <td align="center" style="padding: 40px 16px;" bgcolor="${T.bg}">

        <!-- Brand mark -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width: 600px; max-width: 600px;">
          <tr>
            <td style="padding: 0 0 20px 4px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td bgcolor="${T.accent}" width="8" height="8" style="width: 8px; height: 8px; font-size: 0; line-height: 0; background-color: ${T.accent};">&nbsp;</td>
                  <td width="10" style="width: 10px; font-size: 0;">&nbsp;</td>
                  <td style="font-family: ${FONT}; font-size: 13px; font-weight: 700; color: ${T.text}; letter-spacing: 0.06em; text-transform: uppercase; mso-line-height-rule: exactly;">Prefabm&#228;starna</td>
                  <td width="6" style="width: 6px; font-size: 0;">&nbsp;</td>
                  <td style="font-family: ${FONT}; font-size: 13px; font-weight: 400; color: ${T.textMuted}; letter-spacing: 0.06em; text-transform: uppercase; mso-line-height-rule: exactly;">IT</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Card -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width: 600px; max-width: 600px;">
          <tr>
            <td bgcolor="${T.border}" style="background-color: ${T.border}; padding: 1px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${T.card}" style="background-color: ${T.card};">
                ${content}
              </table>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width: 600px; max-width: 600px;">
          <tr>
            <td style="padding: 20px 4px 0;">
              <p style="margin: 0; font-family: ${FONT}; color: ${T.textMuted}; font-size: 11px; line-height: 1.6; mso-line-height-rule: exactly;">
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

const buildBadge = (label: string, color: { bg: string; text: string }): string => `
<td bgcolor="${color.bg}" style="background-color: ${color.bg}; padding: 4px 12px; mso-line-height-rule: exactly;">
  <span style="font-family: ${FONT}; font-size: 11px; font-weight: 700; color: ${color.text}; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; mso-line-height-rule: exactly;">${label}</span>
</td>`;

const buildInfoRow = (label: string, value: string): string => `
<tr>
  <td style="padding: 9px 0; border-bottom: 1px solid ${T.border}; font-family: ${FONT}; color: ${T.textMuted}; font-size: 13px; font-weight: 400; width: 35%; mso-line-height-rule: exactly;">${label}</td>
  <td style="padding: 9px 0; border-bottom: 1px solid ${T.border}; font-family: ${FONT}; color: ${T.text}; font-size: 13px; font-weight: 600; text-align: right; mso-line-height-rule: exactly;">${value}</td>
</tr>
`;

const buildCta = (url: string, label: string): string => `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td align="left" style="padding-top: 8px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="${url}" style="height:44px;v-text-anchor:middle;width:160px;" arcsize="12%"
        fillcolor="${T.btnBg}" strokecolor="${T.btnBg}">
        <w:anchorlock/>
        <center style="color:${T.btnText};font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:bold;">${label}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${url}" style="display: inline-block; padding: 12px 28px; background-color: ${T.btnBg}; color: ${T.btnText}; text-decoration: none; border-radius: 6px; font-family: ${FONT}; font-size: 13px; font-weight: 700; letter-spacing: 0.02em; mso-hide: all;">
        ${label} &rarr;
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;

// ── Ticket email (created / closed) ────────────────────────────────

const formatTicketHtml = (payload: TicketEmailPayload, headerLabel: string, appBaseUrl?: string) => {
  const categoryLabel = getCategoryLabel(payload.categoryId);
  const ticketUrl = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/tickets/${payload.id}` : null;
  const statusColor = getStatusColor(payload.status);
  const priorityColor = getPriorityColor(payload.priority);
  const shortId = payload.id.slice(0, 8).toUpperCase();

  const content = `
    <!-- Header section -->
    <tr>
      <td bgcolor="${T.card}" style="background-color: ${T.card}; padding: 36px 40px 28px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td>
              <!-- Type label + ID -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 16px;">
                <tr>
                  <td style="font-family: ${FONT}; font-size: 12px; font-weight: 700; color: ${T.accent}; text-transform: uppercase; letter-spacing: 0.08em; mso-line-height-rule: exactly;">${headerLabel}</td>
                  <td align="right" style="font-family: ${FONT_MONO}; font-size: 11px; color: ${T.textMuted}; mso-line-height-rule: exactly;">#${shortId}</td>
                </tr>
              </table>

              <!-- Title -->
              <h1 style="margin: 0 0 20px 0; font-family: ${FONT}; color: ${T.text}; font-size: 24px; font-weight: 700; line-height: 1.25; mso-line-height-rule: exactly;">
                ${escapeHtml(payload.title)}
              </h1>

              <!-- Badges -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  ${buildBadge(getStatusLabel(payload.status), statusColor)}
                  <td width="6" style="width: 6px; font-size: 0;">&nbsp;</td>
                  ${buildBadge(getPriorityLabel(payload.priority), priorityColor)}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Divider -->
    <tr><td bgcolor="${T.border}" height="1" style="height: 1px; font-size: 0; line-height: 0;">&nbsp;</td></tr>

    <!-- Body -->
    <tr>
      <td bgcolor="${T.card}" style="background-color: ${T.card}; padding: 28px 40px 36px;">

        <!-- Info rows -->
        ${(categoryLabel || payload.requesterName || payload.requesterEmail) ? `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 28px;">
          ${categoryLabel ? buildInfoRow('Kategori', escapeHtml(categoryLabel)) : ''}
          ${payload.requesterName ? buildInfoRow('Best&#228;llare', escapeHtml(payload.requesterName)) : ''}
          ${payload.requesterEmail ? buildInfoRow('E-post', `<a href="mailto:${escapeHtml(payload.requesterEmail)}" style="color: ${T.accent}; text-decoration: none; font-weight: 600;">${escapeHtml(payload.requesterEmail)}</a>`) : ''}
        </table>
        ` : ''}

        <!-- Description -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 32px;">
          <tr>
            <td style="font-family: ${FONT}; font-size: 11px; font-weight: 700; color: ${T.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; padding-bottom: 10px; mso-line-height-rule: exactly;">Beskrivning</td>
          </tr>
          <tr>
            <td bgcolor="${T.surface}" style="background-color: ${T.surface}; padding: 16px 18px; border-left: 3px solid ${T.accent};">
              <p style="margin: 0; font-family: ${FONT}; color: ${T.textSec}; font-size: 14px; line-height: 1.7; mso-line-height-rule: exactly;">
                ${markdownToEmailHtml(payload.description)}
              </p>
            </td>
          </tr>
        </table>

        <!-- CTA -->
        ${ticketUrl ? buildCta(ticketUrl, 'Visa &#228;rende') : ''}

      </td>
    </tr>
  `;

  return buildEmailShell(content, 'Automatiskt meddelande fr&#229;n IT-&#228;rendesystemet &bull; Svara inte p&#229; detta mail');
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

  const html = formatTicketHtml(payload, subject.includes('st&#228;ngt') || subject.includes('stängt') ? '&#196;rende st&#228;ngt' : 'Nytt &#228;rende', config.appBaseUrl);
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
  const statusColor = getStatusColor(ticket.status);
  const priorityColor = getPriorityColor(ticket.priority);
  const shortId = ticket.id.slice(0, 8).toUpperCase();

  const subject = `Påminnelse: ${ticket.title}`;

  const reminderContent = `
    <!-- Header -->
    <tr>
      <td bgcolor="${T.card}" style="background-color: ${T.card}; padding: 36px 40px 28px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td>
              <!-- Type label + ID -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 16px;">
                <tr>
                  <td>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td bgcolor="#fef9c3" style="background-color: #fef9c3; padding: 3px 10px; mso-line-height-rule: exactly;">
                          <span style="font-family: ${FONT}; font-size: 11px; font-weight: 700; color: #854d0e; text-transform: uppercase; letter-spacing: 0.08em;">P&#229;minnelse</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="font-family: ${FONT_MONO}; font-size: 11px; color: ${T.textMuted}; mso-line-height-rule: exactly;">#${shortId}</td>
                </tr>
              </table>

              <!-- Title -->
              <h1 style="margin: 0 0 20px 0; font-family: ${FONT}; color: ${T.text}; font-size: 24px; font-weight: 700; line-height: 1.25; mso-line-height-rule: exactly;">
                ${escapeHtml(ticket.title)}
              </h1>

              <!-- Badges -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  ${buildBadge(getStatusLabel(ticket.status), statusColor)}
                  <td width="6" style="width: 6px; font-size: 0;">&nbsp;</td>
                  ${buildBadge(getPriorityLabel(ticket.priority), priorityColor)}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Divider -->
    <tr><td bgcolor="${T.border}" height="1" style="height: 1px; font-size: 0; line-height: 0;">&nbsp;</td></tr>

    <!-- Body -->
    <tr>
      <td bgcolor="${T.card}" style="background-color: ${T.card}; padding: 28px 40px 36px;">

        ${reminderMessage ? `
        <!-- Reminder message callout -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 28px;">
          <tr>
            <td bgcolor="#fffbeb" style="background-color: #fffbeb; padding: 14px 18px; border-left: 3px solid #d97706;">
              <p style="margin: 0; font-family: ${FONT}; color: #78350f; font-size: 14px; line-height: 1.6; font-weight: 600; mso-line-height-rule: exactly;">
                ${escapeHtml(reminderMessage)}
              </p>
            </td>
          </tr>
        </table>
        ` : ''}

        <!-- Info rows -->
        ${(categoryLabel || ticket.requesterName) ? `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 28px;">
          ${categoryLabel ? buildInfoRow('Kategori', escapeHtml(categoryLabel)) : ''}
          ${ticket.requesterName ? buildInfoRow('Best&#228;llare', escapeHtml(ticket.requesterName)) : ''}
        </table>
        ` : ''}

        <!-- Description -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 32px;">
          <tr>
            <td style="font-family: ${FONT}; font-size: 11px; font-weight: 700; color: ${T.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; padding-bottom: 10px; mso-line-height-rule: exactly;">Beskrivning</td>
          </tr>
          <tr>
            <td bgcolor="${T.surface}" style="background-color: ${T.surface}; padding: 16px 18px; border-left: 3px solid ${T.accent};">
              <p style="margin: 0; font-family: ${FONT}; color: ${T.textSec}; font-size: 14px; line-height: 1.7; mso-line-height-rule: exactly;">
                ${markdownToEmailHtml(ticket.description)}
              </p>
            </td>
          </tr>
        </table>

        <!-- CTA -->
        ${ticketUrl ? buildCta(ticketUrl, 'Visa &#228;rende') : ''}

      </td>
    </tr>
  `;

  const html = buildEmailShell(reminderContent, 'Automatisk p&#229;minnelse fr&#229;n IT-&#228;rendesystemet &bull; Svara inte p&#229; detta mail');

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
