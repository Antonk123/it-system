/**
 * Manual, reviewed historical requester grants. Never matches identities by email.
 * Dry run: NAVET_SUPPORT_ISSUER=... npx tsx src/scripts/backfillSupportOwners.ts --db DB --plan PLAN
 * Apply: add --apply --backup NEW_PRIVATE_SQLITE_PATH. No migrations or app imports.
 */
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReviewedOwnerEntry {
  ticketId: string;
  requesterId: string;
  subject: string;
  requesterName: string;
  requesterEmail: string;
  ticketUpdatedAt: string;
}

export interface SupportOwnerPlan {
  version: 1;
  issuer: string;
  actorUserId: string;
  reason: string;
  entries: ReviewedOwnerEntry[];
}

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
const normalizeEmail = (value: string) => value.trim().toLowerCase();

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error('Invalid review plan fields');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number, identifier = false): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max ||
    /\p{Cc}/u.test(value) || (identifier && /\s/.test(value))) {
    throw new Error(`Invalid review plan ${field}`);
  }
  return value;
}

export function parseSupportOwnerPlan(value: unknown): SupportOwnerPlan {
  const p = object(value, ['version', 'issuer', 'actorUserId', 'reason', 'entries']);
  if (p.version !== 1 || !Array.isArray(p.entries) || p.entries.length < 1 || p.entries.length > 10000) {
    throw new Error('Review plan requires version 1 and 1–10000 exact entries');
  }
  const issuer = text(p.issuer, 'issuer', 2048);
  const origin = new URL(issuer);
  if (origin.origin !== issuer || (origin.protocol !== 'https:' &&
    !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) {
    throw new Error('Review plan issuer must be an exact HTTPS origin (or local loopback)');
  }
  const ids = new Set<string>();
  const requesters = new Map<string, string>();
  const entries = p.entries.map(value => {
    const e = object(value, ['ticketId', 'requesterId', 'subject', 'requesterName', 'requesterEmail', 'ticketUpdatedAt']);
    const entry: ReviewedOwnerEntry = {
      ticketId: text(e.ticketId, 'ticketId', 128, true),
      requesterId: text(e.requesterId, 'requesterId', 128, true),
      subject: text(e.subject, 'subject', 128, true),
      requesterName: text(e.requesterName, 'requesterName', 255),
      requesterEmail: text(e.requesterEmail, 'requesterEmail', 255),
      ticketUpdatedAt: text(e.ticketUpdatedAt, 'ticketUpdatedAt', 64),
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.requesterEmail) || !Number.isFinite(Date.parse(entry.ticketUpdatedAt))) {
      throw new Error('Invalid reviewed contact email or ticket timestamp');
    }
    if (ids.has(entry.ticketId)) throw new Error('Duplicate ticket in review plan');
    ids.add(entry.ticketId);
    const requester = JSON.stringify([entry.subject, entry.requesterName, normalizeEmail(entry.requesterEmail)]);
    if (requesters.has(entry.requesterId) && requesters.get(entry.requesterId) !== requester) {
      throw new Error('Conflicting identities for one reviewed requester');
    }
    requesters.set(entry.requesterId, requester);
    return entry;
  });
  return { version: 1, issuer, actorUserId: text(p.actorUserId, 'actorUserId', 128, true),
    reason: text(p.reason, 'reason', 2000), entries };
}

function validateCurrentRows(db: DatabaseType, plan: SupportOwnerPlan): void {
  // IT-Ticket has no disabled/active flag: a current non-system admin is required.
  const actor = db.prepare('SELECT role FROM users WHERE id=?').get(plan.actorUserId) as { role: string } | undefined;
  if (!actor || actor.role !== 'admin' || plan.actorUserId === SYSTEM_USER_ID) throw new Error('Reviewed actor is not a current staff admin');
  const ticket = db.prepare('SELECT requester_id, updated_at FROM tickets WHERE id=?');
  const contact = db.prepare('SELECT name, email FROM contacts WHERE id=?');
  const owner = db.prepare('SELECT 1 FROM support_ticket_owners WHERE ticket_id=?');
  const files = db.prepare('SELECT 1 FROM ticket_attachments a JOIN support_ticket_files f ON f.attachment_id=a.id WHERE a.ticket_id=? LIMIT 1');
  for (const entry of plan.entries) {
    const t = ticket.get(entry.ticketId) as { requester_id: string | null; updated_at: string | null } | undefined;
    const c = contact.get(entry.requesterId) as { name: string; email: string } | undefined;
    if (!t || t.requester_id !== entry.requesterId || t.updated_at !== entry.ticketUpdatedAt) {
      throw new Error(`Ticket changed or missing: ${entry.ticketId}`);
    }
    if (!c || c.name !== entry.requesterName || normalizeEmail(c.email) !== normalizeEmail(entry.requesterEmail)) {
      throw new Error(`Reviewed requester changed or missing for ticket: ${entry.ticketId}`);
    }
    if (owner.get(entry.ticketId)) throw new Error(`Ticket already has an owner: ${entry.ticketId}`);
    if (files.get(entry.ticketId)) throw new Error(`Historical ticket has a portal file allowlist; review separately: ${entry.ticketId}`);
  }
}

async function privateSnapshot(db: DatabaseType, backupPath: string): Promise<void> {
  // Reserve exclusively with private permissions BEFORE SQLite writes any bytes.
  closeSync(openSync(backupPath, 'wx', 0o600));
  try {
    await db.backup(backupPath);
    chmodSync(backupPath, 0o600);
    const snapshot = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      const check = snapshot.pragma('integrity_check') as { integrity_check: string }[];
      if (check.length !== 1 || check[0].integrity_check !== 'ok') throw new Error('Pre-grant backup failed integrity_check');
    } finally { snapshot.close(); }
  } catch (error) {
    // Only this invocation's newly reserved, incomplete backup is removed.
    try { unlinkSync(backupPath); } catch { /* retain original error */ }
    throw error;
  }
}

export interface BackfillOptions {
  dbPath: string;
  plan: unknown;
  configuredIssuer: string | undefined;
  apply?: boolean;
  backupPath?: string;
}

export async function backfillSupportOwners(options: BackfillOptions) {
  const plan = parseSupportOwnerPlan(options.plan);
  if (!options.configuredIssuer || options.configuredIssuer !== plan.issuer) {
    throw new Error('Plan issuer does not equal configured NAVET_SUPPORT_ISSUER');
  }
  if (options.apply && !options.backupPath) throw new Error('--apply requires a new --backup path');
  if (!options.apply && options.backupPath) throw new Error('--backup is only accepted with --apply');
  const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const db = new Database(options.dbPath, { readonly: !options.apply, fileMustExist: true, timeout: 5000 });
  try {
    if (options.apply) db.pragma('foreign_keys = ON');
    db.transaction(() => validateCurrentRows(db, plan))();
    if (!options.apply) return { mode: 'dry-run' as const, planned: plan.entries.length, inserted: 0, planHash };
    await privateSnapshot(db, options.backupPath!);
    const batchId = randomUUID();
    db.transaction(() => {
      // Backup is asynchronous. Revalidate every reviewed row again under the write lock.
      validateCurrentRows(db, plan);
      const insert = db.prepare('INSERT INTO support_ticket_owners (ticket_id,issuer,subject,read_revision) VALUES (?,?,?,NULL)');
      // Unlike logAudit(), this must throw: missing audit evidence rolls back ALL grants.
      const audit = db.prepare(`INSERT INTO audit_log
        (id,user_id,action,entity_type,entity_id,details,ip_address,api_key_id,created_at)
        VALUES (?,?,'support_history_link','support_ticket_owner',?,?,NULL,NULL,?)`);
      const now = new Date().toISOString();
      for (const entry of plan.entries) {
        insert.run(entry.ticketId, plan.issuer, entry.subject);
        audit.run(randomUUID(), plan.actorUserId, entry.ticketId, JSON.stringify({
          batchId, planHash, issuer: plan.issuer, subject: entry.subject, requesterId: entry.requesterId,
          reason: plan.reason, previousOwner: null, readRevision: null,
        }), now);
      }
    }).immediate();
    return { mode: 'applied' as const, planned: plan.entries.length, inserted: plan.entries.length,
      batchId, planHash, backupPath: resolve(options.backupPath!), unreadBaseline: 'unread' as const };
  } finally { db.close(); }
}

export function parseBackfillArgs(args: string[]) {
  const values = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply' && !apply) { apply = true; continue; }
    if (!['--db', '--plan', '--backup'].includes(arg) || values.has(arg) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: --db DB --plan PLAN [--apply --backup NEW_BACKUP_PATH]');
    }
    values.set(arg, args[++i]);
  }
  if (!values.get('--db') || !values.get('--plan')) throw new Error('--db and --plan are required');
  if (apply !== values.has('--backup')) throw new Error('--apply and --backup must be specified together');
  return { dbPath: resolve(values.get('--db')!), planPath: resolve(values.get('--plan')!),
    apply, backupPath: values.has('--backup') ? resolve(values.get('--backup')!) : undefined };
}

export async function runBackfillCli(args: string[]): Promise<void> {
  const options = parseBackfillArgs(args);
  if (statSync(options.planPath).size > 8 * 1024 * 1024) throw new Error('Review plan exceeds 8 MiB');
  let plan: unknown;
  try { plan = JSON.parse(readFileSync(options.planPath, 'utf8')); }
  catch { throw new Error('Review plan must be valid JSON'); }
  const result = await backfillSupportOwners({ ...options, plan, configuredIssuer: process.env.NAVET_SUPPORT_ISSUER });
  // Summary only: no names, email addresses, ticket bodies, credentials or assertions.
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBackfillCli(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Historical ownership backfill refused: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    process.exitCode = 1;
  });
}
