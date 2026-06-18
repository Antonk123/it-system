import { describe, it, expect } from 'vitest';
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
    for (const s of ['createdAt', 'status', 'priority', 'category', 'tags']) {
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

  it('builds an OR tag filter (EXISTS) by default', () => {
    const { whereClause, params } = buildWhereClause({ status: 'open', tags: 't1,t2' });
    expect(whereClause).toContain('EXISTS (');
    expect(whereClause).toContain('ticket_tags.tag_id IN (?,?)');
    expect(params).toEqual(['open', 't1', 't2']);
  });

  it('builds an AND tag filter (COUNT DISTINCT) when tagMode=and', () => {
    const { whereClause, params } = buildWhereClause({
      status: 'open',
      tags: 't1,t2',
      tagMode: 'and',
    });
    expect(whereClause).toContain('COUNT(DISTINCT tag_id)');
    expect(whereClause).toContain(') = 2');
    expect(params).toEqual(['open', 't1', 't2']);
  });

  it('applies a date range on the default created_at field', () => {
    const { whereClause, params } = buildWhereClause({
      status: 'open',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });
    expect(whereClause).toContain('tickets.created_at >= ?');
    expect(whereClause).toContain('tickets.created_at <= ?');
    expect(params).toEqual([
      'open',
      '2024-01-01T00:00:00.000Z',
      '2024-01-31T23:59:59.999Z',
    ]);
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
    expect(whereClause).toContain("strftime('%Y', tickets.created_at) = ?");
    expect(whereClause).toContain("strftime('%m', tickets.created_at) = ?");
    expect(params).toEqual(['open', '2024', '01']);
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
    expect(params.slice(2)).toEqual(Array(6).fill('%printer%'));
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
    expect(params.slice(2)).toEqual(Array(6).fill('%50\\%\\_x%'));
  });

  it('applies checklist all_done filter conditions', () => {
    const { whereClause } = buildWhereClause({ status: 'open', checklist: 'all_done' });
    expect(whereClause).toContain('ticket_checklists.completed = 0) = 0');
  });
});

describe('buildOrderByClause', () => {
  it('defaults to created_at for an unknown sort column', () => {
    expect(buildOrderByClause('whatever', 'desc')).toBe('tickets.created_at DESC');
  });

  it('respects asc/desc direction (uppercased)', () => {
    expect(buildOrderByClause('createdAt', 'asc')).toBe('tickets.created_at ASC');
    expect(buildOrderByClause('createdAt', 'desc')).toBe('tickets.created_at DESC');
  });

  it('builds a CASE expression for status sort', () => {
    const sql = buildOrderByClause('status', 'asc');
    expect(sql).toContain('CASE tickets.status');
    expect(sql).toContain("WHEN 'open' THEN 0");
    expect(sql.trimEnd().endsWith('ASC')).toBe(true);
  });

  it('builds a CASE expression for priority sort', () => {
    const sql = buildOrderByClause('priority', 'desc');
    expect(sql).toContain('CASE tickets.priority');
    expect(sql).toContain("WHEN 'critical' THEN 3");
    expect(sql.trimEnd().endsWith('DESC')).toBe(true);
  });

  it('sorts by category_id for category sort', () => {
    expect(buildOrderByClause('category', 'asc')).toBe('tickets.category_id ASC');
  });

  it('builds a correlated subquery for tags sort', () => {
    const sql = buildOrderByClause('tags', 'desc');
    expect(sql).toContain('SELECT MIN(tags.name) COLLATE NOCASE');
    expect(sql.trimEnd().endsWith('DESC')).toBe(true);
  });
});
