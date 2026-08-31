import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Skarpt parsningstest — medvetet UTAN mock av `mailparser` och `html-to-text`.
//
// `emailInbound.test.ts` mockar båda paketen (`simpleParser` matas via en
// variabel, `convert` är identitetsfunktionen `html => html`). Det är rätt för
// den filens syfte — att testa mail-till-ärende-LOGIKEN — men det betyder att
// ingenting i sviten kör de riktiga paketen, trots att `emailInbound.ts:2-3` är
// deras enda produktionsanvändare. Två dependency-bumpar (2026-07-20 och
// 2026-08-28) har därför godkänts av en grön svit som inte kunde ha upptäckt en
// beteendeändring.
//
// Den här filen täcker luckan: riktiga MIME-bytes in, riktig avkodning och
// HTML→text-konvertering, assertions på de beteenden produktionskoden faktiskt
// förlitar sig på. Allt annat mockas som i grannfilen.
// ─────────────────────────────────────────────────────────────────────────────

let memDb: InstanceType<typeof Database>;
let uploadDir: string;

vi.mock('../db/connection.js', () => {
  const proxy = {
    prepare: (...args: Parameters<InstanceType<typeof Database>['prepare']>) =>
      memDb.prepare(...args),
    pragma: vi.fn(),
    exec: vi.fn(),
  };
  return { db: proxy };
});

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('imapflow', () => ({ ImapFlow: class {} }));
vi.mock('@azure/msal-node', () => ({ ConfidentialClientApplication: class {} }));

vi.mock('./webhookDispatcher.js', () => ({
  dispatchWebhook: vi.fn(async () => undefined),
}));

vi.mock('./email.js', () => ({
  sendTicketReceivedConfirmation: vi.fn(async () => undefined),
}));

// attachments.ts drar in multer/express/auth transitivt — måste stubbas.
// `hasMagicByteMatch` returnerar true: magic-byte-kontrollen är en egen
// kodväg som testas på annat håll, och den är inte det den här filen bevisar.
vi.mock('../routes/attachments.js', () => ({
  ALLOWED_MIME_TYPES: ['text/plain', 'application/pdf'],
  ALLOWED_EXTENSIONS: ['txt', 'pdf'],
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  hasMagicByteMatch: () => true,
}));

import { __test__ } from './emailInbound.js';

const { processEmail } = __test__;

const config: any = { autoCreateContact: true };

function createSchema(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT);

    CREATE TABLE contacts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      company_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE tickets (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      status TEXT DEFAULT 'open', priority TEXT DEFAULT 'medium', requester_id TEXT,
      company_id TEXT, email_message_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE ticket_comments (
      id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, user_id TEXT NOT NULL,
      content TEXT NOT NULL, is_internal INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      email_from_name TEXT DEFAULT NULL, email_from_address TEXT DEFAULT NULL
    );

    CREATE TABLE ticket_history (
      id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, user_id TEXT,
      field_name TEXT NOT NULL, old_value TEXT, new_value TEXT,
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE ticket_attachments (
      id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, file_name TEXT NOT NULL,
      file_path TEXT NOT NULL, file_size INTEGER, file_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE ticket_shares (
      id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, share_token TEXT UNIQUE NOT NULL,
      created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT
    );

    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT, details TEXT, ip_address TEXT, api_key_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** Bygger ett RFC 822-meddelande av rader; \r\n är radslut på nätet. */
const mime = (lines: string[]) => Buffer.from(lines.join('\r\n'), 'utf8');

/**
 * Outlook-liknande HTML-svar. Varje del finns för att bevisa ett specifikt
 * beteende produktionskoden lutar sig mot — se assertions längre ner.
 */
function htmlEmail(opts: { subject: string; messageId: string; inReplyTo?: string }) {
  return mime([
    'From: "Anna Lindqvist" <anna.lindqvist@kund.example>',
    'To: "Support" <support@prefabmastarna.se>',
    `Subject: ${opts.subject}`,
    `Message-ID: ${opts.messageId}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="INNER"',
    '',
    '--INNER',
    'Content-Type: text/plain; charset="ISO-8859-1"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Ren textversion som INTE ska anv=E4ndas n=E4r HTML finns.',
    '',
    '--INNER',
    'Content-Type: text/html; charset="ISO-8859-1"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<html><body>',
    '<p>Skrivaren p=E5 v=E5ning 2 st=E5r <b>fortfarande</b>.</p>',
    '<p>Se loggen: <a href=3D"https://intranat.example/logg">https://intranat.exa=',
    'mple/logg</a></p>',
    '<p>Och rutinen: <a href=3D"https://docs.example/rutin-42">skrivarrutinen</a>=',
    '</p>',
    '<p>Skyddad l=E4nk: <a href=3D"https://eur01.safelinks.protection.outlook.com=',
    '/?url=3Dhttps%3A%2F%2Fleverantor.example%2Fsupport&amp;data=3D05%7C01">leve=',
    'rant=F6rens sida</a></p>',
    '<img src=3D"data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=3D=3D" alt=3D"sig=',
    'natur">',
    '<blockquote>',
    '<p>Vi har bytt tonern, testa g=E4rna igen.</p>',
    '</blockquote>',
    '</body></html>',
    '',
    '--INNER--',
    '',
  ]);
}

const getTicket = () =>
  memDb.prepare('SELECT * FROM tickets LIMIT 1').get() as any;

beforeEach(() => {
  memDb = new Database(':memory:');
  createSchema(memDb);
  // addCommentToTicket kräver en användare att hänga FK:n på — avsändaren bärs
  // av email_from_*-kolumnerna, inte av user_id.
  memDb
    .prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)')
    .run('system-user', 'agent@example.com', 'Agent');
  uploadDir = mkdtempSync(join(tmpdir(), 'itticket-mailtest-'));
  process.env.UPLOAD_DIR = uploadDir;
});

afterEach(() => {
  memDb.close();
  rmSync(uploadDir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
  vi.clearAllMocks();
});

describe('emailInbound — riktig mailparser + html-to-text', () => {
  it('avkodar RFC 2047-ämne och ISO-8859-1-kropp till korrekta svenska tecken', async () => {
    await processEmail(
      htmlEmail({
        subject: '=?ISO-8859-1?Q?Skrivaren_p=E5_v=E5ning_2_st=E5r?=',
        messageId: '<nytt-1@kund.example>',
      }),
      config
    );

    const ticket = getTicket();
    // Ämnet är RFC 2047-kodat på nätet; utan riktig mailparser blir det obegripligt.
    expect(ticket.title).toBe('Skrivaren på våning 2 står');
    // Kroppen är quoted-printable i ISO-8859-1 — =E5 måste bli "å", inte "Ã¥".
    expect(ticket.description).toContain('Skrivaren på våning 2 står fortfarande.');

    const contact = memDb.prepare('SELECT * FROM contacts LIMIT 1').get() as any;
    expect(contact.email).toBe('anna.lindqvist@kund.example');
    expect(contact.name).toBe('Anna Lindqvist');
  });

  it('föredrar HTML-delen framför text-alternativet i multipart/alternative', async () => {
    await processEmail(
      htmlEmail({ subject: 'Test', messageId: '<nytt-2@kund.example>' }),
      config
    );

    const { description } = getTicket();
    expect(description).not.toContain('Ren textversion som INTE ska användas');
    expect(description).toContain('Skrivaren på våning 2 står');
  });

  it('tillämpar produktionens html-to-text-optioner: img skippas, dubblerad länk visas en gång', async () => {
    await processEmail(
      htmlEmail({ subject: 'Test', messageId: '<nytt-3@kund.example>' }),
      config
    );

    const { description } = getTicket();

    // selector { img: 'skip' } — signaturbilder ska inte bli [image]-brus.
    expect(description).not.toMatch(/\[image\]|signatur/i);
    // hideLinkHrefIfSameAsText — URL:en får inte dubbleras som "url [url]".
    expect(description).toContain('Se loggen: https://intranat.example/logg');
    expect(description).not.toContain('logg [https://intranat.example/logg]');
    // Länk med annan text ska däremot behålla sitt mål.
    expect(description).toContain('skrivarrutinen [https://docs.example/rutin-42]');
  });

  it('packar upp Outlook-safelinks till den riktiga adressen', async () => {
    await processEmail(
      htmlEmail({ subject: 'Test', messageId: '<nytt-4@kund.example>' }),
      config
    );

    const { description } = getTicket();
    expect(description).not.toContain('safelinks.protection.outlook.com');
    // Hakparentesen html-to-text satte dit hör till formatet "text [href]" och
    // ska överleva uppackningen — regexen får inte äta upp den.
    expect(description).toContain('leverantörens sida [https://leverantor.example/support]');
  });

  it('packar upp en naken safelink i ett rent textmejl (ingen hakparentes)', async () => {
    // Ren text har inget "text [href]"-format — undantaget för `]` i regexen får
    // inte göra uppackningen beroende av hakparenteser.
    await processEmail(
      mime([
        'From: "Bo Ek" <bo.ek@kund.example>',
        'To: <support@prefabmastarna.se>',
        'Subject: Naken safelink',
        'Message-ID: <plain-2@kund.example>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Se https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fleverantor.example%2Fsupport&data=05 tack',
        '',
      ]),
      config
    );

    const { description } = getTicket();
    expect(description).not.toContain('safelinks.protection.outlook.com');
    expect(description).toContain('https://leverantor.example/support');
  });

  it('renderar <blockquote> som >-prefix, vilket är vad stripQuotedReply bygger på', async () => {
    // Kopplingen html-to-text → stripQuotedReply är osynlig när convert mockas
    // som identitet: citatstrippningen matchar på `^\s*>`, ett format som bara
    // det riktiga paketet producerar.
    memDb
      .prepare(
        `INSERT INTO tickets (id, title, description, status, email_message_id)
         VALUES ('t-1', 'Skrivaren på våning 2 står', '', 'open', '<urspr-1@prefabmastarna.se>')`
      )
      .run();

    await processEmail(
      htmlEmail({
        subject: 'Sv: Skrivaren',
        messageId: '<svar-1@kund.example>',
        inReplyTo: '<urspr-1@prefabmastarna.se>',
      }),
      config
    );

    // Svaret ska bli en kommentar på det befintliga ärendet, inte ett nytt ärende.
    expect(
      (memDb.prepare('SELECT COUNT(*) AS n FROM tickets').get() as any).n
    ).toBe(1);

    const comment = memDb.prepare('SELECT * FROM ticket_comments LIMIT 1').get() as any;
    expect(comment.ticket_id).toBe('t-1');
    expect(comment.email_from_address).toBe('anna.lindqvist@kund.example');
    // Kundens egen text finns kvar ...
    expect(comment.content).toContain('Skrivaren på våning 2 står fortfarande.');
    // ... och det citerade blocket är bortklippt.
    expect(comment.content).not.toContain('Vi har bytt tonern');
  });

  it('behåller citatet när mejlet skapar ett NYTT ärende', async () => {
    // Motsatsen till föregående test: utan träff på befintligt ärende är citatet
    // själva innehållet och måste bevaras.
    await processEmail(
      htmlEmail({ subject: 'Vidarebefordran', messageId: '<nytt-5@kund.example>' }),
      config
    );

    expect(getTicket().description).toContain('> Vi har bytt tonern, testa gärna igen.');
  });

  it('använder text/plain-delen när mejlet saknar HTML', async () => {
    await processEmail(
      mime([
        'From: "Bo Ek" <bo.ek@kund.example>',
        'To: <support@prefabmastarna.se>',
        'Subject: Endast text',
        'Message-ID: <plain-1@kund.example>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="ISO-8859-1"',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'Skrivaren p=E5 v=E5ning 2 st=E5r fortfarande.',
        '',
      ]),
      config
    );

    expect(getTicket().description).toBe('Skrivaren på våning 2 står fortfarande.');
  });

  it('avkodar base64-bilagor till rätt innehåll på disk', async () => {
    await processEmail(
      mime([
        'From: "Bo Ek" <bo.ek@kund.example>',
        'To: <support@prefabmastarna.se>',
        'Subject: Med bilaga',
        'Message-ID: <bilaga-1@kund.example>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="OUTER"',
        '',
        '--OUTER',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Loggen bifogas.',
        '',
        '--OUTER',
        'Content-Type: text/plain; name="logg.txt"',
        'Content-Disposition: attachment; filename="logg.txt"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('printer status: jam at tray 2\n').toString('base64'),
        '',
        '--OUTER--',
        '',
      ]),
      config
    );

    const row = memDb.prepare('SELECT * FROM ticket_attachments LIMIT 1').get() as any;
    expect(row.file_name).toBe('logg.txt');

    const stored = join(uploadDir, row.file_path);
    expect(existsSync(stored)).toBe(true);
    expect(readFileSync(stored, 'utf8')).toBe('printer status: jam at tray 2\n');
  });

  it('trådar via In-Reply-To med messageId från riktig header-parsning', async () => {
    memDb
      .prepare(
        `INSERT INTO tickets (id, title, description, status, email_message_id)
         VALUES ('t-2', 'Ursprung', '', 'open', '<urspr-2@prefabmastarna.se>')`
      )
      .run();

    await processEmail(
      htmlEmail({
        subject: 'Sv: Ursprung',
        messageId: '<svar-2@kund.example>',
        inReplyTo: '<urspr-2@prefabmastarna.se>',
      }),
      config
    );

    expect(
      (memDb.prepare('SELECT COUNT(*) AS n FROM tickets').get() as any).n
    ).toBe(1);
    expect(
      (memDb.prepare('SELECT COUNT(*) AS n FROM ticket_comments').get() as any).n
    ).toBe(1);
  });
});
