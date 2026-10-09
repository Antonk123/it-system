import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  validatePaginationParams,
  buildWhereClause,
  buildOrderByClause,
} from './ticketQuery.js';

// Pure SQL-fragment builders extracted from routes/tickets.ts (M-cq3).
// They touch no DB — assert the produced clause strings and bound params.

describe('validatePaginationParams', () => {
  it('returns defaults for empty query', () => {
    // NOTE (verbatim-preserved quirk): when `limit` is omitted the allow-list
    // check uses the '10' default, but the assignment reads query.limit! which
    // is undefined → parseInt(undefined) === NaN. Behavior matches the original
    // routes/tickets.ts implementation exactly; the route applies LIMIT later.
    const result = validatePaginationParams({});
    expect(result.page).toBe(1);
    expect(result.limit).toBeNaN();
    expect(result.sortBy).toBe('createdAt');
    expect(result.sortDir).toBe('desc');
  });

  it('accepts each allowed limit value', () => {
    for (const l of [10, 20, 25, 50, 100, 1000]) {
      expect(validatePaginationParams({ limit: String(l) }).limit).toBe(l);
    }
  });

  it('falls back to 10 for a disallowed limit', () => {
    expect(validatePaginationParams({ limit: '37' }).limit).toBe(10);
  });

  it('falls back to 10 for a non-numeric limit', () => {
    expect(validatePaginationParams({ limit: 'abc' }).limit).toBe(10);
  });

  it('clamps page to a minimum of 1', () => {
    expect(validatePaginationParams({ page: '0' }).page).toBe(1);
    expect(validatePaginationParams({ page: '-5' }).page).toBe(1);
  });

  it('parses a valid page number', () => {
    expect(validatePaginationParams({ page: '4' }).page).toBe(4);
  });

  it('accepts allowed sort columns', () => {
    for (const s of ['createdAt', 'status', 'priority', 'category']) {
      expect(validatePaginationParams({ sortBy: s }).sortBy).toBe(s);
    }
  });

  it('falls back to createdAt for an invalid sort column', () => {
    expect(validatePaginationParams({ sortBy: 'evil' }).sortBy).toBe('createdAt');
  });

  it('only treats "asc" as ascending; everything else is desc', () => {
    expect(validatePaginationParams({ sortDir: 'asc' }).sortDir).toBe('asc');
    expect(validatePaginationParams({ sortDir: 'desc' }).sortDir).toBe('desc');
    expect(validatePaginationParams({ sortDir: 'sideways' }).sortDir).toBe('desc');
  });
});

describe('buildWhereClause', () => {
  it('excludes closed tickets by default when no status given', () => {
    const { whereClause, params, joins } = buildWhereClause({});
    expect(whereClause).toBe("tickets.status != 'closed'");
    expect(params).toEqual([]);
    expect(joins).toBe('');
  });

  it("treats status 'all' as no status filter (1=1)", () => {
    const { whereClause, params } = buildWhereClause({ status: 'all' });
    expect(whereClause).toBe('1=1');
    expect(params).toEqual([]);
  });

  it('builds a single-status equality filter', () => {
    const { whereClause, params } = buildWhereClause({ status: 'open' });
    expect(whereClause).toBe('tickets.status = ?');
    expect(params).toEqual(['open']);
  });

  it('builds an IN clause for multiple valid statuses', () => {
    const { whereClause, params } = buildWhereClause({ status: 'open,closed' });
    expect(whereClause).toBe('tickets.status IN (?,?)');
    expect(params).toEqual(['open', 'closed']);
  });

  it('drops invalid statuses from a multi-status list', () => {
    const { whereClause, params } = buildWhereClause({ status: 'open,bogus' });
    expect(whereClause).toBe('tickets.status IN (?)');
    expect(params).toEqual(['open']);
  });

  it('returns 1 = 0 when a multi-status list has no valid values', () => {
    const { whereClause, params } = buildWhereClause({ status: 'bogus,nope' });
    expect(whereClause).toBe('1 = 0');
    expect(params).toEqual([]);
  });

  it('adds a priority filter', () => {
    const { whereClause, params } = buildWhereClause({ status: 'open', priority: 'high' });
    expect(whereClause).toBe('tickets.status = ? AND tickets.priority = ?');
    expect(params).toEqual(['open', 'high']);
  });

  it('adds a category filter', () => {
    const { params } = buildWhereClause({ status: 'open', category: 'cat-1' });
    expect(params).toEqual(['open', 'cat-1']);
  });

  it('adds an assignee filter', () => {
    const { whereClause, params } = buildWhereClause({ status: 'open', assigned_to: 'user-1' });
    expect(whereClause).toContain('tickets.assigned_to = ?');
    expect(params).toEqual(['open', 'user-1']);
  });

  it('combines multiple filters with AND in declaration order', () => {
    const { whereClause, params } = buildWhereClause({
      status: 'open',
      priority: 'high',
      company_id: 'co-1',
      assigned_to: 'user-1',
      requester_id: 'req-1',
    });
    expect(whereClause).toBe(
      'tickets.status = ? AND tickets.priority = ? AND tickets.company_id = ? AND tickets.assigned_to = ? AND tickets.requester_id = ?'
    );
    expect(params).toEqual(['open', 'high', 'co-1', 'user-1', 'req-1']);
  });

  it('ignores "all" sentinel for priority/company/assignee/requester', () => {
    const { whereClause, params } = buildWhereClause({
      status: 'open',
      priority: 'all',
      company_id: 'all',
      assigned_to: 'all',
      requester_id: 'all',
    });
    expect(whereClause).toBe('tickets.status = ?');
    expect(params).toEqual(['open']);
  });

  it.each(['or', 'and'])('ignores retired tag filters (%s) without hiding tickets', (tagMode) => {
    const { whereClause, params } = buildWhereClause({ status: 'open', tags: 't1,t2', tagMode });
    expect(whereClause).toBe('tickets.status = ?');
    expect(params).toEqual(['open']);
  });

  it('applies a date range on the default created_at field', () => {
    const { whereClause, params } = buildWhereClause({
      status: 'open',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });
    expect(whereClause).toContain('tickets.created_at >= ?');
    expect(whereClause).toContain('tickets.created_at < ?');
    // dateTo är inklusiv → exklusiv övre gräns = nästa dag
    expect(params).toEqual(['open', '2024-01-01', '2024-02-01']);
  });

  it('rolls dateTo over month and year boundaries', () => {
    const { params } = buildWhereClause({ status: 'open', dateTo: '2024-12-31' });
    expect(params).toEqual(['open', '2025-01-01']);
  });

  it('ignores malformed or impossible dates instead of comparing garbage', () => {
    const { whereClause, params } = buildWhereClause({
      status: 'open',
      dateFrom: '2024-1-1',
      dateTo: '2024-02-31',
    });
    expect(whereClause).toBe('tickets.status = ?');
    expect(params).toEqual(['open']);
  });

  it('honors an allowed dateField (updated_at)', () => {
    const { whereClause } = buildWhereClause({
      status: 'open',
      dateField: 'updated_at',
      dateFrom: '2024-01-01',
    });
    expect(whereClause).toContain('tickets.updated_at >= ?');
  });

  it('falls back to created_at for a disallowed dateField', () => {
    const { whereClause } = buildWhereClause({
      status: 'open',
      dateField: 'evil; DROP',
      dateFrom: '2024-01-01',
    });
    expect(whereClause).toContain('tickets.created_at >= ?');
    expect(whereClause).not.toContain('evil');
  });

  it('builds year/month filters with a padded month', () => {
    const { whereClause, params } = buildWhereClause({
      status: 'open',
      year: '2024',
      month: '0', // January (0-based) -> '01'
    });
    expect(whereClause).toContain('tickets.created_at >= ? AND tickets.created_at < ?');
    expect(whereClause).not.toContain('strftime');
    expect(params).toEqual(['open', '2024-01-01', '2024-02-01']);
  });

  it('builds a year-only range', () => {
    const { params } = buildWhereClause({ status: 'open', year: '2024' });
    expect(params).toEqual(['open', '2024-01-01', '2025-01-01']);
  });

  it('wraps December into the next year', () => {
    const { params } = buildWhereClause({ status: 'open', year: '2024', month: '11' });
    expect(params).toEqual(['open', '2024-12-01', '2025-01-01']);
  });

  it('ignores an out-of-range month but keeps the year', () => {
    const { params } = buildWhereClause({ status: 'open', year: '2024', month: '12' });
    expect(params).toEqual(['open', '2024-01-01', '2025-01-01']);
  });

  it('matches nothing for a non-numeric year', () => {
    const { whereClause } = buildWhereClause({ status: 'open', year: 'abc' });
    expect(whereClause).toContain('1 = 0');
  });

  it('builds a FTS + relation search with JOINs and bound params', () => {
    const { whereClause, params, joins } = buildWhereClause({ status: 'open', search: 'printer' });
    // FTS subquery + 6 relation LIKE fallbacks
    expect(whereClause).toContain('tickets_fts MATCH ?');
    expect(whereClause).toContain('contacts.name LIKE ?');
    expect(whereClause).toContain('ticket_field_values.field_value LIKE ?');
    // params: status + 1 FTS term + 6 LIKE patterns
    expect(params[0]).toBe('open');
    expect(params[1]).toBe('"printer"*');
    expect(params.slice(2)).toEqual(Array(5).fill('%printer%'));
    expect(joins).toContain('LEFT JOIN contacts');
    expect(joins).toContain('LEFT JOIN ticket_field_values');
  });

  it('falls back to a 3-field LIKE search when the term is empty after sanitization', () => {
    const { whereClause, params, joins } = buildWhereClause({ status: 'open', search: '***' });
    expect(whereClause).not.toContain('tickets_fts MATCH');
    expect(whereClause).toContain('contacts.name LIKE ?');
    // status + 3 LIKE patterns; the LIKE pattern keeps the raw (unsanitized) term
    expect(params[0]).toBe('open');
    expect(params.slice(1)).toEqual(Array(3).fill('%***%'));
    expect(joins).toContain('LEFT JOIN contacts');
  });

  it('escapes LIKE special characters in the relation fallback pattern', () => {
    const { params } = buildWhereClause({ status: 'open', search: '50%_x' });
    // FTS sanitization does not strip % or _, so the FTS term keeps them
    expect(params[1]).toBe('"50%_x"*');
    // The LIKE fallback pattern escapes % and _ with a backslash
    expect(params.slice(2)).toEqual(Array(5).fill('%50\\%\\_x%'));
  });

  it('applies checklist all_done filter conditions', () => {
    const { whereClause } = buildWhereClause({ status: 'open', checklist: 'all_done' });
    expect(whereClause).toContain('ticket_checklists.completed = 0) = 0');
  });
});

describe('buildOrderByClause', () => {
  it('defaults to created_at for an unknown sort column', () => {
    expect(buildOrderByClause('whatever', 'desc')).toBe('tickets.created_at DESC, tickets.id');
  });

  it('respects asc/desc direction (uppercased)', () => {
    expect(buildOrderByClause('createdAt', 'asc')).toBe('tickets.created_at ASC, tickets.id');
    expect(buildOrderByClause('createdAt', 'desc')).toBe('tickets.created_at DESC, tickets.id');
  });

  it('builds a CASE expression for status sort', () => {
    const sql = buildOrderByClause('status', 'asc');
    expect(sql).toContain('CASE tickets.status');
    expect(sql).toContain("WHEN 'open' THEN 0");
    expect(sql.trimEnd().endsWith('ASC, tickets.id')).toBe(true);
  });

  it('builds a CASE expression for priority sort', () => {
    const sql = buildOrderByClause('priority', 'desc');
    expect(sql).toContain('CASE tickets.priority');
    expect(sql).toContain("WHEN 'critical' THEN 3");
    expect(sql.trimEnd().endsWith('DESC, tickets.id')).toBe(true);
  });

  it('sorts by category_id for category sort', () => {
    expect(buildOrderByClause('category', 'asc')).toBe('tickets.category_id ASC, tickets.id');
  });

  it('falls back to created_at for retired tag sorting', () => {
    expect(buildOrderByClause('tags', 'desc')).toBe('tickets.created_at DESC, tickets.id');
  });

  it('always ends with the id tiebreaker so pagination is stable', () => {
    for (const sortBy of ['createdAt', 'status', 'priority', 'category']) {
      expect(buildOrderByClause(sortBy, 'asc')).toMatch(/, tickets\.id$/);
    }
  });
});

describe('repeated query parameters (arrays from Express)', () => {
  const arr = (...values: string[]) => values as unknown as string;

  it('does not throw on any array-valued filter', () => {
    expect(() =>
      buildWhereClause({
        status: arr('open', 'closed'),
        priority: arr('high', 'low'),
        category: arr('a', 'b'),
        company_id: arr('a', 'b'),
        assigned_to: arr('a', 'b'),
        requester_id: arr('a', 'b'),
        search: arr('printer', 'wifi'),
        dateFrom: arr('2024-01-01', '2024-02-01'),
        dateTo: arr('2024-01-31', '2024-02-28'),
        dateField: arr('updated_at', 'created_at'),
        checklist: arr('all_done', 'none_done'),
        year: arr('2024', '2025'),
        month: arr('1', '2'),
      })
    ).not.toThrow();
  });

  it('uses the first element of an array', () => {
    const { whereClause, params } = buildWhereClause({ status: arr('waiting', 'open'), priority: arr('high', 'low') });
    expect(whereClause).toBe('tickets.status = ? AND tickets.priority = ?');
    expect(params).toEqual(['waiting', 'high']);
  });

  it('ignores non-string values such as nested query objects', () => {
    const nested = { x: '1' } as unknown as string;
    const { whereClause, params } = buildWhereClause({ priority: nested, search: nested });
    expect(whereClause).toBe("tickets.status != 'closed'");
    expect(params).toEqual([]);
  });

  it('does not throw in pagination validation', () => {
    expect(validatePaginationParams({ page: arr('2', '3'), limit: arr('50', '10'), sortBy: arr('status'), sortDir: arr('asc') })).toEqual({
      page: 2,
      limit: 50,
      sortBy: 'status',
      sortDir: 'asc',
    });
  });
});

describe('date filters against real rows (SQLite and ISO timestamp formats)', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE tickets (id TEXT PRIMARY KEY, status TEXT, created_at TEXT, updated_at TEXT, closed_at TEXT)');
    const insert = db.prepare("INSERT INTO tickets (id, status, created_at) VALUES (?, 'open', ?)");
    insert.run('before', '2026-09-30 23:59:59');
    insert.run('sqlite-format', '2026-10-01 08:30:00');
    insert.run('iso-format', '2026-10-01T09:15:00.000Z');
    insert.run('iso-end-of-day', '2026-10-01T23:59:59.999Z');
    insert.run('after', '2026-10-02 00:00:00');
  });
  afterEach(() => db.close());

  const ids = (filters: Parameters<typeof buildWhereClause>[0]) => {
    const { whereClause, params } = buildWhereClause({ status: 'open', ...filters });
    return (db.prepare(`SELECT id FROM tickets WHERE ${whereClause} ORDER BY id`).all(...params) as { id: string }[]).map((r) => r.id);
  };

  it('dateFrom includes every ticket from that day regardless of timestamp format', () => {
    expect(ids({ dateFrom: '2026-10-01' })).toEqual(['after', 'iso-end-of-day', 'iso-format', 'sqlite-format']);
  });

  it('a single-day range returns both formats and nothing outside the day', () => {
    expect(ids({ dateFrom: '2026-10-01', dateTo: '2026-10-01' })).toEqual(['iso-end-of-day', 'iso-format', 'sqlite-format']);
  });

  it('year/month filter finds both formats', () => {
    expect(ids({ year: '2026', month: '9' })).toEqual(['after', 'iso-end-of-day', 'iso-format', 'sqlite-format']);
    expect(ids({ year: '2026', month: '8' })).toEqual(['before']);
  });

  it('uses the created_at index for a range (no table scan)', () => {
    db.exec('CREATE INDEX idx_tickets_created_at ON tickets(created_at)');
    const { whereClause, params } = buildWhereClause({ status: 'open', year: '2026' });
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM tickets WHERE ${whereClause}`).all(...params) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('idx_tickets_created_at');
  });
});
