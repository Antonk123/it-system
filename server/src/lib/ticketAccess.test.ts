import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Unit tests for ticketAccess.ts. Policy: any authenticated user may READ any
 * ticket; WRITE requires admin, assignee, creator or an unassigned ticket
 * (self-service pickup). Uses a real (temp file) DB directly — no HTTP layer.
 * UNIQUE DB_PATH suffix (-ticketaccess) so parallel suites don't collide.
 * vi.hoisted() is required so DB_PATH is set before '../db/connection.js' is
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
import { canAccessTicket, canWriteTicketRow } from './ticketAccess.js';

let adminId: string;
let creatorId: string;  // matches via created_by
let assigneeId: string; // matches via assigned_to
let strangerId: string; // matches nothing

let createdTicketId: string;    // created_by = creator, assigned to someone else
let assignedTicketId: string;   // assigned_to = assignee
let unassignedTicketId: string; // assigned_to = NULL
const missingTicketId = randomUUID(); // never inserted

beforeAll(() => {
  initializeDatabase();

  adminId = randomUUID();
  creatorId = randomUUID();
  assigneeId = randomUUID();
  strangerId = randomUUID();

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  );
  insertUser.run(adminId, 'admin@ticketaccesstest.local', 'x', 'admin', 'TA Admin');
  insertUser.run(creatorId, 'creator@ticketaccesstest.local', 'x', 'user', 'TA Creator');
  insertUser.run(assigneeId, 'assignee@ticketaccesstest.local', 'x', 'user', 'TA Assignee');
  insertUser.run(strangerId, 'stranger@ticketaccesstest.local', 'x', 'user', 'TA Stranger');

  const insertTicket = db.prepare(
    `INSERT INTO tickets (id, title, description, status, assigned_to, created_by)
     VALUES (?, ?, ?, 'open', ?, ?)`
  );

  createdTicketId = randomUUID();
  insertTicket.run(createdTicketId, 'Created ticket', 'desc', assigneeId, creatorId);

  assignedTicketId = randomUUID();
  insertTicket.run(assignedTicketId, 'Assigned ticket', 'desc', assigneeId, null);

  unassignedTicketId = randomUUID();
  insertTicket.run(unassignedTicketId, 'Unassigned ticket', 'desc', null, null);
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

// canAccessTicket takes a request-shaped object ({ user, apiKey? }) so
// isEffectiveAdmin can see an API key's own scope — asReq() wraps a plain
// {id,role} for the JWT-session (no apiKey) cases.
function asReq(user: { id: string; role: 'admin' | 'user' }) {
  return { user };
}

describe('canAccessTicket (read)', () => {
  it('lets any authenticated user read any existing ticket', () => {
    for (const user of [
      { id: adminId, role: 'admin' as const },
      { id: creatorId, role: 'user' as const },
      { id: strangerId, role: 'user' as const },
    ]) {
      for (const ticketId of [createdTicketId, assignedTicketId, unassignedTicketId]) {
        expect(canAccessTicket(asReq(user), ticketId)).toBe(true);
      }
    }
  });

  it('is false for a missing ticket and for a request without a user', () => {
    expect(canAccessTicket(asReq({ id: adminId, role: 'admin' }), missingTicketId)).toBe(false);
    expect(canAccessTicket({}, createdTicketId)).toBe(false);
  });
});

describe('canAccessTicket (write)', () => {
  const write = { write: true };

  it('allows admin on any existing ticket', () => {
    const admin = asReq({ id: adminId, role: 'admin' });
    expect(canAccessTicket(admin, createdTicketId, write)).toBe(true);
    expect(canAccessTicket(admin, assignedTicketId, write)).toBe(true);
    expect(canAccessTicket(admin, unassignedTicketId, write)).toBe(true);
  });

  it('allows the assignee and the creator on an assigned ticket', () => {
    expect(canAccessTicket(asReq({ id: assigneeId, role: 'user' }), assignedTicketId, write)).toBe(true);
    expect(canAccessTicket(asReq({ id: creatorId, role: 'user' }), createdTicketId, write)).toBe(true);
  });

  it('denies a stranger on an assigned ticket', () => {
    const stranger = asReq({ id: strangerId, role: 'user' });
    expect(canAccessTicket(stranger, assignedTicketId, write)).toBe(false);
    expect(canAccessTicket(stranger, createdTicketId, write)).toBe(false);
  });

  it('allows anyone on an unassigned ticket (self-service pickup)', () => {
    expect(canAccessTicket(asReq({ id: strangerId, role: 'user' }), unassignedTicketId, write)).toBe(true);
  });

  it('is false for a missing ticket', () => {
    expect(canAccessTicket(asReq({ id: adminId, role: 'admin' }), missingTicketId, write)).toBe(false);
  });

  it('an admin-owner API key WITHOUT admin scope is treated as non-admin (isEffectiveAdmin)', () => {
    const req = { user: { id: adminId, role: 'admin' as const }, apiKey: { permissions: ['read', 'write'] } };
    expect(canAccessTicket(req, assignedTicketId, write)).toBe(false);
    expect(canAccessTicket(req, unassignedTicketId, write)).toBe(true);
  });

  it('an admin-owner API key WITH admin scope keeps full access (isEffectiveAdmin)', () => {
    const req = { user: { id: adminId, role: 'admin' as const }, apiKey: { permissions: ['read', 'admin'] } };
    expect(canAccessTicket(req, assignedTicketId, write)).toBe(true);
  });
});

describe('canWriteTicketRow', () => {
  it('matches canAccessTicket(write) for every (user, ticket) pair', () => {
    const users = [
      { id: adminId, role: 'admin' as const },
      { id: creatorId, role: 'user' as const },
      { id: assigneeId, role: 'user' as const },
      { id: strangerId, role: 'user' as const },
    ];
    for (const user of users) {
      for (const ticketId of [createdTicketId, assignedTicketId, unassignedTicketId]) {
        const row = db.prepare('SELECT assigned_to, created_by FROM tickets WHERE id = ?').get(ticketId) as {
          assigned_to: string | null; created_by: string | null;
        };
        expect(canWriteTicketRow(asReq(user), row)).toBe(canAccessTicket(asReq(user), ticketId, { write: true }));
      }
    }
  });
});
