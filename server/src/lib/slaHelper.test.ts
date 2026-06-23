import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory DB setup
// We create a minimal tickets table that covers all columns touched by
// handleSLAStatusChange(). The module is mocked to use this DB instance.
// ─────────────────────────────────────────────────────────────────────────────

let memDb: InstanceType<typeof Database>;

// Mock the DB connection BEFORE importing the module under test.
// vi.mock is hoisted, so the factory runs before any imports in this file.
vi.mock('../db/connection.js', () => {
  // We return a proxy object; tests will set memDb before calling helpers.
  const proxy = {
    prepare: (...args: Parameters<InstanceType<typeof Database>['prepare']>) =>
      memDb.prepare(...args),
    transaction: (...args: Parameters<InstanceType<typeof Database>['transaction']>) =>
      memDb.transaction(...args),
    pragma: vi.fn(),
    exec: vi.fn(),
  };
  return { db: proxy };
});

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { handleSLAStatusChange } from './slaHelper.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createSchema(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      sla_response_deadline TEXT,
      sla_resolution_deadline TEXT,
      sla_paused_at TEXT,
      sla_paused_duration INTEGER DEFAULT 0,
      sla_response_met INTEGER,
      sla_resolution_met INTEGER
    )
  `);
}

function insertTicket(
  db: InstanceType<typeof Database>,
  id: string,
  opts: {
    sla_response_deadline?: string | null;
    sla_resolution_deadline?: string | null;
    sla_paused_at?: string | null;
    sla_paused_duration?: number;
  } = {}
) {
  db.prepare(
    `INSERT INTO tickets
      (id, sla_response_deadline, sla_resolution_deadline, sla_paused_at, sla_paused_duration)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.sla_response_deadline ?? null,
    opts.sla_resolution_deadline ?? null,
    opts.sla_paused_at ?? null,
    opts.sla_paused_duration ?? 0
  );
}

function getTicket(db: InstanceType<typeof Database>, id: string) {
  return db
    .prepare(
      `SELECT sla_response_deadline, sla_resolution_deadline,
              sla_paused_at, sla_paused_duration,
              sla_response_met, sla_resolution_met
       FROM tickets WHERE id = ?`
    )
    .get(id) as {
    sla_response_deadline: string | null;
    sla_resolution_deadline: string | null;
    sla_paused_at: string | null;
    sla_paused_duration: number;
    sla_response_met: number | null;
    sla_resolution_met: number | null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  memDb = new Database(':memory:');
  createSchema(memDb);
});

afterEach(() => {
  memDb.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Pause
// ─────────────────────────────────────────────────────────────────────────────

describe('handleSLAStatusChange — pause', () => {
  it('sets sla_paused_at when status changes to "waiting"', () => {
    const id = 'ticket-1';
    const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    insertTicket(memDb, id, {
      sla_response_deadline: deadline,
      sla_resolution_deadline: deadline,
    });

    const before = Date.now();
    handleSLAStatusChange(id, 'open', 'waiting');
    const after = Date.now();

    const row = getTicket(memDb, id);
    expect(row.sla_paused_at).not.toBeNull();
    const pausedAt = new Date(row.sla_paused_at!).getTime();
    expect(pausedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(pausedAt).toBeLessThanOrEqual(after + 1000);
  });

  it('does NOT overwrite sla_paused_at if already paused', () => {
    const id = 'ticket-2';
    const existingPause = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    insertTicket(memDb, id, {
      sla_response_deadline: deadline,
      sla_resolution_deadline: deadline,
      sla_paused_at: existingPause,
    });

    handleSLAStatusChange(id, 'open', 'waiting');
    const row = getTicket(memDb, id);
    // Should not have changed since it was already paused
    expect(new Date(row.sla_paused_at!).toISOString()).toBe(existingPause);
  });

  it('does nothing if ticket has no SLA deadlines set', () => {
    const id = 'ticket-no-sla';
    insertTicket(memDb, id, { sla_response_deadline: null });

    handleSLAStatusChange(id, 'open', 'waiting');
    const row = getTicket(memDb, id);
    expect(row.sla_paused_at).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resume
// ─────────────────────────────────────────────────────────────────────────────

describe('handleSLAStatusChange — resume', () => {
  it('clears sla_paused_at and extends deadlines on resume from "waiting"', () => {
    const id = 'ticket-3';
    const pausedMinutesAgo = 10; // simulated pause of 10 min
    const pausedAt = new Date(Date.now() - pausedMinutesAgo * 60 * 1000).toISOString();
    const originalDeadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    insertTicket(memDb, id, {
      sla_response_deadline: originalDeadline,
      sla_resolution_deadline: originalDeadline,
      sla_paused_at: pausedAt,
      sla_paused_duration: 0,
    });

    handleSLAStatusChange(id, 'waiting', 'in_progress');
    const row = getTicket(memDb, id);

    expect(row.sla_paused_at).toBeNull();

    // Deadlines must have been extended by ~pausedMinutesAgo minutes
    const origMs = new Date(originalDeadline).getTime();
    const newResponseMs = new Date(row.sla_response_deadline!).getTime();
    const extensionMinutes = Math.round((newResponseMs - origMs) / 60000);
    expect(extensionMinutes).toBeGreaterThanOrEqual(pausedMinutesAgo - 1);
    expect(extensionMinutes).toBeLessThanOrEqual(pausedMinutesAgo + 1);
  });

  it('accumulates sla_paused_duration across multiple pause/resume cycles', () => {
    const id = 'ticket-4';
    const pausedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    insertTicket(memDb, id, {
      sla_response_deadline: deadline,
      sla_resolution_deadline: deadline,
      sla_paused_at: pausedAt,
      sla_paused_duration: 15, // already paused 15 min in a previous cycle
    });

    handleSLAStatusChange(id, 'waiting', 'open');
    const row = getTicket(memDb, id);

    // total paused duration = 15 + ~5 = ~20 min
    expect(row.sla_paused_duration).toBeGreaterThanOrEqual(19);
    expect(row.sla_paused_duration).toBeLessThanOrEqual(21);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resolution SLA marking
// ─────────────────────────────────────────────────────────────────────────────

describe('handleSLAStatusChange — resolution marking', () => {
  it('marks sla_resolution_met=1 when resolved before deadline', () => {
    const id = 'ticket-5';
    const futureDeadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    insertTicket(memDb, id, {
      sla_response_deadline: futureDeadline,
      sla_resolution_deadline: futureDeadline,
    });

    handleSLAStatusChange(id, 'open', 'resolved');
    const row = getTicket(memDb, id);
    expect(row.sla_resolution_met).toBe(1);
  });

  it('marks sla_resolution_met=0 when resolved after deadline', () => {
    const id = 'ticket-6';
    const pastDeadline = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    insertTicket(memDb, id, {
      sla_response_deadline: pastDeadline,
      sla_resolution_deadline: pastDeadline,
    });

    handleSLAStatusChange(id, 'open', 'resolved');
    const row = getTicket(memDb, id);
    expect(row.sla_resolution_met).toBe(0);
  });

  it('marks sla_resolution_met on status "closed" as well', () => {
    const id = 'ticket-7';
    const futureDeadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    insertTicket(memDb, id, {
      sla_response_deadline: futureDeadline,
      sla_resolution_deadline: futureDeadline,
    });

    handleSLAStatusChange(id, 'resolved', 'closed');
    const row = getTicket(memDb, id);
    expect(row.sla_resolution_met).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Response SLA marking
// ─────────────────────────────────────────────────────────────────────────────

describe('handleSLAStatusChange — response marking', () => {
  it('marks sla_response_met=1 when first response is before deadline', () => {
    const id = 'ticket-8';
    const futureDeadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    insertTicket(memDb, id, {
      sla_response_deadline: futureDeadline,
      sla_resolution_deadline: futureDeadline,
    });

    handleSLAStatusChange(id, 'open', 'in_progress');
    const row = getTicket(memDb, id);
    expect(row.sla_response_met).toBe(1);
  });

  it('marks sla_response_met=0 when first response is after deadline', () => {
    const id = 'ticket-9';
    const pastDeadline = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    insertTicket(memDb, id, {
      sla_response_deadline: pastDeadline,
      sla_resolution_deadline: pastDeadline,
    });

    handleSLAStatusChange(id, 'open', 'in_progress');
    const row = getTicket(memDb, id);
    expect(row.sla_response_met).toBe(0);
  });
});
