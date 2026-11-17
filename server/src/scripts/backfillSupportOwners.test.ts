import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { backfillSupportOwners, parseBackfillArgs, parseSupportOwnerPlan, type SupportOwnerPlan } from './backfillSupportOwners.js';

const ISSUER = 'https://navet.example.test';
const UPDATED = '2026-11-16T12:00:00.000Z';
const fixtures: { db: Database.Database; root: string }[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    f.db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'itticket-reviewed-owners-'));
  const dbPath = join(root, 'source.sqlite');
  const backupPath = join(root, 'before-grant.sqlite');
  const db = new Database(dbPath);
  fixtures.push({ db, root });
  db.pragma('journal_mode=WAL');
  db.pragma('wal_autocheckpoint=0');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT);
    CREATE TABLE contacts (id TEXT PRIMARY KEY, name TEXT, email TEXT);
    CREATE TABLE tickets (id TEXT PRIMARY KEY, requester_id TEXT REFERENCES contacts(id), updated_at TEXT);
    CREATE TABLE support_ticket_owners (ticket_id TEXT PRIMARY KEY REFERENCES tickets(id), issuer TEXT, subject TEXT, read_revision TEXT);
    CREATE TABLE ticket_attachments (id TEXT PRIMARY KEY, ticket_id TEXT REFERENCES tickets(id));
    CREATE TABLE support_ticket_files (attachment_id TEXT PRIMARY KEY REFERENCES ticket_attachments(id));
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), action TEXT, entity_type TEXT,
      entity_id TEXT, details TEXT, ip_address TEXT, api_key_id TEXT, created_at TEXT);
    INSERT INTO users VALUES ('admin', 'admin'), ('staff', 'user');
    INSERT INTO contacts VALUES ('contact-a', 'Alice Andersson', 'alice@example.test'), ('contact-b', 'Bob Berg', 'bob@example.test');
  `);
  const ticket = db.prepare('INSERT INTO tickets VALUES (?,?,?)');
  ticket.run('ticket-a', 'contact-a', UPDATED);
  ticket.run('ticket-b', 'contact-b', UPDATED);
  // A third case for the same contact must never be selected by identity matching.
  ticket.run('not-in-plan', 'contact-a', UPDATED);
  const plan: SupportOwnerPlan = {
    version: 1, issuer: ISSUER, actorUserId: 'admin', reason: 'Reviewed individual requester identity mappings approved by the operator',
    entries: [
      { ticketId: 'ticket-a', requesterId: 'contact-a', subject: 'navet-a', requesterName: 'Alice Andersson', requesterEmail: 'alice@example.test', ticketUpdatedAt: UPDATED },
      { ticketId: 'ticket-b', requesterId: 'contact-b', subject: 'navet-b', requesterName: 'Bob Berg', requesterEmail: 'bob@example.test', ticketUpdatedAt: UPDATED },
    ],
  };
  const options = { dbPath, plan, configuredIssuer: ISSUER };
  const counts = () => ({
    owners: db.prepare('SELECT COUNT(*) FROM support_ticket_owners').pluck().get(),
    audits: db.prepare('SELECT COUNT(*) FROM audit_log').pluck().get(),
    files: db.prepare('SELECT COUNT(*) FROM support_ticket_files').pluck().get(),
  });
  return { root, db, dbPath, backupPath, plan, options, counts };
}

describe('manual reviewed historical support ownership', () => {
  it('defaults to a read-only dry run without writes, backups or implicit ticket matching', async () => {
    const f = fixture();
    const version = f.db.pragma('data_version', { simple: true });
    const before = readdirSync(f.root);
    const backup = vi.spyOn(Database.prototype, 'backup');
    await expect(backfillSupportOwners(f.options)).resolves.toMatchObject({ mode: 'dry-run', planned: 2, inserted: 0, planHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(f.counts()).toEqual({ owners: 0, audits: 0, files: 0 });
    expect(f.db.pragma('data_version', { simple: true })).toBe(version);
    expect(readdirSync(f.root)).toEqual(before);
    expect(backup).not.toHaveBeenCalled();
  });

  it('runs the actual CLI from a private review plan and emits only a summary', () => {
    const f = fixture();
    const planPath = join(f.root, 'review.json');
    writeFileSync(planPath, JSON.stringify(f.plan), { mode: 0o600 });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./backfillSupportOwners.ts', import.meta.url)),
      '--db', f.dbPath, '--plan', planPath], {
      env: { ...process.env, NAVET_SUPPORT_ISSUER: ISSUER }, encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'dry-run', planned: 2, inserted: 0 });
    expect(result.stdout).not.toContain('alice');
    expect(result.stdout).not.toContain('ticket-a');
    expect(f.counts()).toEqual({ owners: 0, audits: 0, files: 0 });
  });

  it('takes a private WAL-safe backup, then grants only the exact plan and audits every owner atomically', async () => {
    const f = fixture();
    const result = await backfillSupportOwners({ ...f.options, apply: true, backupPath: f.backupPath });
    expect(result).toMatchObject({ mode: 'applied', planned: 2, inserted: 2, unreadBaseline: 'unread' });
    expect(f.counts()).toEqual({ owners: 2, audits: 2, files: 0 });
    expect(f.db.prepare('SELECT * FROM support_ticket_owners ORDER BY ticket_id').all()).toEqual([
      { ticket_id: 'ticket-a', issuer: ISSUER, subject: 'navet-a', read_revision: null },
      { ticket_id: 'ticket-b', issuer: ISSUER, subject: 'navet-b', read_revision: null },
    ]);
    expect(f.db.prepare('SELECT 1 FROM support_ticket_owners WHERE ticket_id=?').get('not-in-plan')).toBeUndefined();
    const audits = f.db.prepare('SELECT * FROM audit_log ORDER BY entity_id').all() as
      { user_id: string; action: string; entity_type: string; entity_id: string; details: string; ip_address: null; api_key_id: null }[];
    for (const [index, audit] of audits.entries()) {
      expect(audit).toMatchObject({ user_id: 'admin', action: 'support_history_link', entity_type: 'support_ticket_owner',
        entity_id: f.plan.entries[index].ticketId, ip_address: null, api_key_id: null });
      expect(JSON.parse(audit.details)).toMatchObject({ batchId: result.mode === 'applied' ? result.batchId : '', planHash: result.planHash,
        issuer: ISSUER, subject: f.plan.entries[index].subject, requesterId: f.plan.entries[index].requesterId, reason: f.plan.reason, previousOwner: null });
    }
    expect(statSync(f.backupPath).mode & 0o777).toBe(0o600);
    const backup = new Database(f.backupPath, { readonly: true });
    try {
      expect(backup.prepare('SELECT COUNT(*) FROM tickets').pluck().get()).toBe(3);
      expect(backup.prepare('SELECT COUNT(*) FROM support_ticket_owners').pluck().get()).toBe(0);
      expect(backup.prepare('SELECT COUNT(*) FROM audit_log').pluck().get()).toBe(0);
    } finally { backup.close(); }
  });

  it.each(['foreign', 'same'])('refuses the whole batch for an existing %s owner, with no replacement or backup', async (kind) => {
    const f = fixture();
    f.db.prepare('INSERT INTO support_ticket_owners VALUES (?,?,?,NULL)').run('ticket-b', ISSUER, kind === 'same' ? 'navet-b' : 'different-person');
    await expect(backfillSupportOwners({ ...f.options, apply: true, backupPath: f.backupPath })).rejects.toThrow(/already has an owner/);
    expect(f.counts()).toEqual({ owners: 1, audits: 0, files: 0 });
    expect(f.db.prepare('SELECT 1 FROM support_ticket_owners WHERE ticket_id=?').get('ticket-a')).toBeUndefined();
    expect(existsSync(f.backupPath)).toBe(false);
  });

  it.each([
    "UPDATE contacts SET name='Changed Person' WHERE id='contact-b'",
    "UPDATE contacts SET email='other@example.test' WHERE id='contact-b'",
    "UPDATE tickets SET requester_id='contact-a' WHERE id='ticket-b'",
    "UPDATE tickets SET updated_at='2026-11-17T12:00:00.000Z' WHERE id='ticket-b'",
    "DELETE FROM tickets WHERE id='ticket-b'",
  ])('rejects stale contact/ticket evidence: %s', async sql => {
    const f = fixture();
    f.db.exec(sql);
    await expect(backfillSupportOwners({ ...f.options, apply: true, backupPath: f.backupPath })).rejects.toThrow(/changed or missing/);
    expect(f.counts()).toEqual({ owners: 0, audits: 0, files: 0 });
    expect(existsSync(f.backupPath)).toBe(false);
  });

  it('normalizes only email case/outer whitespace; reviewed requester names remain exact', async () => {
    const f = fixture();
    f.db.prepare("UPDATE contacts SET email=' ALICE@EXAMPLE.TEST ' WHERE id='contact-a'").run();
    await expect(backfillSupportOwners(f.options)).resolves.toMatchObject({ mode: 'dry-run', planned: 2 });
  });

  it.each(['staff', 'missing', '00000000-0000-4000-8000-000000000001'])('refuses non-admin/missing/system actor %s', async actor => {
    const f = fixture();
    f.db.prepare("INSERT OR IGNORE INTO users VALUES ('00000000-0000-4000-8000-000000000001','admin')").run();
    f.plan.actorUserId = actor;
    await expect(backfillSupportOwners({ ...f.options, apply: true, backupPath: f.backupPath })).rejects.toThrow(/staff admin/);
    expect(f.counts()).toEqual({ owners: 0, audits: 0, files: 0 });
  });

  it('refuses legacy tickets with any existing portal file allowlist without changing those permissions', async () => {
    const f = fixture();
    f.db.exec("INSERT INTO ticket_attachments VALUES ('file-b','ticket-b'); INSERT INTO support_ticket_files VALUES ('file-b')");
    await expect(backfillSupportOwners({ ...f.options, apply: true, backupPath: f.backupPath })).rejects.toThrow(/portal file allowlist/);
    expect(f.counts()).toEqual({ owners: 0, audits: 0, files: 1 });
    expect(existsSync(f.backupPath)).toBe(false);
  });

  it('rolls back every owner and audit row when the second audit insert fails', async () => {
    const f = fixture();
    f.db.exec("CREATE TRIGGER refuse_second_audit BEFORE INSERT ON audit_log WHEN NEW.entity_id='ticket-b' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    await expect(backfillSupportOwners({ ...f.options, apply: true, backupPath: f.backupPath })).rejects.toThrow(/audit unavailable/);
    expect(f.counts()).toEqual({ owners: 0, audits: 0, files: 0 });
    expect(existsSync(f.backupPath)).toBe(true);
  });

  it('revalidates after backup so concurrent changes cannot use the stale pre-backup review', async () => {
    const f = fixture();
    const backup = Database.prototype.backup;
    vi.spyOn(Database.prototype, 'backup').mockImplementationOnce(async function (this: Database.Database, destination, options) {
      const result = await backup.call(this, destination, options);
      f.db.prepare("UPDATE tickets SET requester_id='contact-a' WHERE id='ticket-b'").run();
      return result;
    });
    await expect(backfillSupportOwners({ ...f.options, apply: true, backupPath: f.backupPath })).rejects.toThrow(/Ticket changed/);
    expect(f.counts()).toEqual({ owners: 0, audits: 0, files: 0 });
  });

  it('does not grant anything if the WAL backup fails and removes the newly reserved incomplete file', async () => {
    const f = fixture();
    vi.spyOn(Database.prototype, 'backup').mockRejectedValueOnce(new Error('backup unavailable'));
    await expect(backfillSupportOwners({ ...f.options, apply: true, backupPath: f.backupPath })).rejects.toThrow(/backup unavailable/);
    expect(f.counts()).toEqual({ owners: 0, audits: 0, files: 0 });
    expect(existsSync(f.backupPath)).toBe(false);
  });

  it('never overwrites an existing backup and refuses a repeated apply without extra grants', async () => {
    const f = fixture();
    await backfillSupportOwners({ ...f.options, apply: true, backupPath: f.backupPath });
    await expect(backfillSupportOwners({ ...f.options, apply: true, backupPath: join(f.root, 'second.sqlite') })).rejects.toThrow(/already has an owner/);
    expect(f.counts()).toEqual({ owners: 2, audits: 2, files: 0 });
    expect(existsSync(join(f.root, 'second.sqlite'))).toBe(false);
    f.db.prepare('DELETE FROM support_ticket_owners').run();
    await expect(backfillSupportOwners({ ...f.options, apply: true, backupPath: f.backupPath })).rejects.toThrow(/EEXIST/);
    expect(f.counts()).toEqual({ owners: 0, audits: 2, files: 0 });
  });

  it.each([undefined, 'https://other.example.test'])('refuses issuer mismatch %s before opening/writing any database', async configuredIssuer => {
    const f = fixture();
    await expect(backfillSupportOwners({ ...f.options, configuredIssuer, apply: true, backupPath: f.backupPath })).rejects.toThrow(/configured NAVET_SUPPORT_ISSUER/);
    expect(f.counts()).toEqual({ owners: 0, audits: 0, files: 0 });
  });
});

describe('strict reviewed plan and CLI arguments', () => {
  it.each([
    (p: SupportOwnerPlan) => ({ ...p, version: 2 }),
    (p: SupportOwnerPlan) => ({ ...p, entries: [] }),
    (p: SupportOwnerPlan) => ({ ...p, unexpected: 'refuse extra fields' }),
    (p: SupportOwnerPlan) => ({ ...p, entries: [p.entries[0], p.entries[0]] }),
    (p: SupportOwnerPlan) => ({ ...p, issuer: 'https://navet.example.test/path' }),
    (p: SupportOwnerPlan) => ({ ...p, entries: [{ ...p.entries[0], subject: '' }] }),
    (p: SupportOwnerPlan) => ({ ...p, entries: [{ ...p.entries[0], requesterEmail: 'invalid' }] }),
    (p: SupportOwnerPlan) => ({ ...p, entries: [{ ...p.entries[0], ticketUpdatedAt: 'invalid' }] }),
    (p: SupportOwnerPlan) => ({ ...p, entries: [p.entries[0], { ...p.entries[0], ticketId: 'other-ticket', subject: 'other-person' }] }),
  ])('rejects malformed, duplicated or conflicting review plans', mutation => {
    const f = fixture();
    expect(() => parseSupportOwnerPlan(mutation(f.plan))).toThrow();
  });

  it('requires explicit paths and paired apply/backup, and refuses unknown/duplicate flags', () => {
    expect(parseBackfillArgs(['--db', '/tmp/source.sqlite', '--plan', '/tmp/review.json'])).toMatchObject({ apply: false, dbPath: '/tmp/source.sqlite' });
    expect(parseBackfillArgs(['--db', '/tmp/source.sqlite', '--plan', '/tmp/review.json', '--apply', '--backup', '/tmp/new.sqlite'])).toMatchObject({ apply: true, backupPath: '/tmp/new.sqlite' });
    for (const args of [[], ['--db', 'only'], ['--db', 'x', '--plan', 'y', '--apply'],
      ['--db', 'x', '--plan', 'y', '--backup', 'z'], ['--db', 'x', '--db', 'y', '--plan', 'z'],
      ['--db', 'x', '--plan', 'y', '--force'], ['--db', 'x', '--plan', 'y', '--apply', '--apply', '--backup', 'z']]) {
      expect(() => parseBackfillArgs(args)).toThrow();
    }
  });
});
