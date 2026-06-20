import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory DB setup.
// These are the FIRST tests for the reports endpoints. They cover the SQL
// aggregation behind GET /reports/status-flow and GET /reports/tag-analytics —
// the whole point of moving this work server-side is that it counts the FULL
// dataset (including > 1000 tickets), which the old client-side aggregation
// could not. We mock the DB connection so importing the route module is cheap,
// then call the extracted pure aggregation helpers directly against memDb.
// ─────────────────────────────────────────────────────────────────────────────

let memDb: InstanceType<typeof Database>;

// vi.mock is hoisted; the factory runs before any imports in this file.
vi.mock('../db/connection.js', () => {
  const proxy = {
    prepare: (...args: Parameters<InstanceType<typeof Database>['prepare']>) =>
      memDb.prepare(...args),
    pragma: vi.fn(),
    exec: vi.fn(),
  };
  return { db: proxy };
});

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { computeStatusFlow, computeTagAnalytics, computeKpiTickets } from './reports.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schema + fixtures
// ─────────────────────────────────────────────────────────────────────────────

function createSchema(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE tickets (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT,
      category_id TEXT,
      requester_id TEXT,
      company_id TEXT,
      assigned_to TEXT,
      notes TEXT,
      solution TEXT,
      template_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      resolved_at TEXT,
      closed_at TEXT,
      ai_suggested_category_id TEXT,
      ai_suggested_confidence REAL,
      sla_response_deadline TEXT,
      sla_resolution_deadline TEXT,
      sla_response_met INTEGER,
      sla_resolution_met INTEGER,
      sla_paused_at TEXT,
      sla_paused_duration INTEGER
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      email TEXT
    );
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#3b82f6'
    );
    CREATE TABLE ticket_tags (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      tag_id TEXT NOT NULL
    );
  `);
}

function insertTicket(
  db: InstanceType<typeof Database>,
  id: string,
  status: string,
  createdAt: string,
) {
  db.prepare(`INSERT INTO tickets (id, status, created_at) VALUES (?, ?, ?)`).run(
    id,
    status,
    createdAt,
  );
}

function insertTag(db: InstanceType<typeof Database>, id: string, name: string, color = '#3b82f6') {
  db.prepare(`INSERT INTO tags (id, name, color) VALUES (?, ?, ?)`).run(id, name, color);
}

function attachTag(db: InstanceType<typeof Database>, ticketId: string, tagId: string) {
  db.prepare(`INSERT INTO ticket_tags (id, ticket_id, tag_id) VALUES (?, ?, ?)`).run(
    `${ticketId}_${tagId}`,
    ticketId,
    tagId,
  );
}

// Fixed "now" so the 12-month window is deterministic.
const NOW = new Date('2026-06-15T12:00:00Z');

// YYYY-MM key for `monthsAgo` months before NOW.
function monthKey(monthsAgo: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth() - monthsAgo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// A created_at timestamp inside the month `monthsAgo` months before NOW.
function dateIn(monthsAgo: number, day = 10): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth() - monthsAgo, day, 12, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} 12:00:00`;
}

beforeEach(() => {
  memDb = new Database(':memory:');
  createSchema(memDb);
});

afterEach(() => {
  memDb.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// status-flow
// ─────────────────────────────────────────────────────────────────────────────

describe('computeStatusFlow', () => {
  it('always returns exactly 12 buckets keyed by YYYY-MM, oldest first', () => {
    const result = computeStatusFlow(memDb, NOW);
    expect(result).toHaveLength(12);
    expect(result[0].month).toBe(monthKey(11));
    expect(result[11].month).toBe(monthKey(0));
    // Empty DB → all zeros.
    for (const row of result) {
      expect(row.open + row['in-progress'] + row.waiting + row.resolved + row.closed).toBe(0);
    }
  });

  it('counts tickets by current status within the month they were created', () => {
    // Current month: 2 open, 1 resolved.
    insertTicket(memDb, 'a', 'open', dateIn(0));
    insertTicket(memDb, 'b', 'open', dateIn(0));
    insertTicket(memDb, 'c', 'resolved', dateIn(0));
    // 3 months ago: 1 in-progress, 1 waiting, 1 closed.
    insertTicket(memDb, 'd', 'in-progress', dateIn(3));
    insertTicket(memDb, 'e', 'waiting', dateIn(3));
    insertTicket(memDb, 'f', 'closed', dateIn(3));

    const result = computeStatusFlow(memDb, NOW);
    const current = result.find(r => r.month === monthKey(0))!;
    const threeAgo = result.find(r => r.month === monthKey(3))!;

    expect(current.open).toBe(2);
    expect(current.resolved).toBe(1);
    expect(current['in-progress']).toBe(0);

    expect(threeAgo['in-progress']).toBe(1);
    expect(threeAgo.waiting).toBe(1);
    expect(threeAgo.closed).toBe(1);
  });

  it('excludes tickets older than the 12-month window', () => {
    insertTicket(memDb, 'old', 'open', dateIn(15)); // 15 months ago → outside window
    insertTicket(memDb, 'in', 'open', dateIn(11)); // 11 months ago → oldest bucket

    const result = computeStatusFlow(memDb, NOW);
    const total = result.reduce(
      (sum, r) => sum + r.open + r['in-progress'] + r.waiting + r.resolved + r.closed,
      0,
    );
    expect(total).toBe(1); // only the in-window ticket is counted
    expect(result[0].open).toBe(1);
  });

  it('counts correctly with MORE THAN 1000 tickets (the whole point)', () => {
    // Seed 1500 open tickets in the current month + 500 closed 2 months ago.
    // The old client aggregation capped at 1000 raw rows and would undercount.
    const insert = memDb.prepare(`INSERT INTO tickets (id, status, created_at) VALUES (?, ?, ?)`);
    const seed = memDb.transaction(() => {
      for (let i = 0; i < 1500; i++) insert.run(`open-${i}`, 'open', dateIn(0));
      for (let i = 0; i < 500; i++) insert.run(`closed-${i}`, 'closed', dateIn(2));
    });
    seed();

    expect(memDb.prepare('SELECT COUNT(*) AS c FROM tickets').get()).toEqual({ c: 2000 });

    const result = computeStatusFlow(memDb, NOW);
    expect(result.find(r => r.month === monthKey(0))!.open).toBe(1500);
    expect(result.find(r => r.month === monthKey(2))!.closed).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tag-analytics
// ─────────────────────────────────────────────────────────────────────────────

describe('computeTagAnalytics', () => {
  it('returns empty array when no tags are attached', () => {
    insertTag(memDb, 't1', 'orphan'); // tag exists but attached to nothing
    expect(computeTagAnalytics(memDb)).toEqual([]);
  });

  it('counts tickets per tag and sorts by count desc, then name asc', () => {
    insertTag(memDb, 't1', 'network', '#ff0000');
    insertTag(memDb, 't2', 'hardware', '#00ff00');
    insertTag(memDb, 't3', 'aaa', '#0000ff'); // same count as t2 → name tiebreak

    insertTicket(memDb, 'k1', 'open', dateIn(0));
    insertTicket(memDb, 'k2', 'open', dateIn(0));
    insertTicket(memDb, 'k3', 'open', dateIn(0));

    // network: 3, hardware: 1, aaa: 1
    attachTag(memDb, 'k1', 't1');
    attachTag(memDb, 'k2', 't1');
    attachTag(memDb, 'k3', 't1');
    attachTag(memDb, 'k1', 't2');
    attachTag(memDb, 'k2', 't3');

    const result = computeTagAnalytics(memDb);
    expect(result).toEqual([
      { id: 't1', name: 'network', color: '#ff0000', count: 3 },
      { id: 't3', name: 'aaa', color: '#0000ff', count: 1 }, // name tiebreak: aaa < hardware
      { id: 't2', name: 'hardware', color: '#00ff00', count: 1 },
    ]);
  });

  it('counts correctly with MORE THAN 1000 tagged tickets (the whole point)', () => {
    insertTag(memDb, 'big', 'recurring');

    const insertTk = memDb.prepare(`INSERT INTO tickets (id, status, created_at) VALUES (?, ?, ?)`);
    const insertTt = memDb.prepare(`INSERT INTO ticket_tags (id, ticket_id, tag_id) VALUES (?, ?, ?)`);
    const seed = memDb.transaction(() => {
      for (let i = 0; i < 1200; i++) {
        insertTk.run(`tk-${i}`, 'open', dateIn(0));
        insertTt.run(`tt-${i}`, `tk-${i}`, 'big');
      }
    });
    seed();

    const result = computeTagAnalytics(memDb);
    expect(result).toEqual([{ id: 'big', name: 'recurring', color: '#3b82f6', count: 1200 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// kpi-tickets
//
// Drill-down rows for the Reports KPI detail modals. Server-side replacement for
// the old client-side ?limit=1000 fetch + in-memory filtering. Two scopes:
//   'total' → created_at filtered by year/month
//   'aging' → status='open' AND age > 7d, ALWAYS ignoring year/month
// We assert column parity (assigned_to_name + tags[]), the LIMIT cap, and that
// the aging semantics ignore year/month even when supplied.
// ─────────────────────────────────────────────────────────────────────────────

function insertUser(db: InstanceType<typeof Database>, id: string, displayName: string, email = '') {
  db.prepare(`INSERT INTO users (id, display_name, email) VALUES (?, ?, ?)`).run(id, displayName, email);
}

// Insert a ticket with the columns the KPI helper cares about.
function insertKpiTicket(
  db: InstanceType<typeof Database>,
  id: string,
  status: string,
  createdAt: string,
  assignedTo: string | null = null,
) {
  db.prepare(
    `INSERT INTO tickets (id, title, status, created_at, assigned_to) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, `Ticket ${id}`, status, createdAt, assignedTo);
}

// A created_at `daysAgo` days before the REAL current time. The aging WHERE
// uses SQLite's julianday('now') (actual wall clock, not the NOW fixture), so
// aging fixtures must be anchored to real time to stay deterministic.
function dateDaysAgo(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 12:00:00`;
}

describe('computeKpiTickets', () => {
  it("scope='total' with no filter returns all rows (created_at DESC) with assigned_to_name + tags[]", () => {
    insertUser(memDb, 'u1', 'Anna Andersson');
    insertKpiTicket(memDb, 'a', 'open', dateIn(2), 'u1'); // older
    insertKpiTicket(memDb, 'b', 'resolved', dateIn(0)); // newer, unassigned
    insertTag(memDb, 't1', 'network', '#ff0000');
    attachTag(memDb, 'a', 't1');

    const result = computeKpiTickets(memDb, 'total');

    expect(result).toHaveLength(2);
    // created_at DESC → newest first
    expect(result[0].id).toBe('b');
    expect(result[1].id).toBe('a');

    const a = result.find(r => r.id === 'a')!;
    expect(a.assigned_to_name).toBe('Anna Andersson'); // correlated subquery resolved
    expect(a.tags).toEqual([{ id: 't1', name: 'network', color: '#ff0000' }]);

    const b = result.find(r => r.id === 'b')!;
    expect(b.assigned_to_name).toBeNull(); // unassigned → subquery returns NULL
    expect(b.tags).toEqual([]); // ticket without tags gets empty array
  });

  it("scope='total' with year/month only returns tickets in that range", () => {
    // NOW = 2026-06-15 → monthsAgo 0 == 2026-06, 5 == 2026-01, 6 == 2025-12.
    insertKpiTicket(memDb, 'jun', 'open', dateIn(0)); // 2026-06
    insertKpiTicket(memDb, 'jan', 'open', dateIn(5)); // 2026-01
    insertKpiTicket(memDb, 'dec25', 'open', dateIn(6)); // 2025-12 (different year)

    // Whole year 2026 → jun + jan, not dec25.
    const year2026 = computeKpiTickets(memDb, 'total', { year: '2026' });
    expect(year2026.map(r => r.id).sort()).toEqual(['jan', 'jun']);

    // June 2026 only (month index 5, 0-based) → just jun.
    const june = computeKpiTickets(memDb, 'total', { year: '2026', month: '5' });
    expect(june.map(r => r.id)).toEqual(['jun']);
  });

  it('throws on invalid year/month so the route can map to 400', () => {
    expect(() => computeKpiTickets(memDb, 'total', { year: '1999' })).toThrow('Invalid year');
    expect(() => computeKpiTickets(memDb, 'total', { year: 'abc' })).toThrow('Invalid year');
    expect(() => computeKpiTickets(memDb, 'total', { month: '12' })).toThrow('Invalid month');
  });

  it("scope='aging' only returns open tickets older than 7 days and IGNORES year/month", () => {
    insertKpiTicket(memDb, 'old-open', 'open', dateDaysAgo(10)); // qualifies
    insertKpiTicket(memDb, 'fresh-open', 'open', dateDaysAgo(3)); // too new
    insertKpiTicket(memDb, 'old-closed', 'closed', dateDaysAgo(30)); // wrong status

    // Passing year/month must NOT narrow the aging set (regression guard).
    const result = computeKpiTickets(memDb, 'aging', { year: '2099', month: '0' });

    expect(result.map(r => r.id)).toEqual(['old-open']);
    expect(result[0].tags).toEqual([]);
  });

  it('caps results at LIMIT 200 even with 250 matching tickets (the whole point)', () => {
    const insert = memDb.prepare(
      `INSERT INTO tickets (id, title, status, created_at) VALUES (?, ?, ?, ?)`,
    );
    const seed = memDb.transaction(() => {
      for (let i = 0; i < 250; i++) {
        // Pad index so created_at ordering is stable/distinct.
        insert.run(`tk-${String(i).padStart(3, '0')}`, `T${i}`, 'open', dateIn(0, (i % 28) + 1));
      }
    });
    seed();

    expect(memDb.prepare('SELECT COUNT(*) AS c FROM tickets').get()).toEqual({ c: 250 });

    const result = computeKpiTickets(memDb, 'total');
    expect(result).toHaveLength(200);
  });
});
