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

const getCategoryLabel = (categoryId: string | null) => {
  if (!categoryId) return null;
  const row = db.prepare('SELECT label FROM categories WHERE id = ?').get(categoryId) as { label: string } | undefined;
  return row?.label || null;
};

const getStatusColor = (status: string): { bg: string; text: string; border: string } => {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    open:         { bg: '#0d2d5e', text: '#60a5fa', border: '#1d4ed8' },
    'in-progress':{ bg: '#2d1f00', text: '#fbbf24', border: '#d97706' },
    waiting:      { bg: '#0a2a30', text: '#22d3ee', border: '#0891b2' },
    resolved:     { bg: '#052e16', text: '#34d399', border: '#059669' },
    closed:       { bg: '#1a1f2e', text: '#94a3b8', border: '#475569' },
  };
  return colors[status] || { bg: '#1a1f2e', text: '#94a3b8', border: '#475569' };
};

const getPriorityColor = (priority: string): { bg: string; text: string; border: string } => {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    low:    { bg: '#052e16', text: '#34d399', border: '#059669' },
    medium: { bg: '#2d1f00', text: '#fbbf24', border: '#d97706' },
    high:   { bg: '#2d1200', text: '#fb923c', border: '#ea580c' },
    urgent: { bg: '#2d0000', text: '#f87171', border: '#dc2626' },
  };
  return colors[priority] || { bg: '#1a1f2e', text: '#94a3b8', border: '#475569' };
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

const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");

const markdownToEmailHtml = (text: string): string => {
  // Strip any existing HTML tags first
  const cleanText = stripHtml(text);
  // Then escape and format
  return escapeHtml(cleanText)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
};

const buildEmailShell = (content: string, footerNote: string): string => `
<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; background-color: #060d1a; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #060d1a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">

          <!-- Top brand bar -->
          <tr>
            <td style="padding-bottom: 20px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 700; color: #3b9eff; letter-spacing: 0.08em; text-transform: uppercase;">Prefabmästarna</span>
                    <span style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 400; color: #4a6080; margin-left: 6px; letter-spacing: 0.08em; text-transform: uppercase;">IT-System</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background-color: #0b1629; border-radius: 12px; border: 1px solid #162438; overflow: hidden;">
              <!-- Blue accent line at top -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="height: 3px; background: linear-gradient(90deg, #1d6fdb 0%, #3b9eff 50%, #22d3ee 100%); border-radius: 12px 12px 0 0; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
              </table>

              ${content}

              <!-- Footer -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 20px 36px 24px; border-top: 1px solid #111f35;">
                    <p style="margin: 0; font-family: 'Plus Jakarta Sans', sans-serif; color: #2e4a6a; font-size: 12px; line-height: 1.6; text-align: center;">
                      ${footerNote}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const buildInfoRow = (label: string, value: string): string => `
<tr>
  <td style="padding: 10px 0; border-bottom: 1px solid #111f35; font-family: 'Plus Jakarta Sans', sans-serif; color: #4a6080; font-size: 13px; font-weight: 500; width: 40%;">${label}</td>
  <td style="padding: 10px 0; border-bottom: 1px solid #111f35; font-family: 'Plus Jakarta Sans', sans-serif; color: #c8d9ee; font-size: 13px; text-align: right;">${value}</td>
</tr>
`;

const formatTicketHtml = (payload: TicketEmailPayload, subject: string, appBaseUrl?: string) => {
  const categoryLabel = getCategoryLabel(payload.categoryId);
  const ticketUrl = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/tickets/${payload.id}` : null;
  const statusColor = getStatusColor(payload.status);
  const priorityColor = getPriorityColor(payload.priority);

  const content = `
    <!-- Header -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td style="padding: 32px 36px 24px;">
          <p style="margin: 0 0 12px 0; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11px; font-weight: 700; color: #3b9eff; text-transform: uppercase; letter-spacing: 0.1em;">Nytt ärende</p>
          <h1 style="margin: 0; font-family: 'Plus Jakarta Sans', sans-serif; color: #e0ecff; font-size: 22px; font-weight: 700; line-height: 1.3;">
            ${escapeHtml(subject)}
          </h1>
        </td>
      </tr>
    </table>

    <!-- Divider -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td style="height: 1px; background-color: #111f35; font-size: 0;">&nbsp;</td></tr>
    </table>

    <!-- Content -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td style="padding: 28px 36px;">

          <!-- Badges -->
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
            <tr>
              <td>
                <span style="display: inline-block; padding: 5px 12px; background-color: ${statusColor.bg}; color: ${statusColor.text}; border: 1px solid ${statusColor.border}; border-radius: 20px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; font-weight: 600; margin-right: 8px; letter-spacing: 0.02em;">
                  ${getStatusLabel(payload.status)}
                </span>
                <span style="display: inline-block; padding: 5px 12px; background-color: ${priorityColor.bg}; color: ${priorityColor.text}; border: 1px solid ${priorityColor.border}; border-radius: 20px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 0.02em;">
                  ${getPriorityLabel(payload.priority)}
                </span>
              </td>
            </tr>
          </table>

          <!-- Info Grid -->
          ${(categoryLabel || payload.requesterName || payload.requesterEmail) ? `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
            ${categoryLabel ? buildInfoRow('Kategori', escapeHtml(categoryLabel)) : ''}
            ${payload.requesterName ? buildInfoRow('Beställare', escapeHtml(payload.requesterName)) : ''}
            ${payload.requesterEmail ? buildInfoRow('E-post', `<a href="mailto:${escapeHtml(payload.requesterEmail)}" style="color: #3b9eff; text-decoration: none;">${escapeHtml(payload.requesterEmail)}</a>`) : ''}
          </table>
          ` : ''}

          <!-- Description label -->
          <p style="margin: 0 0 10px 0; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11px; font-weight: 700; color: #4a6080; text-transform: uppercase; letter-spacing: 0.1em;">Beskrivning</p>

          <!-- Description block -->
          <div style="padding: 16px 18px; background-color: #071020; border-left: 3px solid #1d6fdb; border-radius: 6px; margin-bottom: 32px;">
            <p style="margin: 0; font-family: 'Plus Jakarta Sans', sans-serif; color: #90afd1; font-size: 14px; line-height: 1.7;">
              ${markdownToEmailHtml(payload.description)}
            </p>
          </div>

          <!-- CTA Button -->
          ${ticketUrl ? `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td align="center">
                <a href="${ticketUrl}" style="display: inline-block; padding: 13px 36px; background-color: #1d6fdb; color: #ffffff; text-decoration: none; border-radius: 8px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; letter-spacing: 0.02em;">
                  Visa ärende
                </a>
              </td>
            </tr>
          </table>
          ` : ''}

        </td>
      </tr>
    </table>
  `;

  return buildEmailShell(content, 'Automatisk notifiering från IT-ärendesystemet &mdash; svara inte på detta mail.');
};

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

  const html = formatTicketHtml(payload, subject, config.appBaseUrl);
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

export const sendTicketReminderEmail = async (data: {
  ticket: TicketEmailPayload;
  reminderMessage?: string;
  userEmail: string;
  userName: string;
}) => {
  const config = getEmailConfig();
  if (!config) {
    console.warn('Email not configured. Set SMTP_HOST, EMAIL_FROM, and EMAIL_TO to enable email.');
    return;
  }

  const transporter = createTransporter();
  if (!transporter) {
    return;
  }

  const { ticket, reminderMessage, userEmail, userName } = data;
  const categoryLabel = getCategoryLabel(ticket.categoryId);
  const ticketUrl = config.appBaseUrl ? `${config.appBaseUrl.replace(/\/$/, '')}/tickets/${ticket.id}` : null;
  const statusColor = getStatusColor(ticket.status);
  const priorityColor = getPriorityColor(ticket.priority);

  const subject = `Påminnelse: ${ticket.title}`;

  const reminderContent = `
    <!-- Header -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td style="padding: 32px 36px 24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 14px;">
            <tr>
              <td style="background-color: #2d1f00; border: 1px solid #d97706; border-radius: 20px; padding: 4px 14px;">
                <span style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.1em;">Paminnelse</span>
              </td>
            </tr>
          </table>
          <h1 style="margin: 0; font-family: 'Plus Jakarta Sans', sans-serif; color: #e0ecff; font-size: 22px; font-weight: 700; line-height: 1.3;">
            ${escapeHtml(ticket.title)}
          </h1>
        </td>
      </tr>
    </table>

    <!-- Divider -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td style="height: 1px; background-color: #111f35; font-size: 0;">&nbsp;</td></tr>
    </table>

    <!-- Content -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td style="padding: 28px 36px;">

          ${reminderMessage ? `
          <!-- Reminder callout -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
            <tr>
              <td style="padding: 14px 18px; background-color: #1a1200; border-left: 3px solid #d97706; border-radius: 6px;">
                <p style="margin: 0; font-family: 'Plus Jakarta Sans', sans-serif; color: #fbbf24; font-size: 14px; line-height: 1.6; font-weight: 500;">
                  ${escapeHtml(reminderMessage)}
                </p>
              </td>
            </tr>
          </table>
          ` : ''}

          <!-- Badges -->
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
            <tr>
              <td>
                <span style="display: inline-block; padding: 5px 12px; background-color: ${statusColor.bg}; color: ${statusColor.text}; border: 1px solid ${statusColor.border}; border-radius: 20px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; font-weight: 600; margin-right: 8px; letter-spacing: 0.02em;">
                  ${getStatusLabel(ticket.status)}
                </span>
                <span style="display: inline-block; padding: 5px 12px; background-color: ${priorityColor.bg}; color: ${priorityColor.text}; border: 1px solid ${priorityColor.border}; border-radius: 20px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 0.02em;">
                  ${getPriorityLabel(ticket.priority)}
                </span>
              </td>
            </tr>
          </table>

          <!-- Info Grid -->
          ${(categoryLabel || ticket.requesterName) ? `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
            ${categoryLabel ? buildInfoRow('Kategori', escapeHtml(categoryLabel)) : ''}
            ${ticket.requesterName ? buildInfoRow('Beställare', escapeHtml(ticket.requesterName)) : ''}
          </table>
          ` : ''}

          <!-- Description label -->
          <p style="margin: 0 0 10px 0; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11px; font-weight: 700; color: #4a6080; text-transform: uppercase; letter-spacing: 0.1em;">Beskrivning</p>

          <!-- Description block -->
          <div style="padding: 16px 18px; background-color: #071020; border-left: 3px solid #1d6fdb; border-radius: 6px; margin-bottom: 32px;">
            <p style="margin: 0; font-family: 'Plus Jakarta Sans', sans-serif; color: #90afd1; font-size: 14px; line-height: 1.7;">
              ${markdownToEmailHtml(ticket.description)}
            </p>
          </div>

          <!-- CTA Button -->
          ${ticketUrl ? `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td align="center">
                <a href="${ticketUrl}" style="display: inline-block; padding: 13px 36px; background-color: #1d6fdb; color: #ffffff; text-decoration: none; border-radius: 8px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; letter-spacing: 0.02em;">
                  Visa ärende
                </a>
              </td>
            </tr>
          </table>
          ` : ''}

        </td>
      </tr>
    </table>
  `;

  const html = buildEmailShell(reminderContent, 'Automatisk p&aring;minnelse fr&aring;n IT-&auml;rendesystemet &mdash; svara inte p&aring; detta mail.');

  const text = [
    `⏰ PÅMINNELSE: ${ticket.title}`,
    '',
    reminderMessage ? `Ditt meddelande: ${reminderMessage}` : null,
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
    from: config.from,
    to: userEmail,
    subject,
    text,
    html,
  }).catch(error => {
    console.error('Failed to send reminder email:', error);
  });
};
