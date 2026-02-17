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

const getStatusColor = (status: string): { bg: string; text: string } => {
  const colors: Record<string, { bg: string; text: string }> = {
    open: { bg: '#3b82f6', text: '#ffffff' },
    'in-progress': { bg: '#f59e0b', text: '#ffffff' },
    waiting: { bg: '#6366f1', text: '#ffffff' },
    resolved: { bg: '#10b981', text: '#ffffff' },
    closed: { bg: '#6b7280', text: '#ffffff' },
  };
  return colors[status] || { bg: '#6b7280', text: '#ffffff' };
};

const getPriorityColor = (priority: string): { bg: string; text: string } => {
  const colors: Record<string, { bg: string; text: string }> = {
    low: { bg: '#e5e7eb', text: '#374151' },
    medium: { bg: '#fef3c7', text: '#92400e' },
    high: { bg: '#fecaca', text: '#991b1b' },
    urgent: { bg: '#dc2626', text: '#ffffff' },
  };
  return colors[priority] || { bg: '#e5e7eb', text: '#374151' };
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

const markdownToEmailHtml = (text: string): string =>
  escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

const formatTicketHtml = (payload: TicketEmailPayload, subject: string, appBaseUrl?: string) => {
  const categoryLabel = getCategoryLabel(payload.categoryId);
  const ticketUrl = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/tickets/${payload.id}` : null;
  const statusColor = getStatusColor(payload.status);
  const priorityColor = getPriorityColor(payload.priority);

  return `
<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 600px;">

          <!-- Header -->
          <tr>
            <td style="background-color: #f3f4f6; padding: 30px 40px; border-radius: 8px 8px 0 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="margin: 0; color: #111827; font-size: 24px; font-weight: 600; line-height: 1.3;">
                      ${escapeHtml(subject)}
                    </h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">

              <!-- Badges -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td>
                    <span style="display: inline-block; padding: 6px 12px; background-color: ${statusColor.bg}; color: ${statusColor.text}; border-radius: 6px; font-size: 13px; font-weight: 500; margin-right: 8px;">
                      ${getStatusLabel(payload.status)}
                    </span>
                    <span style="display: inline-block; padding: 6px 12px; background-color: ${priorityColor.bg}; color: ${priorityColor.text}; border-radius: 6px; font-size: 13px; font-weight: 500;">
                      ${getPriorityLabel(payload.priority)}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Info Grid -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; background-color: #f9fafb; border-radius: 8px; padding: 20px;">
                ${categoryLabel ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px; font-weight: 500;">Kategori</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">${escapeHtml(categoryLabel)}</td>
                </tr>
                ` : ''}
                ${payload.requesterName ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px; font-weight: 500;">Beställare</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">${escapeHtml(payload.requesterName)}</td>
                </tr>
                ` : ''}
                ${payload.requesterEmail ? `
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px; font-weight: 500;">E-post</td>
                  <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">
                    <a href="mailto:${escapeHtml(payload.requesterEmail)}" style="color: #667eea; text-decoration: none;">${escapeHtml(payload.requesterEmail)}</a>
                  </td>
                </tr>
                ` : ''}
              </table>

              <!-- Description -->
              <div style="margin-bottom: 32px;">
                <h3 style="margin: 0 0 12px 0; color: #374151; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  Beskrivning
                </h3>
                <div style="padding: 16px; background-color: #f9fafb; border-left: 4px solid #667eea; border-radius: 4px; color: #374151; font-size: 14px; line-height: 1.6;">
                  ${markdownToEmailHtml(payload.description)}
                </div>
              </div>

              <!-- CTA Button -->
              ${ticketUrl ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding: 12px 0;">
                    <a href="${ticketUrl}" style="display: inline-block; padding: 14px 32px; background-color: #667eea; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); mso-padding-alt: 0; text-align: center;">
                      <span style="color: #ffffff; text-decoration: none;">Öppna</span>
                    </a>
                  </td>
                </tr>
              </table>
              ` : ''}

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #f9fafb; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 12px; line-height: 1.5; text-align: center;">
                Detta är en automatisk notifiering från IT-ärendesystemet.<br>
                Svara inte på detta mail.
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
