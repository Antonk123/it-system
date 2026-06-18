// Pure query-building helpers for the tickets routes.
// Extracted verbatim from routes/tickets.ts (item M-cq3) so they can be
// unit-tested in isolation. These functions have no side effects and do not
// touch the database — they only build SQL fragments and bound params.

// Giltiga enum-värden för status och prioritet
export const VALID_STATUSES = ['open', 'in-progress', 'waiting', 'resolved', 'closed'];
export const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

export interface TicketQueryParams {
  page?: string;
  limit?: string;
  status?: string;
  priority?: string;
  category?: string;
  company_id?: string;
  assigned_to?: string;
  requester_id?: string;
  search?: string;
  tags?: string;
  tagMode?: string;
  dateFrom?: string;
  dateTo?: string;
  dateField?: string;
  checklist?: string;
  sortBy?: string;
  sortDir?: string;
  year?: string;
  month?: string;
}

// Helper: Validate pagination params
export function validatePaginationParams(query: TicketQueryParams) {
  const page = Math.max(1, parseInt(query.page || '1'));
  const allowedLimits = [10, 20, 25, 50, 100, 1000];
  const limit = allowedLimits.includes(parseInt(query.limit || '10'))
    ? parseInt(query.limit!)
    : 10;
  const sortBy = ['createdAt', 'status', 'priority', 'category', 'tags'].includes(query.sortBy || '')
    ? query.sortBy!
    : 'createdAt';
  const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';

  return { page, limit, sortBy, sortDir };
}

// Helper: Build WHERE clause with JOINs for enhanced search
export function buildWhereClause(filters: TicketQueryParams) {
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

  // Tag filtering (OR or AND logic for multiple tags)
  if (filters.tags) {
    const tagIds = filters.tags.split(',').map(id => id.trim()).filter(id => id.length > 0);
    if (tagIds.length > 0) {
      const tagPlaceholders = tagIds.map(() => '?').join(',');
      if (filters.tagMode === 'and' && tagIds.length > 1) {
        // AND logic: ticket must have ALL specified tags
        conditions.push(`(
          SELECT COUNT(DISTINCT tag_id) FROM ticket_tags
          WHERE ticket_tags.ticket_id = tickets.id
          AND ticket_tags.tag_id IN (${tagPlaceholders})
        ) = ${tagIds.length}`);
      } else {
        // OR logic (default): ticket has ANY of the specified tags
        conditions.push(`EXISTS (
          SELECT 1 FROM ticket_tags
          WHERE ticket_tags.ticket_id = tickets.id
          AND ticket_tags.tag_id IN (${tagPlaceholders})
        )`);
      }
      params.push(...tagIds);
    }
  }

  // Date range filtering
  const allowedDateFields = ['created_at', 'updated_at', 'closed_at'];
  const dateField = allowedDateFields.includes(filters.dateField || '') ? filters.dateField! : 'created_at';
  if (filters.dateFrom) {
    conditions.push(`tickets.${dateField} >= ?`);
    params.push(filters.dateFrom + 'T00:00:00.000Z');
  }
  if (filters.dateTo) {
    conditions.push(`tickets.${dateField} <= ?`);
    params.push(filters.dateTo + 'T23:59:59.999Z');
  }

  // Year/month filtering (used by Reports page)
  if (filters.year && filters.year !== 'all') {
    conditions.push("strftime('%Y', tickets.created_at) = ?");
    params.push(filters.year);

    if (filters.month && filters.month !== 'all') {
      const monthNum = parseInt(filters.month, 10);
      if (!isNaN(monthNum) && monthNum >= 0 && monthNum <= 11) {
        const paddedMonth = String(monthNum + 1).padStart(2, '0');
        conditions.push("strftime('%m', tickets.created_at) = ?");
        params.push(paddedMonth);
      }
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
      // + LIKE fallback for relation fields (contacts, categories, comments, tags, custom fields)
      const ftsCondition = `tickets.rowid IN (SELECT rowid FROM tickets_fts WHERE tickets_fts MATCH ?)`;
      const relationConditions = [
        "contacts.name LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "contacts.email LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "categories.label LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "ticket_comments.content LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "tags.name LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "ticket_field_values.field_value LIKE ? ESCAPE '\\' COLLATE NOCASE"
      ];

      conditions.push(`(${ftsCondition} OR ${relationConditions.join(' OR ')})`);

      // FTS5 MATCH-term (prefix-sökning med *)
      params.push(ftsSearch.split(/\s+/).map(w => `"${w}"*`).join(' '));
      // LIKE-parametrar för relationsfält (6 st)
      for (let i = 0; i < 6; i++) {
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
      LEFT JOIN ticket_tags ON tickets.id = ticket_tags.ticket_id
      LEFT JOIN tags ON ticket_tags.tag_id = tags.id
      LEFT JOIN ticket_field_values ON tickets.id = ticket_field_values.ticket_id
    `;
  }

  // If no conditions, return '1=1' to make valid SQL
  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  return { whereClause, params, joins };
}

// Helper: Build ORDER BY clause
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
      END ${dir}`;
    case 'priority':
      return `CASE tickets.priority
        WHEN 'low' THEN 0
        WHEN 'medium' THEN 1
        WHEN 'high' THEN 2
        WHEN 'critical' THEN 3
      END ${dir}`;
    case 'category':
      return `tickets.category_id ${dir}`;
    case 'tags':
      return `(
        SELECT MIN(tags.name) COLLATE NOCASE
        FROM tags
        JOIN ticket_tags ON tags.id = ticket_tags.tag_id
        WHERE ticket_tags.ticket_id = tickets.id
      ) ${dir}`;
    default:
      return `tickets.created_at ${dir}`;
  }
}
