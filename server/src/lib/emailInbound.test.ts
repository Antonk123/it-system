import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory DB + module mocks
//
// emailInbound.ts constructs its IMAP/MSAL clients lazily (inside functions),
// so importing the module is side-effect free as long as we stub the imported
// packages. We mock everything the module imports at top level, then exercise
// the pure mail-to-ticket logic against a real in-memory SQLite DB.
// vi.mock is hoisted, so all factories run before the import below.
// ─────────────────────────────────────────────────────────────────────────────

let memDb: InstanceType<typeof Database>;

vi.mock('../db/connection.js', () => {
  const proxy = {
    prepare: (...args: Parameters<InstanceType<typeof Database>['prepare']>) =>
      memDb.prepare(...args),
    transaction: (fn: () => unknown) => memDb.transaction(fn),
    pragma: vi.fn(),
    exec: vi.fn(),
  };
  return { db: proxy };
});

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// IMAP / MSAL — never actually used in these tests, but imported at top level.
vi.mock('imapflow', () => ({ ImapFlow: class {} }));
const { acquireTokenMock } = vi.hoisted(() => ({ acquireTokenMock: vi.fn() }));
vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: class {
    acquireTokenByClientCredential = acquireTokenMock;
  },
}));

// simpleParser is driven per-test via the controllable `nextParsed` variable.
// `parseError`, when set, makes simpleParser reject — used to simulate a
// message that fails processing (for the poll()/dead-letter tests below)
// without needing per-message mailparser fixtures.
let nextParsed: any = {};
let parseError: Error | null = null;
vi.mock('mailparser', () => ({
  simpleParser: vi.fn(async () => {
    if (parseError) throw parseError;
    return nextParsed;
  }),
}));

vi.mock('html-to-text', () => ({
  convert: (html: string) => html,
}));

vi.mock('./webhookDispatcher.js', () => ({
  dispatchWebhook: vi.fn(async () => undefined),
}));

vi.mock('./systemUser.js', () => ({ getSystemUserId: () => 'system-user' }));

vi.mock('./email.js', () => ({
  sendTicketReceivedConfirmation: vi.fn(async () => undefined),
}));

vi.mock('./ticketNotifications.js', () => ({
  notifyAgentOfCustomerReply: vi.fn(async () => undefined),
  notifyStaffOfNewTicket: vi.fn(async () => undefined),
}));

// attachments.ts transitively pulls multer/express/auth — must be stubbed.
vi.mock('../routes/attachments.js', () => ({
  ALLOWED_MIME_TYPES: ['text/plain', 'application/pdf'],
  ALLOWED_EXTENSIONS: ['txt', 'pdf'],
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  hasMagicByteMatch: () => true,
}));

import { __test__, startEmailPolling, stopEmailPolling, getEmailInboundStatus } from './emailInbound.js';
import { logger } from './logger.js';
import { sendTicketReceivedConfirmation } from './email.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const {
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
} = __test__;

// EmailConfig only `autoCreateContact` is read by processEmail.
const config: any = { autoCreateContact: true };

// ─────────────────────────────────────────────────────────────────────────────
// Schema — mirrors the columns each helper's SQL touches (schema.sql + the
// migrations that add company_id / email_message_id / ticket_history).
// ─────────────────────────────────────────────────────────────────────────────

function createSchema(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT
    );

    CREATE TABLE contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'medium',
      requester_id TEXT,
      company_id TEXT,
      email_message_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE ticket_comments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      is_internal INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      email_from_name TEXT DEFAULT NULL,
      email_from_address TEXT DEFAULT NULL,
      email_message_id TEXT DEFAULT NULL
    );

    CREATE TABLE ticket_history (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      user_id TEXT,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE ticket_attachments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      file_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE ticket_shares (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      share_token TEXT UNIQUE NOT NULL,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT
    );

    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      ip_address TEXT,
      api_key_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Insert helpers
// ─────────────────────────────────────────────────────────────────────────────

function insertUser(db: InstanceType<typeof Database>, id = 'system-user') {
  db.prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)').run(
    id,
    'agent@example.com',
    'Agent'
  );
  return id;
}

function insertContact(
  db: InstanceType<typeof Database>,
  opts: { id: string; name?: string; email: string; company_id?: string | null }
) {
  db.prepare(
    'INSERT INTO contacts (id, name, email, company_id) VALUES (?, ?, ?, ?)'
  ).run(opts.id, opts.name ?? 'Name', opts.email, opts.company_id ?? null);
  return opts.id;
}

function insertTicket(
  db: InstanceType<typeof Database>,
  opts: {
    id: string;
    title: string;
    requester_id?: string | null;
    status?: string;
    email_message_id?: string | null;
    // Seconds in the past for created_at. The SUT's recent-duplicate query uses
    // datetime('now', '-60 seconds'), so we must seed created_at in the SAME
    // SQLite text format (CURRENT_TIMESTAMP / datetime()) to compare correctly.
    // (Mixing in JS ISO-8601 with a 'T' would lexically sort after the
    // space-separated cutoff and corrupt the window comparison.)
    createdSecondsAgo?: number;
  }
) {
  const createdExpr =
    opts.createdSecondsAgo == null
      ? 'CURRENT_TIMESTAMP'
      : `datetime('now', '-${opts.createdSecondsAgo} seconds')`;
  db.prepare(
    `INSERT INTO tickets (id, title, description, status, requester_id, email_message_id, created_at)
     VALUES (?, ?, '', ?, ?, ?, ${createdExpr})`
  ).run(
    opts.id,
    opts.title,
    opts.status ?? 'open',
    opts.requester_id ?? null,
    opts.email_message_id ?? null
  );
  return opts.id;
}

const countTickets = () =>
  (memDb.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number }).n;
const countComments = () =>
  (memDb.prepare('SELECT COUNT(*) AS n FROM ticket_comments').get() as { n: number }).n;
const countContacts = () =>
  (memDb.prepare('SELECT COUNT(*) AS n FROM contacts').get() as { n: number }).n;

beforeEach(() => {
  vi.clearAllMocks();
  memDb = new Database(':memory:');
  createSchema(memDb);
  nextParsed = {};
  parseError = null;
  emailFailureCounts.clear();
});

afterEach(() => {
  memDb.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// stripReplyPrefix
// ─────────────────────────────────────────────────────────────────────────────

describe('stripReplyPrefix', () => {
  it('strips Re:/Sv:/Fwd: prefixes (case-insensitive) and trims', () => {
    expect(stripReplyPrefix('Re: Hello')).toBe('Hello');
    expect(stripReplyPrefix('SV: Hej')).toBe('Hej');
    expect(stripReplyPrefix('Fwd:  Spaced ')).toBe('Spaced');
    expect(stripReplyPrefix('No prefix here')).toBe('No prefix here');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findTicketByMessageId
// ─────────────────────────────────────────────────────────────────────────────

describe('findTicketByMessageId', () => {
  it('returns the ticket whose email_message_id matches one of the ids (hit)', () => {
    insertTicket(memDb, { id: 't1', title: 'A', email_message_id: '<msg-1@x>' });
    const found = findTicketByMessageId(['<other@x>', '<msg-1@x>']);
    expect(found?.id).toBe('t1');
  });

  it('returns undefined when no message-id matches (miss)', () => {
    insertTicket(memDb, { id: 't1', title: 'A', email_message_id: '<msg-1@x>' });
    expect(findTicketByMessageId(['<nope@x>'])).toBeUndefined();
  });

  it('returns undefined for an empty id list', () => {
    expect(findTicketByMessageId([])).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findTicketByShortId
// ─────────────────────────────────────────────────────────────────────────────

describe('findTicketByShortId', () => {
  it('matches [#XXXXXXXX] against the first 8 chars of the ticket id (hit)', () => {
    const id = 'abc12345-dead-beef-0000-000000000000';
    insertTicket(memDb, { id, title: 'A' });
    // bracket token is matched case-insensitively
    const found = findTicketByShortId('Re: Problem [#ABC12345]');
    expect(found?.id).toBe(id);
  });

  it('returns undefined when the subject has no [#shortid] token (miss)', () => {
    insertTicket(memDb, { id: 'abc12345-x', title: 'A' });
    expect(findTicketByShortId('Re: Problem with no token')).toBeUndefined();
  });

  it('returns undefined when token is present but matches no ticket', () => {
    insertTicket(memDb, { id: 'abc12345-x', title: 'A' });
    expect(findTicketByShortId('Re: [#FFFFFFFF]')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findTicketBySubject — including the sender-match guard
// ─────────────────────────────────────────────────────────────────────────────

describe('findTicketBySubject', () => {
  it('matches an open ticket by stripped title when sender == requester (hit)', () => {
    insertContact(memDb, { id: 'c1', email: 'alice@example.com' });
    insertTicket(memDb, { id: 't1', title: 'Broken printer', requester_id: 'c1' });

    const found = findTicketBySubject('Re: Broken printer', 'alice@example.com');
    expect(found?.id).toBe('t1');
  });

  it('does NOT attach a stranger reply to someone else\'s ticket (sender guard)', () => {
    insertContact(memDb, { id: 'c1', email: 'alice@example.com' });
    insertTicket(memDb, { id: 't1', title: 'Broken printer', requester_id: 'c1' });

    // Same subject, different sender — must NOT match.
    const found = findTicketBySubject('Re: Broken printer', 'mallory@evil.com');
    expect(found).toBeUndefined();
  });

  it('does not match a closed ticket even with matching subject + sender', () => {
    insertContact(memDb, { id: 'c1', email: 'alice@example.com' });
    insertTicket(memDb, {
      id: 't1',
      title: 'Broken printer',
      requester_id: 'c1',
      status: 'closed',
    });

    expect(findTicketBySubject('Re: Broken printer', 'alice@example.com')).toBeUndefined();
  });

  it('returns undefined when stripped subject is empty', () => {
    expect(findTicketBySubject('Re:', 'alice@example.com')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveOrCreateContact
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveOrCreateContact', () => {
  it('returns the existing contact (case-insensitive email) without inserting', () => {
    insertContact(memDb, { id: 'c1', email: 'Bob@Example.com', company_id: 'co1' });

    const before = countContacts();
    const contact = resolveOrCreateContact('bob@example.com', 'Bob', true);
    expect(contact?.id).toBe('c1');
    expect(contact?.company_id).toBe('co1');
    expect(countContacts()).toBe(before); // no new row
  });

  it('creates a new contact when none exists and autoCreate is true', () => {
    const contact = resolveOrCreateContact('new@example.com', 'New Person', true);
    expect(contact?.id).toBeTruthy();
    expect(contact?.company_id).toBeNull();

    const row = memDb
      .prepare('SELECT name, email FROM contacts WHERE id = ?')
      .get(contact!.id) as { name: string; email: string };
    expect(row.email).toBe('new@example.com');
    expect(row.name).toBe('New Person');
    expect(countContacts()).toBe(1);
  });

  it('does NOT create a contact when autoCreate is false', () => {
    const contact = resolveOrCreateContact('skip@example.com', 'Skip', false);
    expect(contact).toBeUndefined();
    expect(countContacts()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addCommentToTicket
// ─────────────────────────────────────────────────────────────────────────────

describe('addCommentToTicket', () => {
  it('stores the sender in email_from_* and keeps the body free of attribution', () => {
    insertUser(memDb);
    insertTicket(memDb, { id: 't1', title: 'A' });

    addCommentToTicket('t1', 'Here is my reply', 'alice@example.com', 'Alice');

    const rows = memDb
      .prepare(
        'SELECT ticket_id, user_id, content, is_internal, email_from_name, email_from_address FROM ticket_comments'
      )
      .all() as {
      ticket_id: string;
      user_id: string;
      content: string;
      is_internal: number;
      email_from_name: string | null;
      email_from_address: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].ticket_id).toBe('t1');
    // user_id är systemanvändaren (FK-krav) — avsändaren bärs av kolumnerna.
    expect(rows[0].user_id).toBe('system-user');
    expect(rows[0].is_internal).toBe(0);
    expect(rows[0].email_from_name).toBe('Alice');
    expect(rows[0].email_from_address).toBe('alice@example.com');
    // Ingen "**Från:**"-rad i brödtexten — den dubblerade kommentarhuvudet.
    expect(rows[0].content).toBe('Here is my reply');
  });

  it('stores an internal note with the Message-ID when asked to', () => {
    insertTicket(memDb, { id: 't1', title: 'A' });

    addCommentToTicket('t1', 'Unverified', 'x@example.com', 'X', { internal: true, messageId: '<m@x>' });

    const row = memDb.prepare('SELECT is_internal, email_message_id FROM ticket_comments').get() as {
      is_internal: number;
      email_message_id: string;
    };
    expect(row.is_internal).toBe(1);
    expect(row.email_message_id).toBe('<m@x>');
  });

  it('sanitizes script tags out of the stored body', () => {
    insertTicket(memDb, { id: 't1', title: 'A' });

    addCommentToTicket('t1', 'Hej <script>alert(1)</script><b>fet</b>', 'x@example.com', 'X');

    const row = memDb.prepare('SELECT content FROM ticket_comments').get() as { content: string };
    expect(row.content).not.toContain('<script');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// processEmail — new ticket creation + dedup paths
// ─────────────────────────────────────────────────────────────────────────────

function makeEmail(overrides: Record<string, any> = {}) {
  return {
    from: { value: [{ address: 'alice@example.com', name: 'Alice' }] },
    subject: 'Help me',
    messageId: '<m-1@x>',
    text: 'Body text',
    html: null,
    attachments: [],
    inReplyTo: undefined,
    references: undefined,
    ...overrides,
  };
}

describe('processEmail — new ticket', () => {
  it('creates a ticket, history row, and share token for a fresh email', async () => {
    insertUser(memDb);
    nextParsed = makeEmail({ subject: 'New issue', messageId: '<new-1@x>' });

    const auditCountBefore = (
      memDb
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'share_create'")
        .get() as { n: number }
    ).n;

    await processEmail(Buffer.from('raw'), config);

    expect(countTickets()).toBe(1);
    const ticket = memDb
      .prepare('SELECT id, title, status, email_message_id FROM tickets')
      .get() as { id: string; title: string; status: string; email_message_id: string };
    expect(ticket.title).toBe('New issue');
    expect(ticket.status).toBe('open');
    expect(ticket.email_message_id).toBe('<new-1@x>');

    expect(
      (memDb.prepare('SELECT COUNT(*) AS n FROM ticket_history').get() as { n: number }).n
    ).toBe(1);
    expect(
      (memDb.prepare('SELECT COUNT(*) AS n FROM ticket_shares').get() as { n: number }).n
    ).toBe(1);
    // Token minted via the shared mintShareToken() helper: 16 bytes = 32 hex
    // chars (fixes the previous inconsistent randomBytes(12) here), and an
    // expiry must be set (no more eternal share tokens from email-in).
    const share = memDb
      .prepare('SELECT share_token, expires_at FROM ticket_shares')
      .get() as { share_token: string; expires_at: string | null };
    expect(share.share_token).toMatch(/^[0-9a-f]{32}$/);
    expect(share.expires_at).toBeTruthy();
    // auto-created the unknown sender as a contact
    expect(countContacts()).toBe(1);

    // Mail-in share creation must be audited too: system-triggered (no user),
    // traceable to the ticket and its email origin.
    const auditCountAfter = (
      memDb
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'share_create'")
        .get() as { n: number }
    ).n;
    expect(auditCountAfter).toBe(auditCountBefore + 1);

    const auditRow = memDb
      .prepare("SELECT user_id, details FROM audit_log WHERE action = 'share_create'")
      .get() as { user_id: string | null; details: string | null };
    expect(auditRow.user_id).toBeNull();
    expect(auditRow.details).toContain(ticket.id);
    expect(auditRow.details).toContain('source: email');
  });

  it('skips an email that has no from address', async () => {
    nextParsed = makeEmail({ from: { value: [{ address: undefined, name: 'X' }] } });
    await processEmail(Buffer.from('raw'), config);
    expect(countTickets()).toBe(0);
  });
});

describe('processEmail — exact message-id dedup', () => {
  it('does NOT create a second ticket when the same message-id was already seen', async () => {
    insertUser(memDb);
    // A ticket already exists with this exact email_message_id (but no thread refs).
    insertTicket(memDb, { id: 't-existing', title: 'Orig', email_message_id: '<dup-1@x>' });

    nextParsed = makeEmail({
      subject: 'Totally different subject', // avoid subject-threading
      messageId: '<dup-1@x>',
    });

    await processEmail(Buffer.from('raw'), config);

    // No new ticket, no comment — pure dedup short-circuit.
    expect(countTickets()).toBe(1);
    expect(countComments()).toBe(0);
  });
});

describe('processEmail — ~60s near-duplicate window', () => {
  it('adds the email as a comment (not a new ticket) when same sender+subject created <60s ago', async () => {
    insertUser(memDb);
    const contactId = insertContact(memDb, { id: 'c1', email: 'alice@example.com' });
    // Ticket created "just now" with the same title and requester, but a
    // DIFFERENT message-id so the exact-id dedup does not fire first.
    insertTicket(memDb, {
      id: 't-recent',
      title: 'Repeated subject',
      requester_id: contactId,
      email_message_id: '<earlier@x>',
      createdSecondsAgo: 5, // well inside the 60s window
    });

    nextParsed = makeEmail({
      subject: 'Repeated subject', // no Re: prefix → subject-threading skipped, hits recent-dup branch
      messageId: '<later@x>',
    });

    await processEmail(Buffer.from('raw'), config);

    // No new ticket; the body is appended as a comment to the recent ticket.
    expect(countTickets()).toBe(1);
    const comments = memDb
      .prepare('SELECT ticket_id, content FROM ticket_comments')
      .all() as { ticket_id: string; content: string }[];
    expect(comments).toHaveLength(1);
    expect(comments[0].ticket_id).toBe('t-recent');
    expect(comments[0].content).toContain('Body text');
  });

  it('creates a new ticket when an identical-subject ticket is OLDER than 60s', async () => {
    insertUser(memDb);
    const contactId = insertContact(memDb, { id: 'c1', email: 'alice@example.com' });
    // Created 5 minutes ago → outside the 60s window.
    insertTicket(memDb, {
      id: 't-old',
      title: 'Repeated subject',
      requester_id: contactId,
      email_message_id: '<old@x>',
      createdSecondsAgo: 300,
    });

    nextParsed = makeEmail({
      subject: 'Repeated subject',
      messageId: '<fresh@x>',
    });

    await processEmail(Buffer.from('raw'), config);

    // A brand-new ticket is created; no comment added to the old one.
    expect(countTickets()).toBe(2);
    expect(countComments()).toBe(0);
  });
});

describe('processEmail — threading attaches reply to existing ticket', () => {
  it('appends a comment via In-Reply-To message-id match instead of creating a ticket', async () => {
    insertUser(memDb);
    insertContact(memDb, { id: 'c1', email: 'alice@example.com' });
    insertTicket(memDb, {
      id: 't-thread',
      title: 'Original',
      requester_id: 'c1',
      email_message_id: '<root@x>',
    });

    nextParsed = makeEmail({
      subject: 'Re: Original',
      messageId: '<reply@x>',
      inReplyTo: '<root@x>',
    });

    await processEmail(Buffer.from('raw'), config);

    expect(countTickets()).toBe(1); // no new ticket
    const comments = memDb
      .prepare('SELECT ticket_id FROM ticket_comments')
      .all() as { ticket_id: string }[];
    expect(comments).toHaveLength(1);
    expect(comments[0].ticket_id).toBe('t-thread');
  });

  it('strips the quoted thread so the reply comment holds only the new text', async () => {
    insertUser(memDb);
    insertContact(memDb, { id: 'c1', email: 'alice@example.com' });
    insertTicket(memDb, {
      id: 't-thread',
      title: 'Original',
      requester_id: 'c1',
      email_message_id: '<root@x>',
    });

    nextParsed = makeEmail({
      subject: 'Re: Original',
      messageId: '<reply@x>',
      inReplyTo: '<root@x>',
      text: [
        'Ja, jag har kollat med min chef. Vi har slut på licenser..',
        '',
        'Från: Prefabmästarna Sverige AB noreply@example.com',
        'Datum: onsdag, 19 augusti 2026 08:36',
        'Till: Alice alice@example.com',
        'Ämne: [#4D684770] Beställning av licens',
        '',
        'Är detta godkänt? Kolla om chefen godkänner inköp först',
      ].join('\n'),
    });

    await processEmail(Buffer.from('raw'), config);

    const comments = memDb
      .prepare('SELECT content FROM ticket_comments')
      .all() as { content: string }[];
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe('Ja, jag har kollat med min chef. Vi har slut på licenser..');
    expect(comments[0].content).not.toContain('Är detta godkänt?');
    expect(comments[0].content).not.toContain('Datum:');
  });

  it('does NOT strip quoted text when the email creates a NEW ticket (forward)', async () => {
    insertUser(memDb);
    const forwarded = [
      'Kan ni titta på det här?',
      '',
      '-----Ursprungligt meddelande-----',
      'Från: Kund kund@example.com',
      'Ämne: Skrivaren fungerar inte',
      '',
      'Skrivaren på plan 2 skriver bara ut blanka sidor.',
    ].join('\n');

    nextParsed = makeEmail({ subject: 'VS: Skrivaren', messageId: '<fwd@x>', text: forwarded });

    await processEmail(Buffer.from('raw'), config);

    const ticket = memDb
      .prepare('SELECT description FROM tickets')
      .get() as { description: string };
    expect(ticket.description).toContain('Skrivaren på plan 2 skriver bara ut blanka sidor.');
    expect(ticket.description).toBe(forwarded);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// poll() — IMAP poll loop: dead-letter threshold, MOVE→COPY+DELETE fallback,
// and the successful-processing path.
//
// A scripted fake ImapFlow stands in for the real client via poll()'s
// injectable `createClient` factory (see emailInbound.ts). The fake tracks
// its own in-memory "mailbox" (a uid -> source Buffer map) and removes uids
// on messageMove/messageFlagsAdd(\Deleted), mirroring how a real IMAP server
// would no longer return a moved/expunged message on a subsequent search —
// this is what lets the tests prove a dead-lettered message is never
// reprocessed by a later poll() call.
// ─────────────────────────────────────────────────────────────────────────────

interface FakeImapCall {
  uids: number[];
  mailbox: string;
}

class FakeImapClient {
  connectCalls = 0;
  logoutCalls = 0;
  moveCalls: FakeImapCall[] = [];
  copyCalls: FakeImapCall[] = [];
  flagsAddCalls: { uids: number[]; flags: string[] }[] = [];
  fetchOneCalls: number[] = [];
  sizes = new Map<number, number>();
  private readonly moveShouldThrow: boolean;
  private readonly messages: Map<number, Buffer>;

  constructor(initialMessages: Record<number, Buffer>, opts: { moveShouldThrow?: boolean } = {}) {
    this.messages = new Map(Object.entries(initialMessages).map(([uid, source]) => [Number(uid), source]));
    this.moveShouldThrow = !!opts.moveShouldThrow;
  }

  get inboxUids(): number[] {
    return Array.from(this.messages.keys());
  }

  on(): void {
    // No test here simulates a mid-poll connection-level 'error' event.
  }

  async connect(): Promise<void> {
    this.connectCalls++;
  }

  async mailboxCreate(): Promise<void> {
    // Pretend "Processed"/"Errors" already exist, like the real ImapFlow catch-and-ignore path.
  }

  async getMailboxLock(): Promise<{ release: () => void }> {
    return { release: () => {} };
  }

  async search(): Promise<number[]> {
    return this.inboxUids;
  }

  async *fetch(uids: number[]): AsyncGenerator<{ uid: number; size: number; envelope: { subject: string } }> {
    for (const uid of uids) {
      const source = this.messages.get(uid);
      if (source) yield { uid, size: this.sizes.get(uid) ?? source.length, envelope: { subject: 'fake' } };
    }
  }

  async fetchOne(uid: string): Promise<{ uid: number; source: Buffer } | false> {
    this.fetchOneCalls.push(Number(uid));
    const source = this.messages.get(Number(uid));
    return source ? { uid: Number(uid), source } : false;
  }

  async messageMove(uids: number[], mailbox: string): Promise<void> {
    if (this.moveShouldThrow) throw new Error('MOVE not supported by server');
    this.moveCalls.push({ uids, mailbox });
    for (const uid of uids) this.messages.delete(uid);
  }

  async messageCopy(uids: number[], mailbox: string): Promise<void> {
    this.copyCalls.push({ uids, mailbox });
  }

  async messageFlagsAdd(uids: number[], flags: string[]): Promise<void> {
    this.flagsAddCalls.push({ uids, flags });
    // Real servers expunge \Deleted-flagged messages; approximate that here
    // so a subsequent poll() no longer sees them (same effect as a MOVE).
    for (const uid of uids) this.messages.delete(uid);
  }

  async logout(): Promise<void> {
    this.logoutCalls++;
  }
}

// EmailConfig fields poll() actually reads: host/port/secure/auth (forwarded
// to createClient) and autoCreateContact (forwarded into processEmail).
const pollConfig: any = {
  host: 'imap.example.com',
  port: 993,
  secure: true,
  user: 'inbox@example.com',
  pollingInterval: 60,
  autoCreateContact: true,
  auth: { user: 'inbox@example.com', pass: 'secret' },
};

describe('poll — dead-letter threshold', () => {
  it('dead-letters a message to Errors after EMAIL_DEAD_LETTER_THRESHOLD consecutive failures, then never reprocesses it', async () => {
    const uid = 101;
    const fakeClient = new FakeImapClient({ [uid]: Buffer.from('raw-email') });
    parseError = new Error('simulated processing failure');

    // Fails below the threshold: message stays in the inbox, counter increments, no move yet.
    for (let i = 1; i < EMAIL_DEAD_LETTER_THRESHOLD; i++) {
      await poll(pollConfig, () => fakeClient as any);
      expect(emailFailureCounts.get(uid)).toBe(i);
      expect(fakeClient.moveCalls).toHaveLength(0);
      expect(fakeClient.inboxUids).toEqual([uid]);
    }

    // The Nth failure crosses the threshold: dead-lettered to "Errors", counter cleared.
    await poll(pollConfig, () => fakeClient as any);
    expect(emailFailureCounts.has(uid)).toBe(false);
    expect(fakeClient.moveCalls).toEqual([{ uids: [uid], mailbox: 'Errors' }]);
    expect(fakeClient.inboxUids).toEqual([]);

    // A further poll cannot see the message any more (it's gone from the
    // mailbox, like a real IMAP server after the move) — proves it is not
    // reprocessed and no second "Errors" move happens.
    await poll(pollConfig, () => fakeClient as any);
    expect(fakeClient.moveCalls).toHaveLength(1);
  });
});

describe('poll — MOVE→COPY+DELETE fallback', () => {
  it('falls back to COPY+DELETE for the Errors move when messageMove throws', async () => {
    const uid = 202;
    const fakeClient = new FakeImapClient({ [uid]: Buffer.from('raw-email') }, { moveShouldThrow: true });
    parseError = new Error('simulated processing failure');

    for (let i = 0; i < EMAIL_DEAD_LETTER_THRESHOLD; i++) {
      await poll(pollConfig, () => fakeClient as any);
    }

    expect(fakeClient.moveCalls).toHaveLength(0); // MOVE always throws
    expect(fakeClient.copyCalls).toEqual([{ uids: [uid], mailbox: 'Errors' }]);
    expect(fakeClient.flagsAddCalls).toEqual([{ uids: [uid], flags: ['\\Deleted'] }]);
    expect(emailFailureCounts.has(uid)).toBe(false);
    expect(fakeClient.inboxUids).toEqual([]);
  });

  it('falls back to COPY+DELETE for the Processed move when messageMove throws', async () => {
    const uid = 303;
    const fakeClient = new FakeImapClient({ [uid]: Buffer.from('raw-email') }, { moveShouldThrow: true });
    nextParsed = makeEmail({ subject: 'Fallback success', messageId: '<fallback-1@x>' });

    await poll(pollConfig, () => fakeClient as any);

    expect(fakeClient.moveCalls).toHaveLength(0);
    expect(fakeClient.copyCalls).toEqual([{ uids: [uid], mailbox: 'Processed' }]);
    expect(fakeClient.flagsAddCalls).toEqual([{ uids: [uid], flags: ['\\Deleted'] }]);
    expect(countTickets()).toBe(1);
  });
});

describe('poll — successful processing', () => {
  it('moves a successfully processed message to Processed and never dead-letters it', async () => {
    const uid = 404;
    const fakeClient = new FakeImapClient({ [uid]: Buffer.from('raw-email') });
    nextParsed = makeEmail({ subject: 'All good', messageId: '<ok-1@x>' });

    await poll(pollConfig, () => fakeClient as any);

    expect(fakeClient.moveCalls).toEqual([{ uids: [uid], mailbox: 'Processed' }]);
    expect(emailFailureCounts.has(uid)).toBe(false);
    expect(countTickets()).toBe(1);
  });

  it('clears the failure counter for a message that fails once then succeeds on retry (does not accumulate toward dead-letter)', async () => {
    const uid = 505;
    const fakeClient = new FakeImapClient({ [uid]: Buffer.from('raw-email') });

    parseError = new Error('transient failure');
    await poll(pollConfig, () => fakeClient as any);
    expect(emailFailureCounts.get(uid)).toBe(1);
    expect(fakeClient.moveCalls).toHaveLength(0); // still under threshold, stays in inbox

    parseError = null;
    nextParsed = makeEmail({ subject: 'Recovered', messageId: '<recovered-1@x>' });
    await poll(pollConfig, () => fakeClient as any);

    expect(emailFailureCounts.has(uid)).toBe(false);
    expect(fakeClient.moveCalls).toEqual([{ uids: [uid], mailbox: 'Processed' }]);
    expect(countTickets()).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit-fixar: autosvar, avsändarkontroll, dubbletter, tak, transaktion
// ─────────────────────────────────────────────────────────────────────────────

const headers = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe('processEmail — autosvar och studsar', () => {
  it.each([
    ['Auto-Submitted: auto-replied', { 'auto-submitted': 'auto-replied' }, 'alice@example.com'],
    ['Precedence: bulk', { precedence: 'bulk' }, 'alice@example.com'],
    ['Precedence: auto_reply', { precedence: 'auto_reply' }, 'alice@example.com'],
    ['MAILER-DAEMON-avsändare', {}, 'MAILER-DAEMON@mail.example.com'],
    ['noreply-avsändare', {}, 'no-reply@vendor.example'],
    ['postmaster-avsändare', {}, 'postmaster@vendor.example'],
  ])('skapar varken ärende, kontakt eller bekräftelse för %s', async (_label, hdrs, from) => {
    nextParsed = makeEmail({ from: { value: [{ address: from, name: 'X' }] }, headers: headers(hdrs) });

    const outcome = await processEmail(Buffer.from('raw'), config);

    expect(outcome).toBe('processed');
    expect(countTickets()).toBe(0);
    expect(countContacts()).toBe(0);
    expect(sendTicketReceivedConfirmation).not.toHaveBeenCalled();
  });

  it('behandlar X-Auto-Response-Suppress som vanlig post (Exchange stämplar även mänskliga mail)', async () => {
    insertUser(memDb);
    nextParsed = makeEmail({ headers: headers({ 'x-auto-response-suppress': 'DR, RN, NRN, OOF' }) });

    await processEmail(Buffer.from('raw'), config);

    expect(countTickets()).toBe(1);
  });

  it('släpper igenom Auto-Submitted: no', async () => {
    insertUser(memDb);
    nextParsed = makeEmail({ headers: headers({ 'auto-submitted': 'no' }) });

    await processEmail(Buffer.from('raw'), config);

    expect(countTickets()).toBe(1);
  });
});

describe('processEmail — svar på befintligt ärende kräver betrodd avsändare', () => {
  const ticketId = 'abc12345-0000-4000-8000-000000000000';

  function seedTicket() {
    insertUser(memDb);
    insertContact(memDb, { id: 'c1', email: 'alice@example.com' });
    insertTicket(memDb, { id: ticketId, title: 'Skrivare', requester_id: 'c1' });
  }

  const lastComment = () =>
    memDb.prepare('SELECT is_internal, email_from_address FROM ticket_comments').get() as {
      is_internal: number;
      email_from_address: string;
    };

  it('beställaren (skiftlägesokänsligt) får publik kommentar via kort-id', async () => {
    seedTicket();
    nextParsed = makeEmail({
      from: { value: [{ address: 'ALICE@Example.com', name: 'Alice' }] },
      subject: 'Re: Skrivare [#ABC12345]',
      messageId: '<r1@x>',
    });

    await processEmail(Buffer.from('raw'), config);

    expect(lastComment().is_internal).toBe(0);
  });

  it('en obekant avsändare med rätt kort-id blir en intern anteckning', async () => {
    seedTicket();
    nextParsed = makeEmail({
      from: { value: [{ address: 'mallory@evil.example', name: 'Mallory' }] },
      subject: 'Re: Skrivare [#ABC12345]',
      messageId: '<r2@x>',
    });

    await processEmail(Buffer.from('raw'), config);

    expect(countTickets()).toBe(1);
    expect(lastComment()).toEqual({ is_internal: 1, email_from_address: 'mallory@evil.example' });
  });

  it('SPF/DMARC-fail gör även beställaren obetrodd', async () => {
    seedTicket();
    nextParsed = makeEmail({
      subject: 'Re: Skrivare [#ABC12345]',
      messageId: '<r3@x>',
      headers: headers({ 'authentication-results': 'mx.example; spf=pass; dmarc=fail action=none' }),
    });

    await processEmail(Buffer.from('raw'), config);

    expect(lastComment().is_internal).toBe(1);
  });

  it('en tidigare publik e-postavsändare på ärendet är betrodd, en intern anteckning ger ingen tillit', async () => {
    seedTicket();
    memDb.prepare(
      `INSERT INTO ticket_comments (id, ticket_id, user_id, content, is_internal, email_from_address)
       VALUES ('k1', ?, 'system-user', 'hej', 0, 'kollega@example.com'),
              ('k2', ?, 'system-user', 'hej', 1, 'mallory@evil.example')`
    ).run(ticketId, ticketId);

    for (const [from, id] of [['Kollega@example.com', '<r4@x>'], ['mallory@evil.example', '<r5@x>']]) {
      nextParsed = makeEmail({
        from: { value: [{ address: from, name: 'X' }] },
        subject: 'Re: Skrivare [#ABC12345]',
        messageId: id,
      });
      await processEmail(Buffer.from('raw'), config);
    }

    const rows = memDb
      .prepare("SELECT is_internal FROM ticket_comments WHERE email_message_id IN ('<r4@x>', '<r5@x>') ORDER BY email_message_id")
      .all() as { is_internal: number }[];
    expect(rows.map((r) => r.is_internal)).toEqual([0, 1]);
  });
});

describe('processEmail — avsändare som underkänts av SPF/DMARC', () => {
  const failing = { 'authentication-results': 'mx.example; spf=fail smtp.mailfrom=alice@example.com' };

  it('nytt ärende: ingen kontakt skapas och ingen bekräftelse skickas', async () => {
    insertUser(memDb);
    nextParsed = makeEmail({ messageId: '<spoof-new@x>', headers: headers(failing) });

    expect(await processEmail(Buffer.from('raw'), config)).toBe('processed');

    expect(countTickets()).toBe(1);
    expect(countContacts()).toBe(0);
    expect(sendTicketReceivedConfirmation).not.toHaveBeenCalled();
  });

  it('nytt ärende från en verifierad avsändare får fortfarande kontakt och bekräftelse', async () => {
    insertUser(memDb);
    nextParsed = makeEmail({
      messageId: '<ok-new@x>',
      headers: headers({ 'authentication-results': 'mx.example; spf=pass; dmarc=pass' }),
    });

    await processEmail(Buffer.from('raw'), config);

    expect(countContacts()).toBe(1);
    expect(sendTicketReceivedConfirmation).toHaveBeenCalledTimes(1);
  });

  it('nära-dubblett: kommentaren blir intern', async () => {
    insertUser(memDb);
    insertContact(memDb, { id: 'c1', email: 'alice@example.com' });
    insertTicket(memDb, { id: 't1', title: 'Help me', requester_id: 'c1', createdSecondsAgo: 5 });
    nextParsed = makeEmail({ messageId: '<dup-2@x>', headers: headers(failing) });

    await processEmail(Buffer.from('raw'), config);

    expect(countTickets()).toBe(1);
    const row = memDb.prepare("SELECT is_internal FROM ticket_comments WHERE email_message_id = '<dup-2@x>'").get() as { is_internal: number };
    expect(row.is_internal).toBe(1);
  });

  it('trådsvar: ingen kontakt skapas och kommentaren blir intern', async () => {
    insertUser(memDb);
    insertTicket(memDb, { id: 'abc12345-0000-4000-8000-000000000000', title: 'Skrivare' });
    nextParsed = makeEmail({
      from: { value: [{ address: 'mallory@evil.example', name: 'Mallory' }] },
      subject: 'Re: Skrivare [#ABC12345]',
      messageId: '<spoof-thread@x>',
      headers: headers(failing),
    });

    await processEmail(Buffer.from('raw'), config);

    expect(countContacts()).toBe(0);
    const row = memDb.prepare('SELECT is_internal FROM ticket_comments').get() as { is_internal: number };
    expect(row.is_internal).toBe(1);
  });
});

describe('processEmail — timtak för nya ärenden via e-post', () => {
  afterEach(() => {
    delete process.env.EMAIL_INBOUND_MAX_NEW_PER_HOUR;
  });

  it("avvisar ('rejected') nya ärenden över taket oavsett avsändare, men släpper igenom svar", async () => {
    insertUser(memDb);
    process.env.EMAIL_INBOUND_MAX_NEW_PER_HOUR = '2';

    for (let i = 0; i < 2; i++) {
      nextParsed = makeEmail({
        from: { value: [{ address: `user${i}@example.com`, name: 'U' }] },
        subject: `Ärende ${i}`,
        messageId: `<h-${i}@x>`,
      });
      expect(await processEmail(Buffer.from('raw'), config)).toBe('processed');
    }
    nextParsed = makeEmail({
      from: { value: [{ address: 'user9@example.com', name: 'U' }] },
      subject: 'Ett till',
      messageId: '<h-9@x>',
    });
    expect(await processEmail(Buffer.from('raw'), config)).toBe('rejected');
    expect(countTickets()).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith('Hourly email-ticket limit reached, rejecting', expect.objectContaining({ limit: 2 }));
  });

  it('räknar inte ärenden äldre än en timme', async () => {
    insertUser(memDb);
    process.env.EMAIL_INBOUND_MAX_NEW_PER_HOUR = '1';
    memDb.prepare(
      "INSERT INTO ticket_history (id, ticket_id, field_name, new_value, changed_at) VALUES ('old', 'x', 'created', 'email', datetime('now', '-2 hours'))"
    ).run();
    nextParsed = makeEmail({ messageId: '<h-old@x>' });

    expect(await processEmail(Buffer.from('raw'), config)).toBe('processed');
  });
});

describe('processEmail — dubblettskydd för svar', () => {
  it('lägger inte till samma svar två gånger (Message-ID sparas på kommentaren)', async () => {
    insertUser(memDb);
    insertContact(memDb, { id: 'c1', email: 'alice@example.com' });
    insertTicket(memDb, { id: 't1', title: 'Original', requester_id: 'c1', email_message_id: '<root@x>' });
    nextParsed = makeEmail({ subject: 'Re: Original', messageId: '<reply-dup@x>', inReplyTo: '<root@x>' });

    await processEmail(Buffer.from('raw'), config);
    await processEmail(Buffer.from('raw'), config);

    expect(countComments()).toBe(1);
  });
});

describe('processEmail — dygnstak per avsändare', () => {
  afterEach(() => {
    delete process.env.EMAIL_INBOUND_MAX_PER_SENDER_PER_DAY;
  });

  it("avvisar ('rejected') nya ärenden när avsändaren nått taket, men bara för den avsändaren", async () => {
    insertUser(memDb);
    process.env.EMAIL_INBOUND_MAX_PER_SENDER_PER_DAY = '2';

    for (let i = 0; i < 2; i++) {
      nextParsed = makeEmail({ subject: `Ärende ${i}`, messageId: `<cap-${i}@x>` });
      expect(await processEmail(Buffer.from('raw'), config)).toBe('processed');
    }
    nextParsed = makeEmail({ subject: 'Ärende 3', messageId: '<cap-3@x>' });
    expect(await processEmail(Buffer.from('raw'), config)).toBe('rejected');
    expect(countTickets()).toBe(2);

    nextParsed = makeEmail({
      from: { value: [{ address: 'bob@example.com', name: 'Bob' }] },
      subject: 'Bobs ärende',
      messageId: '<cap-bob@x>',
    });
    expect(await processEmail(Buffer.from('raw'), config)).toBe('processed');
    expect(countTickets()).toBe(3);
  });
});

describe('processEmail — ny-ärende-vägen är atomär och sanerad', () => {
  it('lämnar varken kontakt eller ärende kvar om historikraden misslyckas', async () => {
    insertUser(memDb);
    memDb.exec('DROP TABLE ticket_history');
    nextParsed = makeEmail();

    await expect(processEmail(Buffer.from('raw'), config)).rejects.toThrow();

    expect(countTickets()).toBe(0);
    expect(countContacts()).toBe(0);
  });

  it('saneras: taggar i ämne och brödtext tas bort vid ingestion', async () => {
    insertUser(memDb);
    nextParsed = makeEmail({
      subject: 'Hej <img src=x onerror=alert(1)>',
      text: 'Text <script>alert(1)</script>klar',
    });

    await processEmail(Buffer.from('raw'), config);

    const t = memDb.prepare('SELECT title, description FROM tickets').get() as { title: string; description: string };
    expect(t.title).not.toContain('<');
    expect(t.description).not.toContain('<script');
    expect(t.description).toContain('klar');
  });
});

describe('findTicketByShortId — använder primärnyckelindexet', () => {
  it('slår upp via index, inte full tabellskanning', () => {
    const plan = memDb
      .prepare('EXPLAIN QUERY PLAN SELECT id FROM tickets WHERE id >= ? AND id < ? LIMIT 1')
      .all('abc12345', 'abc12345\u{10FFFF}') as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/SEARCH tickets USING (COVERING )?INDEX/);
  });
});

describe('processEmail — bilagor', () => {
  let uploadDir: string;
  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), 'itticket-attach-'));
    process.env.UPLOAD_DIR = uploadDir;
  });
  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  });

  const attachment = (filename: string, extra: Record<string, unknown> = {}) => ({
    filename,
    contentType: 'text/plain',
    content: Buffer.from('x'),
    size: 1,
    ...extra,
  });
  const countAttachments = () =>
    (memDb.prepare('SELECT COUNT(*) AS n FROM ticket_attachments').get() as { n: number }).n;

  it('en trasig bilaga stoppar inte de övriga', async () => {
    insertUser(memDb);
    nextParsed = makeEmail({
      // size som objekt får SQLite-bindningen att kasta för just den bilagan
      attachments: [attachment('trasig.txt', { size: {} }), attachment('hel.txt')],
    });

    await processEmail(Buffer.from('raw'), config);

    const names = memDb.prepare('SELECT file_name FROM ticket_attachments').all() as { file_name: string }[];
    expect(names.map((n) => n.file_name)).toEqual(['hel.txt']);
    expect(countTickets()).toBe(1);
  });

  it('respekterar taket på 50 bilagor per ärende', async () => {
    insertUser(memDb);
    insertTicket(memDb, { id: 't1', title: 'Original', email_message_id: '<root@x>' });
    const insert = memDb.prepare(
      "INSERT INTO ticket_attachments (id, ticket_id, file_name, file_path) VALUES (?, 't1', 'a.txt', 'a')"
    );
    for (let i = 0; i < 49; i++) insert.run(`a${i}`);
    nextParsed = makeEmail({
      subject: 'Re: Original',
      inReplyTo: '<root@x>',
      attachments: [attachment('ett.txt'), attachment('tva.txt')],
    });

    await processEmail(Buffer.from('raw'), config);

    expect(countAttachments()).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// poll() — flytt per meddelande, storlek före hämtning, avvisade till Errors
// ─────────────────────────────────────────────────────────────────────────────

describe('poll — per-meddelande-flytt och storlekskontroll', () => {
  it('flyttar varje meddelande direkt efter lyckad behandling (ett anrop per uid)', async () => {
    const fakeClient = new FakeImapClient({ 1: Buffer.from('a'), 2: Buffer.from('b') });
    nextParsed = makeEmail({ messageId: '<pm-1@x>' });

    await poll(pollConfig, () => fakeClient as any);

    expect(fakeClient.moveCalls).toEqual([
      { uids: [1], mailbox: 'Processed' },
      { uids: [2], mailbox: 'Processed' },
    ]);
  });

  it('ett fel på ett meddelande hindrar inte att tidigare lyckade redan flyttats', async () => {
    const fakeClient = new FakeImapClient({ 1: Buffer.from('a'), 2: Buffer.from('b') });
    nextParsed = makeEmail({ messageId: '<pm-2@x>' });
    const parser = (await import('mailparser')).simpleParser as unknown as ReturnType<typeof vi.fn>;
    parser.mockImplementationOnce(async () => nextParsed).mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    await poll(pollConfig, () => fakeClient as any);

    expect(fakeClient.moveCalls).toEqual([{ uids: [1], mailbox: 'Processed' }]);
    expect(fakeClient.inboxUids).toEqual([2]);
  });

  it('för stora mail flyttas till Errors utan att källan hämtas', async () => {
    const fakeClient = new FakeImapClient({ 7: Buffer.from('a'), 8: Buffer.from('b') });
    fakeClient.sizes.set(7, 26 * 1024 * 1024);
    nextParsed = makeEmail({ messageId: '<pm-3@x>' });

    await poll(pollConfig, () => fakeClient as any);

    expect(fakeClient.fetchOneCalls).toEqual([8]);
    expect(fakeClient.moveCalls).toEqual([
      { uids: [7], mailbox: 'Errors' },
      { uids: [8], mailbox: 'Processed' },
    ]);
  });

  it('mail som avvisas av dygnstaket flyttas till Errors', async () => {
    const fakeClient = new FakeImapClient({ 9: Buffer.from('a') });
    process.env.EMAIL_INBOUND_MAX_PER_SENDER_PER_DAY = '1';
    try {
      nextParsed = makeEmail({ subject: 'Första', messageId: '<pm-4@x>' });
      await processEmail(Buffer.from('raw'), config);
      nextParsed = makeEmail({ subject: 'Andra', messageId: '<pm-5@x>' });

      await poll(pollConfig, () => fakeClient as any);

      expect(fakeClient.moveCalls).toEqual([{ uids: [9], mailbox: 'Errors' }]);
    } finally {
      delete process.env.EMAIL_INBOUND_MAX_PER_SENDER_PER_DAY;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startEmailPolling — tillfälligt uppstartsfel får inte döda pollern
// ─────────────────────────────────────────────────────────────────────────────

describe('startEmailPolling — OAuth-fel vid uppstart', () => {
  const envKeys = ['IMAP_HOST', 'IMAP_USER', 'IMAP_CLIENT_ID', 'IMAP_CLIENT_SECRET', 'IMAP_TENANT_ID'] as const;

  beforeEach(() => {
    vi.useFakeTimers();
    acquireTokenMock.mockReset();
    vi.mocked(logger.error).mockClear();
    Object.assign(process.env, {
      IMAP_HOST: 'imap.example.com',
      IMAP_USER: 'inbox@example.com',
      IMAP_CLIENT_ID: 'id',
      IMAP_CLIENT_SECRET: 'secret',
      IMAP_TENANT_ID: 'tenant',
    });
  });

  afterEach(() => {
    stopEmailPolling();
    vi.useRealTimers();
    for (const key of envKeys) delete process.env[key];
  });

  it('loggar felet, schemalägger ändå nästa poll och slår upp konfigurationen igen', async () => {
    acquireTokenMock.mockRejectedValue(new Error('token endpoint nere'));

    await expect(startEmailPolling()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve IMAP config at startup'),
      expect.any(Object)
    );
    const callsAtStart = acquireTokenMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(60_000);

    expect(acquireTokenMock.mock.calls.length).toBeGreaterThan(callsAtStart);
  });

  it('är avstängd (utan fel) när IMAP inte alls är konfigurerat', async () => {
    delete process.env.IMAP_HOST;

    await startEmailPolling();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(acquireTokenMock).not.toHaveBeenCalled();
  });
});

describe('IMAP_POLL_INTERVAL', () => {
  afterEach(() => {
    delete process.env.IMAP_POLL_INTERVAL;
  });

  it.each([
    ['abc', 60],
    ['', 60],
    ['0', 60],
    ['5', 60],
    ['30', 30],
  ])('%j ger %i sekunder', (value, expected) => {
    process.env.IMAP_POLL_INTERVAL = value;
    expect(getEmailInboundStatus().polling_interval).toBe(expected);
  });
});
