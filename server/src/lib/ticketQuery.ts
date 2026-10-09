// Pure query-building helpers for the tickets routes.
// Extracted verbatim from routes/tickets.ts (item M-cq3) so they can be
// unit-tested in isolation. These functions have no side effects and do not
// touch the database — they only build SQL fragments and bound params.

// Giltiga enum-värden för status och prioritet
export const VALID_STATUSES = ['open', 'in-progress', 'waiting', 'resolved', 'closed'];
export const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// Express ger en array (?status=a&status=b) eller ett objekt (?status[x]=1) när en
// parameter upprepas eller har hakparenteser — det typas som string men är det inte.
type QueryValue = string | string[] | undefined;

export interface TicketQueryParams {
  page?: QueryValue;
  limit?: QueryValue;
  status?: QueryValue;
  priority?: QueryValue;
  category?: QueryValue;
  company_id?: QueryValue;
  assigned_to?: QueryValue;
  requester_id?: QueryValue;
  search?: QueryValue;
  tags?: QueryValue;
  tagMode?: QueryValue;
  dateFrom?: QueryValue;
  dateTo?: QueryValue;
  dateField?: QueryValue;
  checklist?: QueryValue;
  sortBy?: QueryValue;
  sortDir?: QueryValue;
  year?: QueryValue;
  month?: QueryValue;
}

// En sträng behålls, en array ger sitt första strängelement, allt annat ignoreras.
function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

// Datumgränser jämförs som 'YYYY-MM-DD'-text mot created_at. Både ISO
// ('2026-10-01T08:00:00.000Z') och SQLites CURRENT_TIMESTAMP ('2026-10-01 08:00:00')
// börjar med datumet, så >= dag och < nästa dag träffar båda och index kan användas.
// Ogiltigt eller icke-kanoniskt datum (t.ex. '2026-02-31', '2026-1-1') ger null.
function addDays(date: string, days: number): string | null {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

// Helper: Validate pagination params
export function validatePaginationParams(query: TicketQueryParams) {
  const page = Math.max(1, parseInt(asString(query.page) || '1'));
  const allowedLimits = [10, 20, 25, 30, 50, 100, 1000];
  const limitParam = asString(query.limit);
  const limit = allowedLimits.includes(parseInt(limitParam || '10'))
    ? parseInt(limitParam!)
    : 10;
  const sortByParam = asString(query.sortBy) || '';
  const sortBy = ['createdAt', 'status', 'priority', 'category'].includes(sortByParam)
    ? sortByParam
    : 'createdAt';
  const sortDir = asString(query.sortDir) === 'asc' ? 'asc' : 'desc';

  return { page, limit, sortBy, sortDir };
}

// Helper: Build WHERE clause with JOINs for enhanced search
export function buildWhereClause(rawFilters: TicketQueryParams) {
  const filters = Object.fromEntries(
    Object.entries(rawFilters).map(([key, value]) => [key, asString(value)])
  ) as Record<keyof TicketQueryParams, string | undefined>;
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let joins = '';

  // Handle status filter - support both single and multi-status
  if (filters.status && filters.status !== 'all') {
    // Check if comma-separated list (multi-status)
    const statusList = filters.status.split(',').map(s => s.trim()).filter(s => s);

    if (statusList.length > 1) {
      // Multi-status: filtrera bort ogiltiga värden och använd IN-klausul
      const validStatuses = statusList.filter(s => VALID_STATUSES.includes(s));
      if (validStatuses.length === 0) {
        // Inga giltiga statusvärden — returnera inget resultat
        conditions.push('1 = 0');
      } else {
        const placeholders = validStatuses.map(() => '?').join(',');
        conditions.push(`tickets.status IN (${placeholders})`);
        params.push(...validStatuses);
      }
    } else {
      // Single status
      conditions.push('tickets.status = ?');
      params.push(filters.status);
    }
  } else if (!filters.status) {
    // Default behavior: exclude closed tickets if no status specified
    conditions.push("tickets.status != 'closed'");
  }

  if (filters.priority && filters.priority !== 'all') {
    conditions.push('tickets.priority = ?');
    params.push(filters.priority);
  }

  if (filters.category && filters.category !== 'all') {
    conditions.push('tickets.category_id = ?');
    params.push(filters.category);
  }

  // Company filter
  if (filters.company_id && filters.company_id !== 'all') {
    conditions.push('tickets.company_id = ?');
    params.push(filters.company_id);
  }

  // Assignee filter
  if (filters.assigned_to && filters.assigned_to !== 'all') {
    conditions.push('tickets.assigned_to = ?');
    params.push(filters.assigned_to);
  }

  // Requester filter (server-side → UserTicketHistory slipper ladda hela listan)
  if (filters.requester_id && filters.requester_id !== 'all') {
    conditions.push('tickets.requester_id = ?');
    params.push(filters.requester_id);
  }

  // Legacy tags/tagMode query parameters are ignored after ticket tags were retired.

  // Date range filtering
  const allowedDateFields = ['created_at', 'updated_at', 'closed_at'];
  const dateField = allowedDateFields.includes(filters.dateField || '') ? filters.dateField! : 'created_at';
  const dateFrom = filters.dateFrom ? addDays(filters.dateFrom, 0) : null;
  if (dateFrom) {
    conditions.push(`tickets.${dateField} >= ?`);
    params.push(dateFrom);
  }
  const dayAfterDateTo = filters.dateTo ? addDays(filters.dateTo, 1) : null;
  if (dayAfterDateTo) {
    conditions.push(`tickets.${dateField} < ?`);
    params.push(dayAfterDateTo);
  }

  // Year/month filtering (used by Reports page). Intervall i stället för
  // strftime() så idx_tickets_created_at kan användas.
  if (filters.year && filters.year !== 'all') {
    if (/^\d{4}$/.test(filters.year)) {
      const yearNum = parseInt(filters.year, 10);
      let from = `${filters.year}-01-01`;
      let to = `${yearNum + 1}-01-01`;

      const monthNum = filters.month && filters.month !== 'all' ? parseInt(filters.month, 10) : NaN;
      if (monthNum >= 0 && monthNum <= 11) {
        from = `${filters.year}-${String(monthNum + 1).padStart(2, '0')}-01`;
        to = monthNum === 11
          ? `${yearNum + 1}-01-01`
          : `${filters.year}-${String(monthNum + 2).padStart(2, '0')}-01`;
      }
      conditions.push('(tickets.created_at >= ? AND tickets.created_at < ?)');
      params.push(from, to);
    } else {
      conditions.push('1 = 0');
    }
  }

  // Checklist completion filtering
  if (filters.checklist) {
    switch (filters.checklist) {
      case 'all_done':
        // Has items AND all are completed
        conditions.push(`(SELECT COUNT(*) FROM ticket_checklists WHERE ticket_checklists.ticket_id = tickets.id) > 0`);
        conditions.push(`(SELECT COUNT(*) FROM ticket_checklists WHERE ticket_checklists.ticket_id = tickets.id AND ticket_checklists.completed = 0) = 0`);
        break;
      case 'none_done':
        // Has items AND none are completed
        conditions.push(`(SELECT COUNT(*) FROM ticket_checklists WHERE ticket_checklists.ticket_id = tickets.id) > 0`);
        conditions.push(`(SELECT COUNT(*) FROM ticket_checklists WHERE ticket_checklists.ticket_id = tickets.id AND ticket_checklists.completed = 1) = 0`);
        break;
      case 'some_done':
        // Has at least one done AND at least one not done
        conditions.push(`(SELECT COUNT(*) FROM ticket_checklists WHERE ticket_checklists.ticket_id = tickets.id AND ticket_checklists.completed = 1) > 0`);
        conditions.push(`(SELECT COUNT(*) FROM ticket_checklists WHERE ticket_checklists.ticket_id = tickets.id AND ticket_checklists.completed = 0) > 0`);
        break;
      case 'has_any':
        // Has any checklist items
        conditions.push(`(SELECT COUNT(*) FROM ticket_checklists WHERE ticket_checklists.ticket_id = tickets.id) > 0`);
        break;
      case 'no_items':
        // Has no checklist items
        conditions.push(`(SELECT COUNT(*) FROM ticket_checklists WHERE ticket_checklists.ticket_id = tickets.id) = 0`);
        break;
    }
  }

  // Enhanced search: FTS5 fulltext on ticket content + LIKE fallback for relations
  if (filters.search) {
    // Escape FTS5 special characters for safe MATCH queries
    const ftsSearch = filters.search
      .replace(/["""]/g, '') // ta bort citattecken
      .replace(/[*^(){}[\]:!]/g, '') // ta bort FTS-operatorer
      .trim();

    // Escape LIKE special characters for relation field fallback
    const escapedSearch = filters.search
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    const pattern = `%${escapedSearch}%`;

    if (ftsSearch) {
      // FTS5 MATCH for ticket content (title, description, notes, solution)
      // + LIKE fallback for relation fields (contacts, categories, comments, custom fields)
      const ftsCondition = `tickets.rowid IN (SELECT rowid FROM tickets_fts WHERE tickets_fts MATCH ?)`;
      const relationConditions = [
        "contacts.name LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "contacts.email LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "categories.label LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "ticket_comments.content LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "ticket_field_values.field_value LIKE ? ESCAPE '\\' COLLATE NOCASE"
      ];

      conditions.push(`(${ftsCondition} OR ${relationConditions.join(' OR ')})`);

      // FTS5 MATCH-term (prefix-sökning med *)
      params.push(ftsSearch.split(/\s+/).map(w => `"${w}"*`).join(' '));
      // LIKE-parametrar för relationsfält (5 st)
      for (let i = 0; i < 5; i++) {
        params.push(pattern);
      }
    } else {
      // Tomt efter sanering -- fallback till enbart LIKE
      const likeConditions = [
        "contacts.name LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "contacts.email LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "categories.label LIKE ? ESCAPE '\\' COLLATE NOCASE",
      ];
      conditions.push(`(${likeConditions.join(' OR ')})`);
      for (let i = 0; i < 3; i++) {
        params.push(pattern);
      }
    }

    // JOINs for relation field search (FTS handles ticket content without JOIN)
    joins = `
      LEFT JOIN contacts ON tickets.requester_id = contacts.id
      LEFT JOIN categories ON tickets.category_id = categories.id
      LEFT JOIN ticket_comments ON tickets.id = ticket_comments.ticket_id
      LEFT JOIN ticket_field_values ON tickets.id = ticket_field_values.ticket_id
    `;
  }

  // If no conditions, return '1=1' to make valid SQL
  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  return { whereClause, params, joins };
}

// Helper: Build ORDER BY clause
// tickets.id sist som tiebreaker: utan den är ordningen för lika värden ospecificerad
// och sidor kan överlappa eller tappa rader mellan två LIMIT/OFFSET-anrop.
export function buildOrderByClause(sortBy: string, sortDir: string) {
  const dir = sortDir.toUpperCase();

  switch (sortBy) {
    case 'status':
      return `CASE tickets.status
        WHEN 'open' THEN 0
        WHEN 'in-progress' THEN 1
        WHEN 'waiting' THEN 2
        WHEN 'resolved' THEN 3
        WHEN 'closed' THEN 4
      END ${dir}, tickets.id`;
    case 'priority':
      return `CASE tickets.priority
        WHEN 'low' THEN 0
        WHEN 'medium' THEN 1
        WHEN 'high' THEN 2
        WHEN 'critical' THEN 3
      END ${dir}, tickets.id`;
    case 'category':
      return `tickets.category_id ${dir}, tickets.id`;
    default:
      return `tickets.created_at ${dir}, tickets.id`;
  }
}
