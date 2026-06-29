import { Router } from 'express';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

// Minimal, nameable structural type for the bits of the DB the extracted
// aggregation helpers use. Avoids leaking the un-nameable BetterSqlite3.Database
// type into exported function signatures (TS4076) and lets tests pass an
// in-memory better-sqlite3 instance, which satisfies this shape structurally.
interface AggregationDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

router.get('/summary', authenticate, (req: AuthRequest, res) => {
  try {
  const { year, month } = req.query as { year?: string; month?: string };

  // Build filter conditions for created_at
  const filterConditions: string[] = [];
  const filterParams: string[] = [];

  if (year && year !== 'all') {
    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      res.status(400).json({ error: 'Invalid year parameter' });
      return;
    }
    // Range-filter så att idx_tickets_created_at kan användas (strftime kan inte)
    filterConditions.push("(created_at >= ? AND created_at < ?)");
    filterParams.push(`${yearNum}-01-01`, `${yearNum + 1}-01-01`);
  }

  if (month && month !== 'all') {
    // Frontend sends 0-based month index (0=Jan, 11=Dec).
    // strftime('%m') returns 1-based ("01"-"12"), so add 1.
    const monthNum = parseInt(month, 10);
    if (isNaN(monthNum) || monthNum < 0 || monthNum > 11) {
      res.status(400).json({ error: 'Invalid month parameter (expected 0-11)' });
      return;
    }
    const paddedMonth = String(monthNum + 1).padStart(2, '0');
    filterConditions.push("strftime('%m', created_at) = ?");
    filterParams.push(paddedMonth);
  }

  const whereCreated = filterConditions.length > 0
    ? `WHERE ${filterConditions.join(' AND ')}`
    : '';

  // Same conditions but prefixed with table alias for JOIN queries
  const whereCategoryConditions = filterConditions.map(c => c.replace('created_at', 't.created_at'));
  const whereCategoryCreated = whereCategoryConditions.length > 0
    ? `WHERE ${whereCategoryConditions.join(' AND ')}`
    : '';

  // 1. Totals — aggregate counts by status from the full dataset
  const totalsRow = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as inProgress,
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
      COUNT(*) as total
    FROM tickets
    ${whereCreated}
  `).get(...filterParams) as {
    open: number; inProgress: number; waiting: number;
    resolved: number; closed: number; total: number;
  };

  const totals = {
    open: totalsRow.open ?? 0,
    inProgress: totalsRow.inProgress ?? 0,
    waiting: totalsRow.waiting ?? 0,
    resolved: totalsRow.resolved ?? 0,
    closed: totalsRow.closed ?? 0,
    total: totalsRow.total ?? 0,
  };

  // 2. byCategory — count per category label, filtered by same created_at conditions
  const byCategory = db.prepare(`
    SELECT c.label as category, COUNT(t.id) as count
    FROM tickets t
    JOIN categories c ON t.category_id = c.id
    ${whereCategoryCreated}
    GROUP BY t.category_id
    ORDER BY count DESC
  `).all(...filterParams) as { category: string; count: number }[];

  // 2b. byPriority — count per priority level, filtered by same created_at conditions
  const byPriority = db.prepare(`
    SELECT priority, COUNT(*) as count
    FROM tickets
    ${whereCreated}
    GROUP BY priority
    ORDER BY CASE priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
      ELSE 5
    END
  `).all(...filterParams) as { priority: string; count: number }[];

  // 3. Trend — two separate queries merged via Map (avoids SQLite FULL OUTER JOIN limitation)
  let trendWhereCreated: string;
  let trendWhereClosed: string;
  let trendParams: string[];
  let trendClosedParams: string[];

  if (year && year !== 'all') {
    const yearNum = parseInt(year, 10);
    // Range-filter så att index kan användas (strftime kan inte)
    trendWhereCreated = "WHERE created_at >= ? AND created_at < ?";
    trendWhereClosed = "WHERE closed_at IS NOT NULL AND closed_at >= ? AND closed_at < ?";
    trendParams = [`${yearNum}-01-01`, `${yearNum + 1}-01-01`];
    trendClosedParams = [`${yearNum}-01-01`, `${yearNum + 1}-01-01`];
  } else {
    trendWhereCreated = "WHERE created_at >= date('now', '-12 months')";
    trendWhereClosed = "WHERE closed_at IS NOT NULL AND closed_at >= date('now', '-12 months')";
    trendParams = [];
    trendClosedParams = [];
  }

  const createdRows = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as created
    FROM tickets
    ${trendWhereCreated}
    GROUP BY month
    ORDER BY month ASC
  `).all(...trendParams) as { month: string; created: number }[];

  const closedRows = db.prepare(`
    SELECT strftime('%Y-%m', closed_at) as month, COUNT(*) as closed
    FROM tickets
    ${trendWhereClosed}
    GROUP BY month
    ORDER BY month ASC
  `).all(...trendClosedParams) as { month: string; closed: number }[];

  // Merge created and closed rows via Map keyed by month string
  const trendMap = new Map<string, { month: string; created: number; closed: number }>();
  for (const row of createdRows) {
    trendMap.set(row.month, { month: row.month, created: row.created, closed: 0 });
  }
  for (const row of closedRows) {
    const existing = trendMap.get(row.month);
    if (existing) {
      existing.closed = row.closed;
    } else {
      trendMap.set(row.month, { month: row.month, created: 0, closed: row.closed });
    }
  }
  const trend = Array.from(trendMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // 4. avgResolutionDays — average days between created_at and closed_at
  const resolutionWhereParts = ['closed_at IS NOT NULL', ...filterConditions];
  const resolutionWhere = `WHERE ${resolutionWhereParts.join(' AND ')}`;

  const resolutionRow = db.prepare(`
    SELECT AVG(CAST((julianday(closed_at) - julianday(created_at)) AS REAL)) as avgDays
    FROM tickets
    ${resolutionWhere}
  `).get(...filterParams) as { avgDays: number | null };

  const avgResolutionDays = resolutionRow.avgDays != null
    ? Math.round(resolutionRow.avgDays * 10) / 10
    : 0;

  // 5. agingTickets — open tickets older than 7 days (always current, no year/month filter)
  const agingRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM tickets
    WHERE status = 'open'
      AND julianday('now') - julianday(created_at) > 7
  `).get() as { count: number };

  const agingTickets = agingRow.count ?? 0;

  res.json({
    totals,
    byCategory,
    byPriority,
    trend,
    avgResolutionDays,
    agingTickets,
  });
  } catch (error) {
    logger.error('Error generating report summary:', { error: String(error) });
    res.status(500).json({ error: 'Failed to generate report summary' });
  }
});

router.get('/time-summary', authenticate, (req: AuthRequest, res) => {
  try {
  const { year, month } = req.query as { year?: string; month?: string };

  const filterConditions: string[] = [];
  const filterParams: (string)[] = [];

  if (year && year !== 'all') {
    const yearNum = parseInt(year, 10);
    // Range-filter så att index kan användas (strftime kan inte)
    filterConditions.push("(te.created_at >= ? AND te.created_at < ?)");
    filterParams.push(`${yearNum}-01-01`, `${yearNum + 1}-01-01`);
  }

  if (month && month !== 'all') {
    const monthNum = parseInt(month, 10);
    const paddedMonth = String(monthNum + 1).padStart(2, '0');
    filterConditions.push("strftime('%m', te.created_at) = ?");
    filterParams.push(paddedMonth);
  }

  const where = filterConditions.length > 0
    ? `WHERE ${filterConditions.join(' AND ')}`
    : '';

  const byCategory = db.prepare(`
    SELECT COALESCE(c.label, 'Okategoriserad') as category,
           COALESCE(SUM(te.duration_minutes), 0) as total_minutes
    FROM time_entries te
    JOIN tickets t ON te.ticket_id = t.id
    LEFT JOIN categories c ON t.category_id = c.id
    ${where}
    GROUP BY t.category_id
    ORDER BY total_minutes DESC
  `).all(...filterParams) as { category: string; total_minutes: number }[];

  const topTickets = db.prepare(`
    SELECT t.id, t.title,
           COALESCE(SUM(te.duration_minutes), 0) as total_minutes
    FROM time_entries te
    JOIN tickets t ON te.ticket_id = t.id
    ${where}
    GROUP BY te.ticket_id
    ORDER BY total_minutes DESC
    LIMIT 10
  `).all(...filterParams) as { id: string; title: string; total_minutes: number }[];

  res.json({ byCategory, topTickets });
  } catch (error) {
    logger.error('Error generating time summary:', { error: String(error) });
    res.status(500).json({ error: 'Failed to generate time summary' });
  }
});

router.get('/requester-analytics', authenticate, (req: AuthRequest, res) => {
  try {
    const { year, month } = req.query as { year?: string; month?: string };

    // Build date filter conditions for tickets.created_at
    const filterConditions: string[] = [];
    const filterParams: string[] = [];

    if (year && year !== 'all') {
      const yearNum = parseInt(year, 10);
      if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
        res.status(400).json({ error: 'Invalid year parameter' });
        return;
      }
      filterConditions.push('(t.created_at >= ? AND t.created_at < ?)');
      filterParams.push(`${yearNum}-01-01`, `${yearNum + 1}-01-01`);
    }

    if (month && month !== 'all') {
      const monthNum = parseInt(month, 10);
      if (isNaN(monthNum) || monthNum < 0 || monthNum > 11) {
        res.status(400).json({ error: 'Invalid month parameter (expected 0-11)' });
        return;
      }
      const paddedMonth = String(monthNum + 1).padStart(2, '0');
      filterConditions.push("strftime('%m', t.created_at) = ?");
      filterParams.push(paddedMonth);
    }

    const whereClause = filterConditions.length > 0
      ? `WHERE ${filterConditions.join(' AND ')}`
      : '';

    // Main aggregation: one row per requester with all needed metrics
    const rows = db.prepare(`
      SELECT
        COALESCE(t.requester_id, 'unassigned')                            AS userId,
        COALESCE(c.name, 'Ej tilldelad')                                  AS name,
        COUNT(*)                                                           AS totalTickets,
        SUM(CASE WHEN t.status = 'open'        THEN 1 ELSE 0 END)        AS statusOpen,
        SUM(CASE WHEN t.status = 'in-progress' THEN 1 ELSE 0 END)        AS statusInProgress,
        SUM(CASE WHEN t.status = 'waiting'     THEN 1 ELSE 0 END)        AS statusWaiting,
        SUM(CASE WHEN t.status = 'resolved'    THEN 1 ELSE 0 END)        AS statusResolved,
        SUM(CASE WHEN t.status = 'closed'      THEN 1 ELSE 0 END)        AS statusClosed,
        SUM(CASE WHEN t.priority = 'low'       THEN 1 ELSE 0 END)        AS priorityLow,
        SUM(CASE WHEN t.priority = 'medium'    THEN 1 ELSE 0 END)        AS priorityMedium,
        SUM(CASE WHEN t.priority = 'high'      THEN 1 ELSE 0 END)        AS priorityHigh,
        SUM(CASE WHEN t.priority = 'critical'  THEN 1 ELSE 0 END)        AS priorityCritical,
        AVG(CASE
          WHEN (t.status = 'resolved' OR t.status = 'closed') AND t.closed_at IS NOT NULL
          THEN CAST((julianday(t.closed_at) - julianday(t.created_at)) AS REAL)
          ELSE NULL
        END)                                                               AS avgResolutionDays,
        SUM(CASE
          WHEN t.status = 'open'
            AND (julianday('now') - julianday(t.created_at)) > 7
          THEN 1 ELSE 0
        END)                                                               AS agingTickets,
        MAX(t.created_at)                                                  AS lastTicketDate,
        MIN(t.created_at)                                                  AS firstTicketDate
      FROM tickets t
      LEFT JOIN contacts c ON t.requester_id = c.id
      ${whereClause}
      GROUP BY COALESCE(t.requester_id, 'unassigned')
      ORDER BY totalTickets DESC
      LIMIT 15
    `).all(...filterParams) as Array<{
      userId: string;
      name: string;
      totalTickets: number;
      statusOpen: number;
      statusInProgress: number;
      statusWaiting: number;
      statusResolved: number;
      statusClosed: number;
      priorityLow: number;
      priorityMedium: number;
      priorityHigh: number;
      priorityCritical: number;
      avgResolutionDays: number | null;
      agingTickets: number;
      lastTicketDate: string;
      firstTicketDate: string;
    }>;

    if (rows.length === 0) {
      res.json([]);
      return;
    }

    // Collect requester IDs for subsequent queries (excluding 'unassigned')
    const requesterIds = rows.map(r => r.userId).filter(id => id !== 'unassigned');

    // Top categories per requester (up to 3 each)
    // Build: Map<userId, Array<{category, count}>>
    const categoryMap = new Map<string, Array<{ category: string; count: number }>>();

    if (requesterIds.length > 0) {
      const placeholders = requesterIds.map(() => '?').join(', ');
      const catFilterConditions = [...filterConditions];
      const catFilterParams = [...filterParams];
      const catWhere = catFilterConditions.length > 0
        ? `WHERE (${catFilterConditions.join(' AND ')}) AND COALESCE(t.requester_id, 'unassigned') IN (${placeholders})`
        : `WHERE COALESCE(t.requester_id, 'unassigned') IN (${placeholders})`;

      const catRows = db.prepare(`
        SELECT
          COALESCE(t.requester_id, 'unassigned') AS userId,
          cat.label                               AS category,
          COUNT(*)                                AS cnt
        FROM tickets t
        JOIN categories cat ON t.category_id = cat.id
        ${catWhere}
        GROUP BY COALESCE(t.requester_id, 'unassigned'), t.category_id
        ORDER BY COALESCE(t.requester_id, 'unassigned'), cnt DESC
      `).all(...catFilterParams, ...requesterIds) as Array<{ userId: string; category: string; cnt: number }>;

      for (const row of catRows) {
        const existing = categoryMap.get(row.userId) ?? [];
        if (existing.length < 3) {
          existing.push({ category: row.category, count: row.cnt });
          categoryMap.set(row.userId, existing);
        }
      }
    }

    // Top tags per requester (up to 3 each)
    const tagMap = new Map<string, Array<{ tag: string; count: number }>>();

    if (requesterIds.length > 0) {
      const placeholders = requesterIds.map(() => '?').join(', ');
      const tagFilterParams = [...filterParams];
      const tagWhere = filterConditions.length > 0
        ? `WHERE (${filterConditions.join(' AND ')}) AND COALESCE(t.requester_id, 'unassigned') IN (${placeholders})`
        : `WHERE COALESCE(t.requester_id, 'unassigned') IN (${placeholders})`;

      const tagRows = db.prepare(`
        SELECT
          COALESCE(t.requester_id, 'unassigned') AS userId,
          tg.name                                 AS tagName,
          COUNT(*)                                AS cnt
        FROM tickets t
        JOIN ticket_tags tt ON tt.ticket_id = t.id
        JOIN tags tg ON tg.id = tt.tag_id
        ${tagWhere}
        GROUP BY COALESCE(t.requester_id, 'unassigned'), tt.tag_id
        ORDER BY COALESCE(t.requester_id, 'unassigned'), cnt DESC
      `).all(...tagFilterParams, ...requesterIds) as Array<{ userId: string; tagName: string; cnt: number }>;

      for (const row of tagRows) {
        const existing = tagMap.get(row.userId) ?? [];
        if (existing.length < 3) {
          existing.push({ tag: row.tagName, count: row.cnt });
          tagMap.set(row.userId, existing);
        }
      }
    }

    const now = new Date();

    const result = rows.map(r => {
      const completedCount = (r.statusResolved ?? 0) + (r.statusClosed ?? 0);
      const completionRate = r.totalTickets > 0 ? (completedCount / r.totalTickets) * 100 : 0;

      // Velocity: tickets per month since first ticket
      const firstDate = r.firstTicketDate ? new Date(r.firstTicketDate) : now;
      const daysSinceFirst = Math.max(1, (now.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
      const monthsActive = daysSinceFirst / 30;
      const ticketVelocity = r.totalTickets / monthsActive;

      return {
        userId: r.userId,
        name: r.name,
        totalTickets: r.totalTickets,
        statusBreakdown: {
          open: r.statusOpen ?? 0,
          'in-progress': r.statusInProgress ?? 0,
          waiting: r.statusWaiting ?? 0,
          resolved: r.statusResolved ?? 0,
          closed: r.statusClosed ?? 0,
        },
        priorityBreakdown: {
          low: r.priorityLow ?? 0,
          medium: r.priorityMedium ?? 0,
          high: r.priorityHigh ?? 0,
          critical: r.priorityCritical ?? 0,
        },
        completionRate,
        avgResolutionTime: r.avgResolutionDays != null
          ? Math.round(r.avgResolutionDays * 10) / 10
          : 0,
        agingTickets: r.agingTickets ?? 0,
        lastTicketDate: r.lastTicketDate,
        ticketVelocity,
        topCategories: categoryMap.get(r.userId) ?? [],
        topTags: tagMap.get(r.userId) ?? [],
      };
    });

    res.json(result);
  } catch (error) {
    logger.error('Error generating requester analytics:', { error: String(error) });
    res.status(500).json({ error: 'Failed to generate requester analytics' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/status-flow
// 12-month per-status series. For each of the last 12 calendar months (by
// created_at), count tickets grouped by their CURRENT status. Mirrors the
// client-side StatusFlowChart aggregation but counts the FULL dataset (no
// 1000-row cap). Returns one row per month keyed by YYYY-MM; the client maps
// the key to a short month label so formatting stays identical.
// ─────────────────────────────────────────────────────────────────────────────
export interface StatusFlowRow {
  month: string; // YYYY-MM
  open: number;
  'in-progress': number;
  waiting: number;
  resolved: number;
  closed: number;
}

// Pure aggregation extracted so it can be unit-tested against an in-memory DB.
// `now` is injectable to keep the 12-month window deterministic in tests.
export function computeStatusFlow(database: AggregationDb = db, now: Date = new Date()): StatusFlowRow[] {
  // Build the 12-month window keyed by YYYY-MM, ending with the current month.
  // We generate the keys in JS so months with zero tickets still appear (the
  // client previously always emitted 12 buckets via subMonths()).
  const buckets: { month: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.push({ month: key });
  }
  const earliestStart = `${buckets[0].month}-01`;

  // Aggregate counts per month + status for tickets created within the window.
  const rows = database.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month,
           SUM(CASE WHEN status = 'open'        THEN 1 ELSE 0 END) AS open,
           SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) AS inProgress,
           SUM(CASE WHEN status = 'waiting'     THEN 1 ELSE 0 END) AS waiting,
           SUM(CASE WHEN status = 'resolved'    THEN 1 ELSE 0 END) AS resolved,
           SUM(CASE WHEN status = 'closed'      THEN 1 ELSE 0 END) AS closed
    FROM tickets
    WHERE created_at >= ?
    GROUP BY month
  `).all(earliestStart) as Array<{
    month: string;
    open: number;
    inProgress: number;
    waiting: number;
    resolved: number;
    closed: number;
  }>;

  const byMonth = new Map(rows.map(r => [r.month, r]));

  return buckets.map(({ month }) => {
    const r = byMonth.get(month);
    return {
      month,
      open: r?.open ?? 0,
      'in-progress': r?.inProgress ?? 0,
      waiting: r?.waiting ?? 0,
      resolved: r?.resolved ?? 0,
      closed: r?.closed ?? 0,
    };
  });
}

router.get('/status-flow', authenticate, (_req: AuthRequest, res) => {
  try {
    res.json(computeStatusFlow());
  } catch (error) {
    logger.error('Error generating status flow:', { error: String(error) });
    res.status(500).json({ error: 'Failed to generate status flow' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/tag-analytics
// Tag-frequency counts across the FULL dataset (no 1000-row cap). Returns one
// row per tag that is attached to at least one ticket, with the canonical tag
// id/name/color and the number of tickets carrying it. Mirrors the client-side
// TagCloud / TagDistributionChart counting.
// ─────────────────────────────────────────────────────────────────────────────
export interface TagAnalyticsRow {
  id: string;
  name: string;
  color: string;
  count: number;
}

// Pure aggregation extracted so it can be unit-tested against an in-memory DB.
export function computeTagAnalytics(database: AggregationDb = db): TagAnalyticsRow[] {
  return database.prepare(`
    SELECT tg.id    AS id,
           tg.name  AS name,
           tg.color AS color,
           COUNT(tt.ticket_id) AS count
    FROM tags tg
    JOIN ticket_tags tt ON tt.tag_id = tg.id
    GROUP BY tg.id
    ORDER BY count DESC, tg.name ASC
  `).all() as TagAnalyticsRow[];
}

router.get('/tag-analytics', authenticate, (_req: AuthRequest, res) => {
  try {
    res.json(computeTagAnalytics());
  } catch (error) {
    logger.error('Error generating tag analytics:', { error: String(error) });
    res.status(500).json({ error: 'Failed to generate tag analytics' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /reports/kpi-tickets
// Server-aggregated drill-down rows for the KPI detail modals on the Reports
// page. Replaces a client-side ?limit=1000 fetch + in-memory filtering. Returns
// raw TicketRow shape (snake_case) — exactly what mapTicketRow() consumes — so
// the modal keeps every column/badge (assigned_to_name, all SLA fields, tags[]).
//   scope=total → created_at filtered by year/month (same range-filter as
//                 /summary so idx_tickets_created_at applies, strftime for month).
//   scope=aging → open tickets older than 7 days, ALWAYS unfiltered by year/month
//                 (mirrors summary.agingTickets). Capped at LIMIT 200 — the modal
//                 is an overview, full extraction goes through Export Excel.
// ─────────────────────────────────────────────────────────────────────────────

// Column list identical to tickets.ts TICKET_COLUMNS — keep in sync, otherwise
// the modal loses assigned_to_name (Tilldelad) or SLA badges. assigned_to_name
// is a correlated subquery (not a JOIN) so non-admins can render it too.
const KPI_TICKET_COLUMNS = [
  'tickets.id', 'tickets.title', 'tickets.description', 'tickets.status', 'tickets.priority',
  'tickets.category_id', 'tickets.requester_id', 'tickets.company_id', 'tickets.assigned_to',
  '(SELECT COALESCE(display_name, email) FROM users WHERE id = tickets.assigned_to) AS assigned_to_name',
  'tickets.notes', 'tickets.solution', 'tickets.template_id',
  'tickets.created_at', 'tickets.updated_at', 'tickets.resolved_at', 'tickets.closed_at',
  'tickets.ai_suggested_category_id', 'tickets.ai_suggested_confidence',
  'tickets.sla_response_deadline', 'tickets.sla_resolution_deadline',
  'tickets.sla_response_met', 'tickets.sla_resolution_met',
  'tickets.sla_paused_at', 'tickets.sla_paused_duration',
].join(', ');

const KPI_TICKET_LIMIT = 200;

// Pure aggregation extracted so it can be unit-tested against an in-memory DB.
// Throws on invalid year/month so the route can map them to a 400.
export function computeKpiTickets(
  database: AggregationDb = db,
  scope: 'total' | 'aging',
  filters: { year?: string; month?: string } = {},
): Record<string, unknown>[] {
  let where: string;
  const params: string[] = [];

  if (scope === 'aging') {
    // Mirror summary.agingTickets — ALWAYS unfiltered by year/month.
    where = "WHERE status = 'open' AND julianday('now') - julianday(created_at) > 7";
  } else {
    const conds: string[] = [];
    if (filters.year && filters.year !== 'all') {
      const yearNum = parseInt(filters.year, 10);
      if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) throw new Error('Invalid year parameter');
      // Range-filter så att idx_tickets_created_at kan användas (strftime kan inte)
      conds.push('(created_at >= ? AND created_at < ?)');
      params.push(`${yearNum}-01-01`, `${yearNum + 1}-01-01`);
    }
    if (filters.month && filters.month !== 'all') {
      // Frontend sends 0-based month index (0=Jan, 11=Dec); strftime('%m') is 1-based.
      const monthNum = parseInt(filters.month, 10);
      if (isNaN(monthNum) || monthNum < 0 || monthNum > 11) throw new Error('Invalid month parameter (expected 0-11)');
      conds.push("strftime('%m', created_at) = ?");
      params.push(String(monthNum + 1).padStart(2, '0'));
    }
    where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  }

  const tickets = database.prepare(`
    SELECT ${KPI_TICKET_COLUMNS}
    FROM tickets
    ${where}
    ORDER BY created_at DESC
    LIMIT ${KPI_TICKET_LIMIT}
  `).all(...params) as Array<{ id: string } & Record<string, unknown>>;

  if (tickets.length === 0) return [];

  // Batch-fetch tags for all returned tickets (same pattern as tickets.ts GET /).
  const ticketIds = tickets.map(t => t.id);
  const placeholders = ticketIds.map(() => '?').join(',');
  const tagRows = database.prepare(`
    SELECT tt.ticket_id, t.id, t.name, t.color
    FROM tags t
    JOIN ticket_tags tt ON t.id = tt.tag_id
    WHERE tt.ticket_id IN (${placeholders})
    ORDER BY t.name
  `).all(...ticketIds) as Array<{ ticket_id: string; id: string; name: string; color: string }>;

  const tagsByTicket: Record<string, Array<{ id: string; name: string; color: string }>> = {};
  for (const row of tagRows) {
    (tagsByTicket[row.ticket_id] ??= []).push({ id: row.id, name: row.name, color: row.color });
  }

  return tickets.map(t => ({ ...t, tags: tagsByTicket[t.id] ?? [] }));
}

router.get('/kpi-tickets', authenticate, (req: AuthRequest, res) => {
  try {
    const { scope, year, month } = req.query as { scope?: string; year?: string; month?: string };
    if (scope !== 'total' && scope !== 'aging') {
      res.status(400).json({ error: 'Invalid scope (expected total|aging)' });
      return;
    }
    res.json(computeKpiTickets(db, scope, { year, month }));
  } catch (error) {
    const msg = String(error);
    if (msg.includes('Invalid year') || msg.includes('Invalid month')) {
      res.status(400).json({ error: msg.replace('Error: ', '') });
      return;
    }
    logger.error('Error generating KPI tickets:', { error: msg });
    res.status(500).json({ error: 'Failed to generate KPI tickets' });
  }
});

export default router;
