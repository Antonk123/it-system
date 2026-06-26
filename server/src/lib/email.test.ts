import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Tests for sendTicketReplyEmail — the outbound agent→customer reply that closes
 * the conversation loop. Focus: RFC 5322 threading headers + thread-anchor
 * persistence for web-origin tickets. nodemailer is mocked so we capture the
 * exact sendMail options without a real SMTP connection.
 */

const { DB_PATH, sendMailMock } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-emailreply.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-emailreply-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-emailreply-0123456789abcdef0123456789abcdef';
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.EMAIL_FROM = 'support@example.com';
  process.env.EMAIL_TO = 'support@example.com';
  process.env.IMAP_USER = 'support@example.com';
  const sendMailMock = vi.fn(async () => ({ messageId: 'accepted' }));
  return { DB_PATH: dbPath, sendMailMock };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { sendTicketReplyEmail, sendAgentReplyNotificationEmail, sendSlaBreachEmail, sendTicketReceivedConfirmation } from './email.js';
import { setSetting } from './settings.js';

function makeTicket(emailMessageId: string | null): string {
  const contactId = randomUUID();
  const ticketId = randomUUID();
  db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)')
    .run(contactId, 'Kund Kundsson', 'kund@customer.example');
  db.prepare(
    `INSERT INTO tickets (id, title, description, status, priority, requester_id, email_message_id)
     VALUES (?, ?, ?, 'open', 'medium', ?, ?)`
  ).run(ticketId, 'Skrivaren krånglar', 'Den skriver inte ut', contactId, emailMessageId);
  return ticketId;
}

beforeAll(() => {
  initializeDatabase();
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('sendTicketReplyEmail threading', () => {
  it('web-origin ticket: generates a Message-ID, no In-Reply-To, and persists the anchor', async () => {
    sendMailMock.mockClear();
    const ticketId = makeTicket(null);

    await sendTicketReplyEmail({
      ticketId,
      toEmail: 'kund@customer.example',
      toName: 'Kund Kundsson',
      title: 'Skrivaren krånglar',
      body: 'Vi har bokat en tekniker till imorgon.',
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const opts = sendMailMock.mock.calls[0][0] as Record<string, unknown>;

    expect(opts.to).toBe('kund@customer.example');
    expect(String(opts.subject)).toContain(`[#${ticketId.slice(0, 8).toUpperCase()}]`);
    expect(String(opts.messageId)).toMatch(/^<reply-[0-9a-f-]{36}@example\.com>$/);
    expect(opts.inReplyTo).toBeUndefined();
    expect(opts.references).toBeUndefined();

    // The generated Message-ID is now the ticket's thread anchor.
    const row = db.prepare('SELECT email_message_id FROM tickets WHERE id = ?').get(ticketId) as { email_message_id: string };
    expect(row.email_message_id).toBe(opts.messageId);
  });

  it('email-origin ticket: threads against the existing anchor and leaves it unchanged', async () => {
    sendMailMock.mockClear();
    const anchor = '<orig-abc@customer.example>';
    const ticketId = makeTicket(anchor);

    await sendTicketReplyEmail({
      ticketId,
      toEmail: 'kund@customer.example',
      toName: 'Kund Kundsson',
      title: 'Skrivaren krånglar',
      body: 'Tack för förtydligandet.',
    });

    const opts = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.inReplyTo).toBe(anchor);
    expect(opts.references).toBe(anchor);
    expect(opts.messageId).not.toBe(anchor);

    const row = db.prepare('SELECT email_message_id FROM tickets WHERE id = ?').get(ticketId) as { email_message_id: string };
    expect(row.email_message_id).toBe(anchor);
  });
});

describe('sendAgentReplyNotificationEmail', () => {
  it('emails the assigned agent with the short id and the customer reply snippet', async () => {
    sendMailMock.mockClear();
    await sendAgentReplyNotificationEmail({
      toEmail: 'agent@itticket.local',
      toName: 'Agent A',
      ticketId: 'abc12345-0000-0000-0000-000000000000',
      title: 'Nätverket nere',
      snippet: 'kunden svarade om felet',
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const opts = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.to).toBe('agent@itticket.local');
    expect(String(opts.subject)).toContain('[#ABC12345]');
    expect(String(opts.text) + String(opts.html)).toContain('kunden svarade om felet');
  });
});

describe('sendSlaBreachEmail', () => {
  it('emails the recipient about a resolution SLA breach with the short id', async () => {
    sendMailMock.mockClear();
    await sendSlaBreachEmail({
      toEmail: 'tech@itticket.local',
      toName: 'Tech',
      ticketId: 'def67890-0000-0000-0000-000000000000',
      title: 'Servern nere',
      breachType: 'resolution',
      deadline: '2026-06-26T08:00:00.000Z',
      priority: 'critical',
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const opts = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.to).toBe('tech@itticket.local');
    expect(String(opts.subject)).toContain('[#DEF67890]');
    expect(String(opts.subject).toLowerCase()).toContain('sla');
  });
});

describe('two-way email gate (shouldEmailCustomer)', () => {
  // Default seed is '1' (on). Restore it after each test so order is irrelevant
  // and the existing threading tests (which run earlier) are unaffected.
  afterEach(() => setSetting('two_way_email_enabled', '1'));

  it('does NOT send the customer reply email when two-way is off', async () => {
    sendMailMock.mockClear();
    setSetting('two_way_email_enabled', '0');
    const ticketId = makeTicket(null);

    await sendTicketReplyEmail({
      ticketId,
      toEmail: 'kund@customer.example',
      toName: 'Kund',
      title: 'Skrivaren krånglar',
      body: 'Detta ska inte mejlas.',
    });

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('does NOT send the received-confirmation when two-way is off', async () => {
    sendMailMock.mockClear();
    setSetting('two_way_email_enabled', '0');

    await sendTicketReceivedConfirmation({
      toEmail: 'kund@customer.example',
      toName: 'Kund',
      ticketId: 'abc12345-0000-0000-0000-000000000000',
      title: 'Nytt ärende',
    });

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('sends the received-confirmation when two-way is on (control)', async () => {
    sendMailMock.mockClear();
    setSetting('two_way_email_enabled', '1');

    await sendTicketReceivedConfirmation({
      toEmail: 'kund@customer.example',
      toName: 'Kund',
      ticketId: 'abc12345-0000-0000-0000-000000000000',
      title: 'Nytt ärende',
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect((sendMailMock.mock.calls[0][0] as Record<string, unknown>).to).toBe('kund@customer.example');
  });
});
