import { Router } from 'express';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.get('/summary', authenticate, (req: AuthRequest, res) => {
  const { year, month } = req.query as { year?: string; month?: string };

  // Build filter conditions for created_at
  const filterConditions: string[] = [];
  const filterParams: string[] = [];

  if (year && year !== 'all') {
    filterConditions.push("strftime('%Y', created_at) = ?");
    filterParams.push(year);
  }

  if (month && month !== 'all') {
    // Zero-pad the month param (e.g. "3" -> "03")
    const paddedMonth = String(parseInt(month, 10)).padStart(2, '0');
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

  // 3. Trend — two separate queries merged via Map (avoids SQLite FULL OUTER JOIN limitation)
  let trendWhereCreated: string;
  let trendWhereClosed: string;
  let trendParams: string[];
  let trendClosedParams: string[];

  if (year && year !== 'all') {
    trendWhereCreated = "WHERE strftime('%Y', created_at) = ?";
    trendWhereClosed = "WHERE closed_at IS NOT NULL AND strftime('%Y', closed_at) = ?";
    trendParams = [year];
    trendClosedParams = [year];
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
    trend,
    avgResolutionDays,
    agingTickets,
  });
});

export default router;
