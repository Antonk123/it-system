import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Unit tests for ticketAccess.ts — in particular filterAccessibleTicketIds(),
 * the batched (single IN(...) query) variant of canAccessTicket() added to
 * close an N+1 in POST /api/checklists/progress (previously one SELECT per
 * requested ticket id). These tests prove filterAccessibleTicketIds() has the
 * exact same access semantics as canAccessTicket() for the same inputs:
 * admin → everything; non-admin → only requester/assignee/creator matches;
 * non-existent ids are excluded either way.
 *
 * Uses a real (temp file) DB directly — no HTTP layer — matching the pattern
 * in ticketNotifications.test.ts. UNIQUE DB_PATH suffix (-ticketaccess) so
 * parallel suites don't collide. vi.hoisted() is required (not a plain
 * function call) because ESM import statements are hoisted above ordinary
 * code — only vi.hoisted()/vi.mock() are moved above them by vitest's
 * transform, so DB_PATH must be set that way before '../db/connection.js' is
 * imported below.
 */

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-ticketaccess.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = 'test-csrf-secret-ticketaccess-0123456789abcdef0123456789abcdef';
  process.env.JWT_SECRET = 'test-jwt-secret-ticketaccess-0123456789abcdef0123456789abcdef';
  return { DB_PATH: dbPath };
});

import { initializeDatabase, db, closeDatabase } from '../db/connection.js';
import { canAccessTicket, filterAccessibleTicketIds } from './ticketAccess.js';

let adminId: string;
let ownerId: string;   // matches via created_by
let assigneeId: string; // matches via assigned_to
let strangerId: string; // matches nothing

let ownedTicketId: string;     // created_by = owner
let assignedTicketId: string;  // assigned_to = assignee
let unrelatedTicketId: string; // belongs to no one relevant
const missingTicketId = randomUUID(); // never inserted

beforeAll(() => {
  initializeDatabase();

  adminId = randomUUID();
  ownerId = randomUUID();
  assigneeId = randomUUID();
  strangerId = randomUUID();

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  );
  insertUser.run(adminId, 'admin@ticketaccesstest.local', 'x', 'admin', 'TA Admin');
  insertUser.run(ownerId, 'owner@ticketaccesstest.local', 'x', 'user', 'TA Owner');
  insertUser.run(assigneeId, 'assignee@ticketaccesstest.local', 'x', 'user', 'TA Assignee');
  insertUser.run(strangerId, 'stranger@ticketaccesstest.local', 'x', 'user', 'TA Stranger');

  const insertTicket = db.prepare(
    `INSERT INTO tickets (id, title, description, status, assigned_to, created_by)
     VALUES (?, ?, ?, 'open', ?, ?)`
  );

  ownedTicketId = randomUUID();
  insertTicket.run(ownedTicketId, 'Owned ticket', 'desc', null, ownerId);

  assignedTicketId = randomUUID();
  insertTicket.run(assignedTicketId, 'Assigned ticket', 'desc', assigneeId, null);

  unrelatedTicketId = randomUUID();
  insertTicket.run(unrelatedTicketId, 'Unrelated ticket', 'desc', null, null);
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('filterAccessibleTicketIds', () => {
  it('returns [] for an empty input array without touching the DB', () => {
    expect(filterAccessibleTicketIds({ id: strangerId, role: 'user' }, [])).toEqual([]);
  });

  it('returns all ids for an admin, including ones that do not exist', () => {
    const input = [ownedTicketId, assignedTicketId, unrelatedTicketId, missingTicketId];
    const result = filterAccessibleTicketIds({ id: adminId, role: 'admin' }, input);
    expect(result.sort()).toEqual([...input].sort());
  });

  it('keeps only the owner-created ticket for a non-admin matched via created_by', () => {
    const result = filterAccessibleTicketIds(
      { id: ownerId, role: 'user' },
      [ownedTicketId, assignedTicketId, unrelatedTicketId]
    );
    expect(result).toEqual([ownedTicketId]);
  });

  it('keeps only the assigned ticket for a non-admin matched via assigned_to', () => {
    const result = filterAccessibleTicketIds(
      { id: assigneeId, role: 'user' },
      [ownedTicketId, assignedTicketId, unrelatedTicketId]
    );
    expect(result).toEqual([assignedTicketId]);
  });

  it('drops all ids for a stranger with no relationship to any ticket', () => {
    const result = filterAccessibleTicketIds(
      { id: strangerId, role: 'user' },
      [ownedTicketId, assignedTicketId, unrelatedTicketId]
    );
    expect(result).toEqual([]);
  });

  it('excludes non-existent ticket ids for non-admins', () => {
    const result = filterAccessibleTicketIds({ id: ownerId, role: 'user' }, [missingTicketId]);
    expect(result).toEqual([]);
  });

  it('chunks batches larger than the SQLite parameter ceiling (900)', () => {
    // 950 missing ids + the one real, accessible id — forces >1 IN(...) chunk.
    const filler = Array.from({ length: 950 }, () => randomUUID());
    const input = [...filler, ownedTicketId];
    const result = filterAccessibleTicketIds({ id: ownerId, role: 'user' }, input);
    expect(result).toEqual([ownedTicketId]);
  });

  it('matches canAccessTicket exactly for every (user, ticket) pair', () => {
    const users: { id: string; role: 'admin' | 'user' }[] = [
      { id: adminId, role: 'admin' },
      { id: ownerId, role: 'user' },
      { id: assigneeId, role: 'user' },
      { id: strangerId, role: 'user' },
    ];
    const ticketIds = [ownedTicketId, assignedTicketId, unrelatedTicketId, missingTicketId];

    for (const user of users) {
      const batched = new Set(filterAccessibleTicketIds(user, ticketIds));
      for (const ticketId of ticketIds) {
        expect(batched.has(ticketId)).toBe(canAccessTicket(user, ticketId));
      }
    }
  });
});
