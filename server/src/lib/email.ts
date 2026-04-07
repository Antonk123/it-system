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
    open:         { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
    'in-progress':{ bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
    waiting:      { bg: '#e0f2fe', text: '#0c4a6e', border: '#7dd3fc' },
    resolved:     { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
    closed:       { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  };
  return colors[status] || { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
};

const getPriorityColor = (priority: string): { bg: string; text: string; border: string } => {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    low:    { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
    medium: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
    high:   { bg: '#ffedd5', text: '#9a3412', border: '#fdba74' },
    urgent: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  };
  return colors[priority] || { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
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
  <![endif]-->
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style type="text/css">
    :root { color-scheme: light; }
    body, #bodyTable { margin: 0 !important; padding: 0 !important; width: 100% !important; }
    img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f0f4f8; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif;" bgcolor="#f0f4f8">
  <table id="bodyTable" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f0f4f8" style="background-color: #f0f4f8;">
    <tr>
      <td align="center" style="padding: 32px 16px;" bgcolor="#f0f4f8">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width: 600px; max-width: 600px;">

          <!-- Top brand bar -->
          <tr>
            <td style="padding-bottom: 16px;" bgcolor="#f0f4f8">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <span style="font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 12px; font-weight: 700; color: #1d6fdb; letter-spacing: 0.08em; text-transform: uppercase; mso-line-height-rule: exactly;">PREFABM&#196;STARNA</span>
                    <span style="font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 12px; font-weight: 400; color: #94a3b8; letter-spacing: 0.08em; text-transform: uppercase; mso-line-height-rule: exactly;">&#160;IT-SYSTEM</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td bgcolor="#e2e8f0" style="background-color: #e2e8f0; padding: 1px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color: #ffffff;">

                <!-- Blue accent bar -->
                <tr>
                  <td height="3" bgcolor="#1d6fdb" style="background-color: #1d6fdb; height: 3px; font-size: 0; line-height: 0; mso-line-height-rule: exactly;">
                    <!--[if mso]>&nbsp;<![endif]-->
                  </td>
                </tr>

                ${content}

                <!-- Footer -->
                <tr>
                  <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 18px 36px 22px; border-top: 1px solid #e2e8f0;">
                    <p style="margin: 0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #94a3b8; font-size: 11px; line-height: 1.6; text-align: center; mso-line-height-rule: exactly;">
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
  <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #64748b; font-size: 13px; font-weight: 500; width: 40%; mso-line-height-rule: exactly;">${label}</td>
  <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #1e293b; font-size: 13px; text-align: right; mso-line-height-rule: exactly;">${value}</td>
</tr>
`;

const formatTicketHtml = (payload: TicketEmailPayload, subject: string, appBaseUrl?: string) => {
  const categoryLabel = getCategoryLabel(payload.categoryId);
  const ticketUrl = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/tickets/${payload.id}` : null;
  const statusColor = getStatusColor(payload.status);
  const priorityColor = getPriorityColor(payload.priority);

  const content = `
    <!-- Header -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 32px 36px 24px;">
          <p style="margin: 0 0 12px 0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #1d6fdb; text-transform: uppercase; letter-spacing: 0.1em; mso-line-height-rule: exactly;">Nytt &#228;rende</p>
          <h1 style="margin: 0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #0f172a; font-size: 22px; font-weight: 700; line-height: 1.3; mso-line-height-rule: exactly;">
            ${escapeHtml(subject)}
          </h1>
        </td>
      </tr>
    </table>

    <!-- Divider -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr><td bgcolor="#e2e8f0" height="1" style="background-color: #e2e8f0; height: 1px; font-size: 0; line-height: 0; mso-line-height-rule: exactly;">&nbsp;</td></tr>
    </table>

    <!-- Content -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 28px 36px;">

          <!-- Badges -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 28px;">
            <tr>
              <td bgcolor="${statusColor.bg}" style="background-color: ${statusColor.bg}; padding: 5px 14px; border: 1px solid ${statusColor.border};">
                <span style="font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 12px; font-weight: 700; color: ${statusColor.text}; white-space: nowrap; mso-line-height-rule: exactly;">${getStatusLabel(payload.status)}</span>
              </td>
              <td width="8" style="width: 8px; font-size: 0;">&nbsp;</td>
              <td bgcolor="${priorityColor.bg}" style="background-color: ${priorityColor.bg}; padding: 5px 14px; border: 1px solid ${priorityColor.border};">
                <span style="font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 12px; font-weight: 700; color: ${priorityColor.text}; white-space: nowrap; mso-line-height-rule: exactly;">${getPriorityLabel(payload.priority)}</span>
              </td>
            </tr>
          </table>

          <!-- Info Grid -->
          ${(categoryLabel || payload.requesterName || payload.requesterEmail) ? `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 28px;">
            ${categoryLabel ? buildInfoRow('Kategori', escapeHtml(categoryLabel)) : ''}
            ${payload.requesterName ? buildInfoRow('Best&#228;llare', escapeHtml(payload.requesterName)) : ''}
            ${payload.requesterEmail ? buildInfoRow('E-post', `<a href="mailto:${escapeHtml(payload.requesterEmail)}" style="color: #1d6fdb; text-decoration: none;">${escapeHtml(payload.requesterEmail)}</a>`) : ''}
          </table>
          ` : ''}

          <!-- Description label -->
          <p style="margin: 0 0 10px 0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; mso-line-height-rule: exactly;">Beskrivning</p>

          <!-- Description block -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 32px;">
            <tr>
              <td bgcolor="#1d6fdb" width="3" style="background-color: #1d6fdb; width: 3px; font-size: 0;">&nbsp;</td>
              <td bgcolor="#f8fafc" style="background-color: #f8fafc; padding: 14px 16px;">
                <p style="margin: 0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #334155; font-size: 14px; line-height: 1.7; mso-line-height-rule: exactly;">
                  ${markdownToEmailHtml(payload.description)}
                </p>
              </td>
            </tr>
          </table>

          <!-- CTA Button -->
          ${ticketUrl ? `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td align="center" style="padding-bottom: 4px;">
                <!--[if mso]>
                <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                  href="${ticketUrl}" style="height:44px;v-text-anchor:middle;width:180px;" arcsize="18%"
                  fillcolor="#1d6fdb" strokecolor="#1d6fdb">
                  <w:anchorlock/>
                  <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:bold;">Visa &#228;rende</center>
                </v:roundrect>
                <![endif]-->
                <!--[if !mso]><!-->
                <a href="${ticketUrl}" style="display: inline-block; padding: 13px 36px; background-color: #1d6fdb; color: #ffffff; text-decoration: none; border-radius: 8px; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 14px; font-weight: 700; letter-spacing: 0.02em; mso-hide: all;">
                  Visa &#228;rende
                </a>
                <!--<![endif]-->
              </td>
            </tr>
          </table>
          ` : ''}

        </td>
      </tr>
    </table>
  `;

  return buildEmailShell(content, 'Automatisk notifiering fr&#229;n IT-&#228;rendesystemet &mdash; svara inte p&#229; detta mail.');
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
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 32px 36px 24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 14px;">
            <tr>
              <td bgcolor="#fef3c7" style="background-color: #fef3c7; padding: 4px 14px; border: 1px solid #fcd34d;">
                <span style="font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.1em; mso-line-height-rule: exactly;">P&#197;MINNELSE</span>
              </td>
            </tr>
          </table>
          <h1 style="margin: 0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #0f172a; font-size: 22px; font-weight: 700; line-height: 1.3; mso-line-height-rule: exactly;">
            ${escapeHtml(ticket.title)}
          </h1>
        </td>
      </tr>
    </table>

    <!-- Divider -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr><td bgcolor="#e2e8f0" height="1" style="background-color: #e2e8f0; height: 1px; font-size: 0; line-height: 0; mso-line-height-rule: exactly;">&nbsp;</td></tr>
    </table>

    <!-- Content -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 28px 36px;">

          ${reminderMessage ? `
          <!-- Reminder callout -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 28px;">
            <tr>
              <td bgcolor="#d97706" width="3" style="background-color: #d97706; width: 3px; font-size: 0;">&nbsp;</td>
              <td bgcolor="#fffbeb" style="background-color: #fffbeb; padding: 14px 16px;">
                <p style="margin: 0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #78350f; font-size: 14px; line-height: 1.6; font-weight: 500; mso-line-height-rule: exactly;">
                  ${escapeHtml(reminderMessage)}
                </p>
              </td>
            </tr>
          </table>
          ` : ''}

          <!-- Badges -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 28px;">
            <tr>
              <td bgcolor="${statusColor.bg}" style="background-color: ${statusColor.bg}; padding: 5px 14px; border: 1px solid ${statusColor.border};">
                <span style="font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 12px; font-weight: 700; color: ${statusColor.text}; white-space: nowrap; mso-line-height-rule: exactly;">${getStatusLabel(ticket.status)}</span>
              </td>
              <td width="8" style="width: 8px; font-size: 0;">&nbsp;</td>
              <td bgcolor="${priorityColor.bg}" style="background-color: ${priorityColor.bg}; padding: 5px 14px; border: 1px solid ${priorityColor.border};">
                <span style="font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 12px; font-weight: 700; color: ${priorityColor.text}; white-space: nowrap; mso-line-height-rule: exactly;">${getPriorityLabel(ticket.priority)}</span>
              </td>
            </tr>
          </table>

          <!-- Info Grid -->
          ${(categoryLabel || ticket.requesterName) ? `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 28px;">
            ${categoryLabel ? buildInfoRow('Kategori', escapeHtml(categoryLabel)) : ''}
            ${ticket.requesterName ? buildInfoRow('Best&#228;llare', escapeHtml(ticket.requesterName)) : ''}
          </table>
          ` : ''}

          <!-- Description label -->
          <p style="margin: 0 0 10px 0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; mso-line-height-rule: exactly;">Beskrivning</p>

          <!-- Description block -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 32px;">
            <tr>
              <td bgcolor="#1d6fdb" width="3" style="background-color: #1d6fdb; width: 3px; font-size: 0;">&nbsp;</td>
              <td bgcolor="#f8fafc" style="background-color: #f8fafc; padding: 14px 16px;">
                <p style="margin: 0; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #334155; font-size: 14px; line-height: 1.7; mso-line-height-rule: exactly;">
                  ${markdownToEmailHtml(ticket.description)}
                </p>
              </td>
            </tr>
          </table>

          <!-- CTA Button -->
          ${ticketUrl ? `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td align="center" style="padding-bottom: 4px;">
                <!--[if mso]>
                <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                  href="${ticketUrl}" style="height:44px;v-text-anchor:middle;width:180px;" arcsize="18%"
                  fillcolor="#1d6fdb" strokecolor="#1d6fdb">
                  <w:anchorlock/>
                  <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:bold;">Visa &#228;rende</center>
                </v:roundrect>
                <![endif]-->
                <!--[if !mso]><!-->
                <a href="${ticketUrl}" style="display: inline-block; padding: 13px 36px; background-color: #1d6fdb; color: #ffffff; text-decoration: none; border-radius: 8px; font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; font-size: 14px; font-weight: 700; letter-spacing: 0.02em; mso-hide: all;">
                  Visa &#228;rende
                </a>
                <!--<![endif]-->
              </td>
            </tr>
          </table>
          ` : ''}

        </td>
      </tr>
    </table>
  `;

  const html = buildEmailShell(reminderContent, 'Automatisk p&#229;minnelse fr&#229;n IT-&#228;rendesystemet &mdash; svara inte p&#229; detta mail.');

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
