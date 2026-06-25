import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { db } from '../db/connection.js';
import { sendTicketClosedEmail, sendTicketCreatedEmail, sendTicketAssignedEmail } from '../lib/email.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { canAccessTicket } from '../lib/ticketAccess.js';
import { applyAutoTags, detectAutoPriority } from '../lib/automationHelper.js';
import { applySLAToTicket, handleSLAStatusChange } from '../lib/slaHelper.js';
import { writeRateLimiter, createRateLimiter } from '../middleware/rateLimit.js';

const aiRateLimiter = createRateLimiter(60 * 1000, 5);
import { dispatchWebhook } from '../lib/webhookDispatcher.js';
import { aiEnabled, suggestCategory, draftReply, summarizeTicket, buildKbSearchQuery } from '../lib/aiHelper.js';
import { stripHtml } from '../lib/htmlUtils.js';
import { sanitizeRichText, sanitizePlainText } from '../lib/htmlSanitizer.js';
import { logger } from '../lib/logger.js';
import {
  VALID_STATUSES,
  VALID_PRIORITIES,
  TicketQueryParams,
  validatePaginationParams,
  buildWhereClause,
  buildOrderByClause,
} from '../lib/ticketQuery.js';
import {
  TicketRow,
  CategoryLookup,
  ContactLookup,
  generateXLSX,
  parseCSV,
  validateTicketRow,
} from '../lib/ticketImportExport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

// Explicit column lists for SELECT optimization (instead of SELECT *)
// Reduces data transfer by 30-40% by avoiding unnecessary columns
// Use 'tickets.' prefix for all columns to avoid ambiguity when JOINs are present.
// assigned_to_name is a correlated subquery so non-admins can render the assignee
// display-name without needing access to the admin-only GET /api/users endpoint.
//
// PERF NOTE (audit #4 — intentionally NOT converted to a LEFT JOIN): this string
// is a shared column-list reused across 9 query sites with differing FROM clauses.
// Several sites append dynamic `joins` from buildWhereClause() (ticketQuery.ts) and
// rely on SELECT DISTINCT to dedupe tag-join row multiplication. A column-list
// constant cannot itself carry a JOIN, so converting would require threading
// `LEFT JOIN users` into every FROM clause here AND coordinating with the joins
// emitted by buildWhereClause() in another file. That breadth/regression risk
// outweighs the perf gain of a single per-row subquery, so it is left as-is.
const TICKET_COLUMNS = [
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

// Multer config for CSV upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

const router = Router();

interface TagRow {
  id: string;
  name: string;
  color: string;
  created_at: string;
  ticket_id?: string;
}

interface CustomFieldInput {
  fieldName: string;
  fieldLabel: string;
  fieldValue?: string;
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Get all tickets
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const query = req.query as TicketQueryParams;
    const countOnly = req.query.countOnly === 'true';

    // Check if pagination is requested
    const usePagination = query.page || query.limit;

    if (!usePagination && !countOnly) {
      // BACKWARD COMPATIBILITY: Return old format (capped at 1000)
      const tickets = db.prepare(`
        SELECT ${TICKET_COLUMNS} FROM tickets ORDER BY created_at DESC LIMIT 1000
      `).all() as TicketRow[];
      return res.json(tickets);
    }

    // NEW: Paginated response (also used for countOnly)
    const { page, limit, sortBy, sortDir } = validatePaginationParams(query);
    const { whereClause, params, joins } = buildWhereClause(query);
    const orderByClause = buildOrderByClause(sortBy, sortDir);

    // Get total count (use DISTINCT if search has JOINs to avoid duplicates)
    const countQuery = joins
      ? `SELECT COUNT(DISTINCT tickets.id) as total FROM tickets ${joins} WHERE ${whereClause}`
      : `SELECT COUNT(*) as total FROM tickets WHERE ${whereClause}`;

    const countResult = db.prepare(countQuery).get(...params) as { total: number };
    const total = countResult.total;

    // countOnly: skip the expensive ticket fetch and return just the count
    if (countOnly) {
      return res.json({ count: total });
    }

    // Get paginated data (use DISTINCT if search has JOINs to avoid duplicates)
    const selectClause = joins ? `SELECT DISTINCT ${TICKET_COLUMNS}` : `SELECT ${TICKET_COLUMNS}`;
    const fromClause = joins ? `FROM tickets ${joins}` : 'FROM tickets';

    const offset = (page - 1) * limit;
    const tickets = db.prepare(`
      ${selectClause}
      ${fromClause}
      WHERE ${whereClause}
      ORDER BY ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as TicketRow[];

    // Fetch tags for all tickets in a single query (fixes N+1 problem)
    let ticketsWithTags: (TicketRow & { tags: { id: string; name: string; color: string; createdAt: Date }[] })[];

    if (tickets.length > 0) {
      const ticketIds = tickets.map(t => t.id);
      const placeholders = ticketIds.map(() => '?').join(',');

      // Single query to fetch all tags for all tickets
      const allTags = db.prepare(`
        SELECT tt.ticket_id, t.id, t.name, t.color, t.created_at
        FROM tags t
        JOIN ticket_tags tt ON t.id = tt.tag_id
        WHERE tt.ticket_id IN (${placeholders})
        ORDER BY t.name
      `).all(...ticketIds) as (TagRow & { ticket_id: string })[];

      // Group tags by ticket_id in memory
      const tagsByTicket: Record<string, { id: string; name: string; color: string; createdAt: Date }[]> = {};
      allTags.forEach((tag) => {
        if (!tagsByTicket[tag.ticket_id]) {
          tagsByTicket[tag.ticket_id] = [];
        }
        tagsByTicket[tag.ticket_id].push({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          createdAt: new Date(tag.created_at),
        });
      });

      // Attach tags to tickets
      ticketsWithTags = tickets.map((ticket) => ({
        ...ticket,
        tags: tagsByTicket[ticket.id] || [],
      }));
    } else {
      ticketsWithTags = [];
    }

    // Build pagination metadata
    const totalPages = Math.ceil(total / limit);
    const paginatedResponse: PaginatedResponse<TicketRow & { tags: { id: string; name: string; color: string; createdAt: Date }[] }> = {
      data: ticketsWithTags,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };

    res.json(paginatedResponse);
  } catch (error) {
    logger.error('Error fetching tickets:', { error: String(error) });
    if (error instanceof Error) {
      logger.error('Ticket query details', { query: JSON.stringify(req.query), message: error.message, stack: error.stack });
    }
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// Import tickets - Preview
router.post('/import/preview', authenticate, requireAdmin, upload.single('file'), (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const rows = parseCSV(csvContent);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty or invalid' });
    }

    // Get categories and existing ticket IDs
    const categories = db.prepare('SELECT id, label FROM categories').all();
    const existingTickets = db.prepare('SELECT id FROM tickets').all() as { id: string }[];
    const existingTicketIds = new Set(existingTickets.map(t => t.id));

    // Validate each row
    const results = rows.map((row, index) => {
      return validateTicketRow(row, index, categories, existingTicketIds);
    });

    const valid = results.filter(r => r.valid);
    const invalid = results.filter(r => !r.valid);
    const duplicates = results.filter(r => r.isDuplicate);

    res.json({
      total: rows.length,
      valid: valid.length,
      invalid: invalid.length,
      duplicates: duplicates.length,
      results,
    });
  } catch (error) {
    logger.error('Error previewing import:', { error: String(error) });
    res.status(500).json({ error: 'Failed to preview import' });
  }
});

// Import tickets - Confirm
router.post('/import/confirm', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { tickets } = req.body;

    if (!Array.isArray(tickets) || tickets.length === 0) {
      return res.status(400).json({ error: 'No tickets provided' });
    }

    // Get categories and contacts for lookup
    const categories = db.prepare('SELECT id, label FROM categories').all();
    // Case-insensitive category map
    const categoryMap = new Map((categories as CategoryLookup[]).map((c) => [c.label.toLowerCase(), c.id]));

    const contacts = db.prepare('SELECT id, name, email FROM contacts').all() as ContactLookup[];
    // Case-insensitive contact maps
    const contactByNameMap = new Map(contacts.map((c) => [c.name.toLowerCase(), c.id]));
    const contactByEmailMap = new Map(contacts.map((c) => [c.email.toLowerCase(), c.id]));

    const stmt = db.prepare(`
      INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, notes, solution, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const importedBy = req.user!.id;

    const contactStmt = db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)');

    // Use transaction for bulk insert - all-or-nothing approach
    // If ANY ticket fails, the entire transaction rolls back
    const insertMany = db.transaction((ticketList: any[]) => {
      let created = 0;

      for (const ticket of ticketList) {
        const id = uuidv4(); // Always generate new ID

        // Case-insensitive category lookup
        const categoryId = ticket.category && ticket.category.trim()
          ? categoryMap.get(ticket.category.toLowerCase()) || null
          : null;

        // Try to find or create contact
        let requesterId = null;
        if (ticket.requester_name || ticket.requester_email) {
          // Case-insensitive contact lookup
          requesterId = (ticket.requester_name ? contactByNameMap.get(ticket.requester_name.toLowerCase()) : null) ||
                       (ticket.requester_email ? contactByEmailMap.get(ticket.requester_email.toLowerCase()) : null) ||
                       null;

          // If contact doesn't exist and we have both name and email, create it
          if (!requesterId && ticket.requester_name && ticket.requester_email) {
            const newContactId = uuidv4();
            contactStmt.run(newContactId, ticket.requester_name.trim(), ticket.requester_email.trim());
            requesterId = newContactId;
          }
        }

        // Insert ticket - will throw error if validation fails, causing rollback
        stmt.run(
          id,
          ticket.title,
          ticket.description,
          ticket.status || 'open',
          ticket.priority || 'medium',
          categoryId,
          requesterId,
          ticket.notes || null,
          ticket.solution || null,
          importedBy
        );

        // FTS5 synkas automatiskt via triggers (migration 050)
        created++;
      }

      return created;
    });

    // Execute transaction - handle errors outside
    try {
      const created = insertMany(tickets);

      res.json({
        success: true,
        created,
        failed: 0,
        errors: [],
      });
    } catch (error) {
      // Transaction failed and rolled back - no partial data
      logger.error('Transaction failed, all changes rolled back:', { error: String(error) });

      res.status(400).json({
        success: false,
        created: 0,
        failed: tickets.length,
        error: 'Import misslyckades, kontrollera data och försök igen',
        message: 'CSV import failed. All changes have been rolled back. Please fix the errors and try again.',
      });
    }
  } catch (error) {
    logger.error('Error confirming import:', { error: String(error) });
    res.status(500).json({ error: 'Failed to import tickets' });
  }
});

// Export tickets to XLSX
router.get('/export', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const query = req.query as TicketQueryParams;

    // Build WHERE clause from filters
    const { whereClause, params, joins } = buildWhereClause(query);

    // Pagination for export — default 10000, max 50000.
    // INTENTIONALLY MINIMAL (audit #5): the result set is buffered fully in memory
    // via generateXLSX before sending. The 50000 cap bounds memory/time; a true
    // streaming rewrite (e.g. ExcelJS streaming workbook + chunked DB cursor) was
    // deemed too risky to change here and is left as-is. `offset` allows callers
    // to page through larger sets across multiple requests if ever needed.
    const MAX_EXPORT_LIMIT = 50000;
    const DEFAULT_EXPORT_LIMIT = 10000;
    const rawLimit = parseInt(String(req.query.limit || ''), 10);
    const exportLimit = (!rawLimit || rawLimit <= 0) ? DEFAULT_EXPORT_LIMIT : Math.min(rawLimit, MAX_EXPORT_LIMIT);
    const rawOffset = parseInt(String(req.query.offset || ''), 10);
    const exportOffset = (!rawOffset || rawOffset < 0) ? 0 : rawOffset;

    const tickets = db.prepare(`
      SELECT DISTINCT ${TICKET_COLUMNS} FROM tickets ${joins}
      WHERE ${whereClause}
      ORDER BY tickets.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, exportLimit, exportOffset) as TicketRow[];

    // Get all categories for lookup
    const categories = db.prepare('SELECT id, label FROM categories').all() as CategoryLookup[];

    // Get all contacts for lookup
    const contacts = db.prepare('SELECT id, name, email FROM contacts').all() as ContactLookup[];

    const xlsxBuffer = await generateXLSX(tickets, categories, contacts);

    const timestamp = new Date().toISOString().split('T')[0];
    const source = req.query.source as string | undefined;
    const parts: string[] = [source === 'rapport' ? 'rapport-arenden' : 'arenden'];
    if (query.status) parts.push(String(query.status).replace(/,/g, '-'));
    if (query.priority) parts.push(String(query.priority));
    if (query.category && query.category !== 'all') parts.push(String(query.category).replace(/\s+/g, '-'));
    if (query.year) {
      parts.push(String(query.year));
      if (query.month) {
        const monthNames = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
        const mi = parseInt(String(query.month), 10);
        if (!isNaN(mi) && mi >= 0 && mi <= 11) parts.push(monthNames[mi]);
      }
    }
    if (query.search) parts.push('sok');
    parts.push(timestamp);
    const filename = `${parts.join('-')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xlsxBuffer);
  } catch (error) {
    logger.error('Error exporting tickets:', { error: String(error) });
    res.status(500).json({ error: 'Failed to export tickets' });
  }
});

// Export archive (closed tickets) to XLSX — lightweight 6-column format
router.get('/export-archive', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const query = req.query as TicketQueryParams;
    const idsParam = req.query.ids as string | undefined;

    let tickets: { id: string; title: string; priority: string; category_id: string | null; closed_at: string | null }[];

    if (idsParam) {
      const ids = idsParam.split(',').map(id => id.trim()).filter(id => id);
      if (ids.length === 0) {
        return res.status(400).json({ error: 'No IDs provided' });
      }
      const placeholders = ids.map(() => '?').join(',');
      tickets = db.prepare(`
        SELECT id, title, priority, category_id, closed_at
        FROM tickets
        WHERE id IN (${placeholders})
        ORDER BY closed_at DESC
      `).all(...ids) as typeof tickets;
    } else {
      const archiveQuery = { ...query, status: 'closed' };
      const { whereClause, params, joins } = buildWhereClause(archiveQuery);
      tickets = db.prepare(`
        SELECT DISTINCT tickets.id, tickets.title, tickets.priority, tickets.category_id, tickets.closed_at
        FROM tickets ${joins}
        WHERE ${whereClause}
        ORDER BY tickets.closed_at DESC
        LIMIT 5000
      `).all(...params) as typeof tickets;
    }

    // Get categories for lookup
    const categories = db.prepare('SELECT id, label FROM categories').all() as { id: string; label: string }[];
    const categoryMap = new Map(categories.map(c => [c.id, c.label]));

    // Get tags for all tickets in a single query
    const tagsByTicket: Record<string, string[]> = {};
    if (tickets.length > 0) {
      const ticketIds = tickets.map(t => t.id);
      const placeholders = ticketIds.map(() => '?').join(',');
      const allTags = db.prepare(`
        SELECT tt.ticket_id, t.name
        FROM tags t
        JOIN ticket_tags tt ON t.id = tt.tag_id
        WHERE tt.ticket_id IN (${placeholders})
        ORDER BY t.name
      `).all(...ticketIds) as { ticket_id: string; name: string }[];

      allTags.forEach(tag => {
        if (!tagsByTicket[tag.ticket_id]) tagsByTicket[tag.ticket_id] = [];
        tagsByTicket[tag.ticket_id].push(tag.name);
      });
    }

    // Build XLSX with 6 columns
    const headers = ['ID', 'Titel', 'Prioritet', 'Kategori', 'Taggar', 'Stängd'];
    const rows = tickets.map(ticket => [
      ticket.id,
      ticket.title,
      ticket.priority,
      ticket.category_id ? categoryMap.get(ticket.category_id) || '' : '',
      (tagsByTicket[ticket.id] || []).join('; '),
      ticket.closed_at || '',
    ]);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Arkiv');
    ws.addRow(headers);
    ws.addRows(rows);
    const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `arkiv-export-${timestamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xlsxBuffer);
  } catch (error) {
    logger.error('Error exporting archive:', { error: String(error) });
    res.status(500).json({ error: 'Failed to export archive' });
  }
});

// Dashboard overview interfaces
interface AgingTicketRow {
  id: string;
  title: string;
  priority: string;
  status: string;
  requester_name: string | null;
  company_name: string | null;
  age_days: number;
}

interface TodayCountsRow {
  created_today: number;
  resolved_today: number;
  closed_today: number;
}

interface UpcomingReminderRow {
  id: string;
  ticket_id: string;
  reminder_time: string;
  message: string | null;
  ticket_title: string;
  ticket_status: string;
  ticket_priority: string;
}

// GET /dashboard-overview — aging tickets + today counts + critical count
router.get('/dashboard-overview', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const agingTickets = db.prepare(`
      SELECT
        t.id,
        t.title,
        t.priority,
        t.status,
        c.name as requester_name,
        comp.name as company_name,
        CAST(julianday('now') - julianday(
          MAX(t.updated_at, COALESCE(
            (SELECT MAX(tc.created_at) FROM ticket_comments tc WHERE tc.ticket_id = t.id AND tc.deleted_at IS NULL),
            t.updated_at
          ))
        ) AS INTEGER) as age_days
      FROM tickets t
      LEFT JOIN contacts c ON t.requester_id = c.id
      LEFT JOIN companies comp ON t.company_id = comp.id
      WHERE t.status IN ('open', 'in-progress', 'waiting')
      ORDER BY age_days DESC
      LIMIT 6
    `).all() as AgingTicketRow[];

    const todayCounts = db.prepare(`
      SELECT
        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) as created_today,
        SUM(CASE WHEN date(resolved_at) = date('now') THEN 1 ELSE 0 END) as resolved_today,
        SUM(CASE WHEN date(closed_at) = date('now') THEN 1 ELSE 0 END) as closed_today
      FROM tickets
    `).get() as TodayCountsRow;

    const criticalRow = db.prepare(`
      SELECT COUNT(*) as n
      FROM tickets
      WHERE priority = 'critical' AND status != 'closed'
    `).get() as { n: number };
    const criticalCount = criticalRow?.n ?? 0;

    res.json({ agingTickets, todayCounts, criticalCount });
  } catch (error) {
    logger.error('Error fetching dashboard overview:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch dashboard overview' });
  }
});

// GET /activity-feed — recent ticket history events for dashboard
router.get('/activity-feed', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 15, 50);
    const events = db.prepare(`
      SELECT
        th.id,
        th.ticket_id,
        th.field_name,
        th.old_value,
        th.new_value,
        th.changed_at,
        t.title AS ticket_title,
        COALESCE(u.display_name, u.email) AS user_name
      FROM ticket_history th
      LEFT JOIN tickets t ON t.id = th.ticket_id
      LEFT JOIN users u ON th.user_id = u.id
      ORDER BY th.changed_at DESC
      LIMIT ?
    `).all(limit);

    res.json(events);
  } catch (error) {
    logger.error('Error fetching activity feed:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

// GET /status-counts — count per status for flow visualization
router.get('/status-counts', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const counts = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM tickets
      WHERE status IN ('open', 'in-progress', 'waiting', 'resolved', 'closed')
      GROUP BY status
    `).all() as { status: string; count: number }[];

    const result: Record<string, number> = {
      open: 0,
      'in-progress': 0,
      waiting: 0,
      resolved: 0,
      closed: 0,
    };
    for (const row of counts) {
      result[row.status] = row.count;
    }
    res.json(result);
  } catch (error) {
    logger.error('Error fetching status counts:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch status counts' });
  }
});

// GET /requester-open-counts — antal ej-stängda ärenden per requester (aggregat).
// UserList använder detta istället för att ladda hela ticket-listan client-side.
router.get('/requester-open-counts', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT requester_id, COUNT(*) as count
      FROM tickets
      WHERE requester_id IS NOT NULL AND status != 'closed'
      GROUP BY requester_id
    `).all() as { requester_id: string; count: number }[];

    const result: Record<string, number> = {};
    for (const row of rows) result[row.requester_id] = row.count;
    res.json(result);
  } catch (error) {
    logger.error('Error fetching requester open counts:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch requester open counts' });
  }
});

// GET /upcoming-reminders — unsent reminders ordered by proximity
router.get('/upcoming-reminders', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const reminders = db.prepare(`
      SELECT
        tr.id,
        tr.ticket_id,
        tr.reminder_time,
        tr.message,
        t.title as ticket_title,
        t.status as ticket_status,
        t.priority as ticket_priority
      FROM ticket_reminders tr
      JOIN tickets t ON tr.ticket_id = t.id
      WHERE tr.sent = 0
        AND tr.reminder_time > ?
      ORDER BY tr.reminder_time ASC
      LIMIT 6
    `).all(new Date().toISOString()) as UpcomingReminderRow[];

    res.json(reminders);
  } catch (error) {
    logger.error('Error fetching upcoming reminders:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch upcoming reminders' });
  }
});

// Get single ticket
router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const ticket = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`).get(req.params.id) as TicketRow | undefined;

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Include stored field values for edit-mode support
    const fieldValues = db.prepare(
      'SELECT field_name, field_label, field_value FROM ticket_field_values WHERE ticket_id = ? ORDER BY rowid ASC'
    ).all(ticket.id) as { field_name: string; field_label: string; field_value: string }[];

    // Fetch tags for this ticket
    const tags = db.prepare(`
      SELECT t.id, t.name, t.color, t.created_at
      FROM tags t
      JOIN ticket_tags tt ON t.id = tt.tag_id
      WHERE tt.ticket_id = ?
      ORDER BY t.name
    `).all(ticket.id) as TagRow[];

    const formattedTags = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdAt: new Date(tag.created_at),
    }));

    res.json({ ...ticket, field_values: fieldValues, tags: formattedTags });
  } catch (error) {
    logger.error('Error fetching ticket:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

// Create ticket
router.post('/', writeRateLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  let { title, description, status, priority, category_id, requester_id, company_id, assigned_to, notes, solution, customFields, template_id } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  if (!description && (!customFields || customFields.length === 0)) {
    return res.status(400).json({ error: 'Either description or custom fields are required' });
  }

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority value' });
  }

  // Defense-in-depth: sanitera HTML server-side så API-direct anrop inte kan
  // smuggla in <script>/onerror/javascript: även om frontend DOMPurify hoppas över.
  title = sanitizePlainText(title);
  if (description !== undefined) description = sanitizeRichText(description);
  if (notes !== undefined) notes = sanitizeRichText(notes);
  if (solution !== undefined) solution = sanitizeRichText(solution);

  try {
    const id = uuidv4();

    // Auto-set company_id from requester if not provided
    let resolvedCompanyId = company_id || null;
    if (!resolvedCompanyId && requester_id) {
      const contact = db.prepare('SELECT company_id FROM contacts WHERE id = ?').get(requester_id) as { company_id: string | null } | undefined;
      if (contact?.company_id) {
        resolvedCompanyId = contact.company_id;
      }
    }

    // When customFields are provided, compose description ONLY from them (ignore incoming description)
    // This prevents duplicates when the frontend also pre-composes a placeholder description
    let finalDescription: string;
    if (customFields && Array.isArray(customFields) && customFields.length > 0) {
      finalDescription = customFields
        .filter((field: CustomFieldInput) => field.fieldLabel)
        .map((field: CustomFieldInput) => `**${field.fieldLabel}**: ${field.fieldValue || '(ej angivet)'}`)
        .join('  \n');
    } else {
      finalDescription = description || '';
    }

    // Warn if template is used but no custom fields provided
    if (template_id && (!customFields || customFields.length === 0)) {
      logger.warn(`⚠️ Ticket created with template_id ${template_id} but no customFields provided`);
      logger.warn('This likely indicates a frontend bug - field values will not be saved');
    }

    // Auto-priority: only when user did not explicitly provide one
    const finalPriority = priority
      ? priority
      : (detectAutoPriority(title, finalDescription) ?? 'medium');

    // Wrap all inserts in a transaction for atomicity
    const createTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, company_id, assigned_to, notes, solution, template_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        title,
        finalDescription,
        status || 'open',
        finalPriority,
        category_id || null,
        requester_id || null,
        resolvedCompanyId,
        assigned_to || null,
        notes || null,
        solution || null,
        template_id || null,
        req.user!.id
      );

      // Store custom field values if provided
      if (customFields && Array.isArray(customFields) && customFields.length > 0) {
        const insertFieldStmt = db.prepare(`
          INSERT INTO ticket_field_values (id, ticket_id, field_name, field_label, field_value)
          VALUES (?, ?, ?, ?, ?)
        `);
        customFields.forEach((field: CustomFieldInput) => {
          if (field.fieldName && field.fieldLabel) {
            insertFieldStmt.run(uuidv4(), id, field.fieldName, field.fieldLabel, field.fieldValue || '');
          }
        });
      }

      // Log ticket creation in history
      db.prepare('INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), id, req.user!.id, 'created', null, null);

      // FTS5 synkas automatiskt via triggers (migration 050)
    });

    createTransaction();

    // Apply SLA deadlines based on company + priority. Resolves to default policy
    // if no company-specific override exists. Non-fatal — a missing policy just
    // leaves sla_*_deadline NULL and the ticket renders without SLA badges.
    try {
      applySLAToTicket(id, resolvedCompanyId, finalPriority);
    } catch (error) {
      logger.error('SLA apply error (non-fatal):', { error: String(error) });
    }

    // Auto-tag based on keyword rules (runs after transaction so tags can be created separately)
    try {
      applyAutoTags(id, title, finalDescription);
    } catch (error) {
      logger.error('Auto-tag error (non-fatal):', { error: String(error) });
    }

    // AI-kategorisering: kör non-blocking så ärendet returneras direkt.
    // Sparas på ärendet om confidence > 0.6. Användare ser förslaget i UI:t
    // och kan acceptera eller ignorera.
    if (aiEnabled() && !category_id) {
      const allCategories = db.prepare('SELECT id, label FROM categories').all() as { id: string; label: string }[];
      suggestCategory(title, finalDescription, allCategories, id)
        .then((suggestion) => {
          if (suggestion && suggestion.confidence > 0.6) {
            db.prepare(`
              UPDATE tickets
              SET ai_suggested_category_id = ?, ai_suggested_confidence = ?
              WHERE id = ?
            `).run(suggestion.categoryId, suggestion.confidence, id);
            logger.info(`🤖 AI-kategori föreslagen för ${id}: ${suggestion.categoryId} (conf ${suggestion.confidence})`);
          }
        })
        .catch((err) => logger.error('AI categorize error (non-fatal):', { error: String(err) }));
    }

    const ticket = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`).get(id) as TicketRow;

    const requester = ticket.requester_id
      ? (db.prepare('SELECT name, email FROM contacts WHERE id = ?').get(ticket.requester_id) as { name: string; email: string } | undefined)
      : undefined;

    const warnings: string[] = [];

    try {
      await sendTicketCreatedEmail({
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        categoryId: ticket.category_id,
        requesterName: requester?.name,
        requesterEmail: requester?.email,
      });
    } catch (error) {
      logger.error('Error sending ticket created email:', { error: String(error) });
      warnings.push('E-postnotifiering kunde inte skickas');
    }

    dispatchWebhook('ticket.created', { id: ticket.id, title: ticket.title, status: ticket.status, priority: ticket.priority }).catch((e) => logger.error('Webhook dispatch error (ticket.created):', { error: String(e) }));

    res.status(201).json({ ...ticket, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (error) {
    logger.error('Error creating ticket:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// ─── AI-endpoints ─────────────────────────────────────────────────────────────

/**
 * POST /api/tickets/:id/ai-draft
 * Genererar ett utkast på svar baserat på ärendets innehåll + relevanta KB-artiklar.
 * KB-artiklar väljs via FTS-sökning på titel + beskrivning.
 * Sparar utkastet i ai_draft_response så det kan visas i UI:t.
 */
router.post('/:id/ai-draft', aiRateLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  if (!aiEnabled()) {
    return res.status(503).json({ error: 'AI är inte konfigurerat på denna installation (ANTHROPIC_API_KEY saknas)' });
  }
  try {
    // Behörighetskontroll: bara ägare/admin/tilldeln får generera utkast
    if (!canAccessTicket(req.user!, req.params.id)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }

    const ticket = db.prepare(`
      SELECT id, title, description FROM tickets WHERE id = ?
    `).get(req.params.id) as { id: string; title: string; description: string } | undefined;
    if (!ticket) return res.status(404).json({ error: 'Ärendet hittades inte' });

    const queryText = buildKbSearchQuery(`${ticket.title} ${ticket.description.slice(0, 200)}`);

    let kbArticles: { title: string; content: string }[] = [];
    if (queryText) {
      try {
        kbArticles = db.prepare(`
          SELECT a.title, a.content
          FROM kb_articles_fts fts
          JOIN kb_articles a ON a.rowid = fts.rowid
          WHERE kb_articles_fts MATCH ? AND a.status = 'published'
          ORDER BY rank
          LIMIT 5
        `).all(queryText) as { title: string; content: string }[];
        // Strippa HTML från innehåll innan vi skickar till LLM
        kbArticles = kbArticles.map(a => ({ title: a.title, content: stripHtml(a.content) }));
      } catch (err) {
        // FTS-sökning kan kasta om tokenizering misslyckas — gå vidare utan KB
        logger.warn('KB FTS search failed, continuing without KB context:', { error: String(err) });
      }
    }

    const TEXT_MIME_TYPES = ['text/plain', 'text/csv', 'message/rfc822', 'application/json'];
    const MAX_ATTACHMENT_CHARS = 5000;
    const MAX_ATTACHMENTS = 3;

    const attachmentRows = db.prepare(`
      SELECT file_name, file_path, file_type FROM ticket_attachments
      WHERE ticket_id = ? AND file_type IN (${TEXT_MIME_TYPES.map(() => '?').join(',')})
      ORDER BY created_at DESC LIMIT ?
    `).all(ticket.id, ...TEXT_MIME_TYPES, MAX_ATTACHMENTS) as { file_name: string; file_path: string; file_type: string }[];

    const attachmentContents: { file_name: string; content: string }[] = [];
    for (const att of attachmentRows) {
      const filePath = join(UPLOAD_DIR, att.file_path);
      if (existsSync(filePath)) {
        try {
          const raw = readFileSync(filePath, 'utf-8');
          attachmentContents.push({
            file_name: att.file_name,
            content: raw.slice(0, MAX_ATTACHMENT_CHARS),
          });
        } catch {
          // Skippa filer som inte kan läsas
        }
      }
    }

    const draft = await draftReply(
      { title: ticket.title, description: ticket.description },
      kbArticles,
      ticket.id,
      attachmentContents
    );

    if (!draft) {
      return res.status(502).json({ error: 'AI kunde inte generera ett utkast just nu. Försök igen.' });
    }

    db.prepare(`
      UPDATE tickets SET ai_draft_response = ?, ai_draft_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(draft, ticket.id);

    res.json({
      draft,
      kbArticlesUsed: kbArticles.length,
      kbTitles: kbArticles.map(a => a.title),
      attachmentsUsed: attachmentContents.map(a => a.file_name),
    });
  } catch (error) {
    logger.error('Error generating AI draft:', { error: String(error) });
    res.status(500).json({ error: 'Kunde inte generera AI-utkast' });
  }
});

/**
 * GET /api/tickets/:id/ai-summary
 * Returnerar en cachad sammanfattning av ärendet om < 1h gammal, annars genererar ny.
 * Använd query-param ?force=1 för att tvinga ny sammanfattning.
 */
router.get('/:id/ai-summary', aiRateLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  if (!aiEnabled()) {
    return res.status(503).json({ error: 'AI är inte konfigurerat på denna installation' });
  }
  try {
    const force = req.query.force === '1';
    const ticket = db.prepare(`
      SELECT id, title, description, ai_summary_json, ai_summary_updated_at
      FROM tickets WHERE id = ?
    `).get(req.params.id) as {
      id: string; title: string; description: string;
      ai_summary_json: string | null; ai_summary_updated_at: string | null;
    } | undefined;
    if (!ticket) return res.status(404).json({ error: 'Ärendet hittades inte' });

    // Cache-check: max 1 timme gammal.
    // ai_summary_updated_at är SQLite CURRENT_TIMESTAMP = UTC "YYYY-MM-DD HH:MM:SS"
    // (mellanslag, ingen Z). V8 tolkar det mellanslags-formatet som LOKAL tid, så i
    // prod-TZ (Europe/Stockholm) blev en färsk cache direkt 1-2h "gammal" → cachen
    // träffades aldrig och varje vy rebillade ett Claude-anrop. Tolka som UTC.
    if (!force && ticket.ai_summary_json && ticket.ai_summary_updated_at) {
      const updatedAtMs = new Date(ticket.ai_summary_updated_at.replace(' ', 'T') + 'Z').getTime();
      const ageMs = Date.now() - updatedAtMs;
      if (ageMs < 60 * 60 * 1000) {
        try {
          return res.json({ summary: JSON.parse(ticket.ai_summary_json), cached: true, ageMinutes: Math.round(ageMs / 60000) });
        } catch {
          // Trasig cache — fall genom till regenerering
        }
      }
    }

    // Hämta senaste 20 kommentarerna med författarnamn
    const comments = db.prepare(`
      SELECT COALESCE(u.display_name, u.email, 'System') as author, c.content, c.created_at
      FROM ticket_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.ticket_id = ? AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC
      LIMIT 50
    `).all(ticket.id) as { author: string; content: string; created_at: string }[];

    if (comments.length < 3) {
      return res.json({ summary: null, reason: 'Ärendet har för få kommentarer för att sammanfatta (< 3).' });
    }

    const summary = await summarizeTicket(
      { title: ticket.title, description: ticket.description },
      comments,
      ticket.id
    );

    if (!summary) {
      return res.status(502).json({ error: 'AI kunde inte generera sammanfattning' });
    }

    db.prepare(`
      UPDATE tickets SET ai_summary_json = ?, ai_summary_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(summary), ticket.id);

    res.json({ summary, cached: false, ageMinutes: 0 });
  } catch (error) {
    logger.error('Error generating AI summary:', { error: String(error) });
    res.status(500).json({ error: 'Kunde inte generera AI-sammanfattning' });
  }
});

// Get ticket history
router.get('/:id/history', authenticate, (req: AuthRequest, res: Response) => {
  try {
    // Behörighetskontroll: spegla PUT /:id EXAKT. Otilldelade ärenden är öppna
    // för self-service-pickup (vilken agent som helst kan visa+redigera dem), så
    // historiken måste vara lika öppen — annars blir aktivitetspanelen tom på
    // köärenden som en icke-ägande agent öppnar. Tilldelade ärenden kräver
    // admin/requester/assignee/creator.
    const t = db.prepare('SELECT assigned_to FROM tickets WHERE id = ?').get(req.params.id) as { assigned_to: string | null } | undefined;
    if (!t) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    if (t.assigned_to !== null && !canAccessTicket(req.user!, req.params.id)) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }

    const history = db.prepare(`
      SELECT th.id, th.ticket_id, th.user_id, th.field_name, th.old_value, th.new_value, th.changed_at,
             COALESCE(u.display_name, u.email) as user_name
      FROM ticket_history th
      LEFT JOIN users u ON th.user_id = u.id
      WHERE th.ticket_id = ?
      ORDER BY th.changed_at ASC
      LIMIT 500
    `).all(req.params.id);
    res.json(history);
  } catch (error) {
    logger.error('Error fetching ticket history:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch ticket history' });
  }
});

// Bulk update tickets
router.put('/bulk', writeRateLimiter, authenticate, (req: AuthRequest, res: Response) => {
  const { ids, updates } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

  // Skydda mot DoS via extremt stora batcher
  if (ids.length > 500) {
    return res.status(400).json({ error: 'För många ärenden i en batch (max 500)' });
  }

  const { status, priority, category_id, assigned_to } = updates || {};

  if (status === undefined && priority === undefined && category_id === undefined && assigned_to === undefined) {
    return res.status(400).json({ error: 'At least one field to update is required' });
  }

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority value' });
  }

  // assigned_to: self-service tillåts (matchar single-PUT). Bara validate att
  // target-user existerar — history-loggen spårar vem som ändrade.
  if (assigned_to !== undefined) {
    const normalizedAssignee = assigned_to || null;
    if (normalizedAssignee !== null) {
      const target = db.prepare('SELECT id FROM users WHERE id = ?').get(normalizedAssignee) as { id: string } | undefined;
      if (!target) {
        return res.status(400).json({ error: 'Invalid assigned_to: user does not exist' });
      }
    }
  }

  try {
    const now = new Date().toISOString();
    const userId = req.user!.id;

    const historyInsert = db.prepare(
      'INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
    );

    // Lyft userLabel ur loopen — anroparen är densamma för alla rader
    const callerRow = db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(userId) as { email: string; display_name: string | null } | undefined;
    const callerLabel = callerRow ? (callerRow.display_name || callerRow.email) : null;

    const userLabelById = (uid: string | null): string | null => {
      if (!uid) return null;
      if (uid === userId) return callerLabel;
      const u = db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(uid) as { email: string; display_name: string | null } | undefined;
      return u ? (u.display_name || u.email) : null;
    };

    // Batcha kategori-lookups till en Map för att undvika N+1
    const allCategories = db.prepare('SELECT id, label FROM categories').all() as { id: string; label: string }[];
    const categoryLabelMap = new Map(allCategories.map(c => [c.id, c.label]));

    const bulkUpdate = db.transaction(() => {
      let updatedCount = 0;
      const skipped: string[] = [];

      // Pre-fetch alla berörda ärenden i en enda query för att undvika N+1
      const placeholders = ids.map(() => '?').join(',');
      const existingRows = db.prepare(
        `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id IN (${placeholders})`
      ).all(...ids) as TicketRow[];
      const existingMap = new Map<string, TicketRow>(existingRows.map(row => [row.id, row]));

      for (const ticketId of ids) {
        const existing = existingMap.get(ticketId);
        if (!existing) continue;

        // Behörighetsfilter (matchar PUT /:id): otilldelade ärenden står öppna
        // för self-service pickup; i övrigt krävs access via canAccessTicket
        // (admin / requester / assignee / creator). Otillgängliga ärenden tas
        // inte tyst med — de rapporteras i `skipped`.
        if (existing.assigned_to !== null && !canAccessTicket(req.user!, ticketId)) {
          skipped.push(ticketId);
          continue;
        }

        const safeUpdates: Record<string, unknown> = {};

        if (status !== undefined) {
          safeUpdates.status = status;
          if (status === 'resolved' && !existing.resolved_at) safeUpdates.resolved_at = now;
          if (status === 'closed' && !existing.closed_at) safeUpdates.closed_at = now;
          if (status !== existing.status) {
            historyInsert.run(uuidv4(), ticketId, userId, 'status', existing.status as string, status);
          }
        }
        if (priority !== undefined) {
          safeUpdates.priority = priority;
          if (priority !== existing.priority) {
            historyInsert.run(uuidv4(), ticketId, userId, 'priority', existing.priority as string, priority);
          }
        }
        if (category_id !== undefined) {
          safeUpdates.category_id = category_id || null;
          if (safeUpdates.category_id !== existing.category_id) {
            const oldCat = existing.category_id ? (categoryLabelMap.get(existing.category_id) ?? null) : null;
            const newCat = category_id ? (categoryLabelMap.get(category_id) ?? null) : null;
            historyInsert.run(uuidv4(), ticketId, userId, 'category_id', oldCat, newCat);
          }
        }
        if (assigned_to !== undefined) {
          const newAssignee = assigned_to || null;
          safeUpdates.assigned_to = newAssignee;
          if (newAssignee !== existing.assigned_to) {
            historyInsert.run(
              uuidv4(),
              ticketId,
              userId,
              'assigned_to',
              userLabelById(existing.assigned_to as string | null),
              userLabelById(newAssignee),
            );
          }
        }

        if (Object.keys(safeUpdates).length === 0) continue;

        const setClauses = Object.keys(safeUpdates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(safeUpdates), ticketId];
        db.prepare(`UPDATE tickets SET ${setClauses} WHERE id = ?`).run(...values);
        updatedCount++;
      }

      return { updatedCount, skipped };
    });

    const { updatedCount, skipped } = bulkUpdate();
    // Bakåtkompatibelt: `updated` (antal) behålls oförändrat. `skipped` läggs
    // till med ID:n för ärenden anroparen saknar behörighet till.
    return res.json({ updated: updatedCount, skipped });
  } catch (error) {
    logger.error('Bulk update error:', { error: String(error) });
    return res.status(500).json({ error: 'Failed to bulk update tickets' });
  }
});

// Bulk delete tickets permanently — admin-only to prevent mass data loss
router.post('/bulk-delete', writeRateLimiter, authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

  try {
    const bulkDelete = db.transaction(() => {
      let deletedCount = 0;

      // Pre-fetch alla filbilagor i en enda query för att undvika N+1
      const placeholders = ids.map(() => '?').join(',');
      const allAttachments = db.prepare(
        `SELECT ticket_id, file_path FROM ticket_attachments WHERE ticket_id IN (${placeholders})`
      ).all(...ids) as { ticket_id: string; file_path: string }[];
      const attachmentsByTicket = new Map<string, { file_path: string }[]>();
      for (const att of allAttachments) {
        const list = attachmentsByTicket.get(att.ticket_id) ?? [];
        list.push({ file_path: att.file_path });
        attachmentsByTicket.set(att.ticket_id, list);
      }

      for (const ticketId of ids) {
        // Hämta förpopulerade filbilagor från Map
        const attachments = attachmentsByTicket.get(ticketId) ?? [];

        // FTS5 rensas automatiskt via triggers (migration 050)
        const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);

        if (result.changes > 0) {
          deletedCount++;
          // Clean up attachment files from disk (DB CASCADE handles relation tables)
          for (const attachment of attachments) {
            const filePath = join(UPLOAD_DIR, attachment.file_path);
            if (existsSync(filePath)) {
              try {
                unlinkSync(filePath);
              } catch (err) {
                logger.error('Failed to delete attachment file', { filePath, error: String(err) });
              }
            }
          }
        }
      }

      return deletedCount;
    });

    const count = bulkDelete();
    // Concurrent-guard: `result.changes` per rad räknas exakt, så ärenden som
    // redan hunnit raderas av en samtidig operation (eller aldrig fanns) ger
    // changes=0 och räknas inte med — `deleted` är alltid det faktiska antalet
    // borttagna rader. Ett benignt race 500:ar alltså aldrig endpointen. Om
    // färre raderades än begärt rapporteras differensen i `alreadyGone`.
    const alreadyGone = ids.length - count;
    const response: { deleted: number; alreadyGone?: number } = { deleted: count };
    if (alreadyGone > 0) response.alreadyGone = alreadyGone;
    return res.json(response);
  } catch (error) {
    logger.error('Bulk delete error:', { error: String(error) });
    return res.status(500).json({ error: 'Failed to bulk delete tickets' });
  }
});

// Update ticket
router.put('/:id', writeRateLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  let { title, description, status, priority, category_id, requester_id, company_id, assigned_to, notes, solution, customFields, template_id, tag_ids, ai_suggested_category_id } = req.body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority value' });
  }

  // Input-längdvalidering före sanitering — matchar publika formulärets caps
  // (se public.ts). Bara fält som faktiskt skickas valideras (undefined = rör
  // inte). Mäter rå inkommande längd så att senare HTML-sanitering inte döljer
  // en överstor payload.
  if (typeof title === 'string' && title.length > 200) {
    return res.status(400).json({ error: 'Title must be 200 characters or less' });
  }
  if (typeof description === 'string' && description.length > 5000) {
    return res.status(400).json({ error: 'Description must be 5000 characters or less' });
  }
  if (typeof notes === 'string' && notes.length > 5000) {
    return res.status(400).json({ error: 'Notes must be 5000 characters or less' });
  }
  if (typeof solution === 'string' && solution.length > 5000) {
    return res.status(400).json({ error: 'Solution must be 5000 characters or less' });
  }

  // Defense-in-depth: sanitera HTML server-side. Bara fält som faktiskt skickas
  // sanitiseras — undefined betyder "rör inte" i PUT-logiken nedan.
  if (title !== undefined) title = sanitizePlainText(title);
  if (description !== undefined) description = sanitizeRichText(description);
  if (notes !== undefined) notes = sanitizeRichText(notes);
  if (solution !== undefined) solution = sanitizeRichText(solution);

  try {
    const existing = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`).get(req.params.id) as TicketRow | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Authorization: admins, the requester, the assignee or the creator may edit
    // (canAccessTicket). Unassigned tickets stay open for self-service pickup —
    // any authenticated agent may claim/work a ticket sitting in the queue. This
    // blocks a non-owner from rewriting a ticket already assigned to a colleague.
    if (existing.assigned_to !== null && !canAccessTicket(req.user!, req.params.id as string)) {
      return res.status(403).json({ error: 'Du har inte behörighet att ändra detta ärende' });
    }

    // When customFields are provided, compose description from them (same logic as POST)
    let finalDescription: string | undefined = description;
    if (customFields && Array.isArray(customFields) && customFields.length > 0) {
      finalDescription = customFields
        .filter((field: CustomFieldInput) => field.fieldLabel)
        .map((field: CustomFieldInput) => `**${field.fieldLabel}**: ${field.fieldValue || '(ej angivet)'}`)
        .join('  \n');
    }

    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (finalDescription !== undefined) updates.description = finalDescription;
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (category_id !== undefined) updates.category_id = category_id || null;
    if (requester_id !== undefined) updates.requester_id = requester_id || null;
    if (company_id !== undefined) updates.company_id = company_id || null;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null;
    if (notes !== undefined) updates.notes = notes || null;
    if (solution !== undefined) updates.solution = solution || null;
    if (template_id !== undefined) updates.template_id = template_id || null;
    if (ai_suggested_category_id !== undefined) updates.ai_suggested_category_id = ai_suggested_category_id || null;

    // Always set updated_at when any field changes
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
    }

    // Handle resolved_at and closed_at
    if (status === 'resolved' && !existing.resolved_at) {
      updates.resolved_at = new Date().toISOString();
    }
    if (status === 'closed' && !existing.closed_at) {
      updates.closed_at = new Date().toISOString();
    }

    // Whitelist of allowed field names to prevent SQL injection
    const allowedFields = [
      'title', 'description', 'status', 'priority', 'category_id',
      'requester_id', 'company_id', 'assigned_to',
      'notes', 'solution', 'resolved_at', 'closed_at', 'updated_at', 'template_id',
      'ai_suggested_category_id',
    ];

    // Filter updates to only include whitelisted fields
    const safeUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        safeUpdates[key] = value;
      } else {
        logger.warn(`Attempted to update non-whitelisted field: ${key}`);
      }
    }

    const setClauses = Object.keys(safeUpdates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(safeUpdates);

    // Wrap all DB writes (including history) in a transaction for atomicity
    const updateTransaction = db.transaction(() => {
      if (setClauses) {
        db.prepare(`UPDATE tickets SET ${setClauses} WHERE id = ?`).run(...values, req.params.id);
      }

      // Log meaningful field changes to history (inside transaction)
      const historyInsert = db.prepare(
        'INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
      );
      if ('status' in safeUpdates && safeUpdates.status !== existing.status) {
        historyInsert.run(uuidv4(), req.params.id, req.user!.id, 'status', existing.status as string, safeUpdates.status as string);
      }
      if ('priority' in safeUpdates && safeUpdates.priority !== existing.priority) {
        historyInsert.run(uuidv4(), req.params.id, req.user!.id, 'priority', existing.priority as string, safeUpdates.priority as string);
      }
      if ('category_id' in safeUpdates && safeUpdates.category_id !== existing.category_id) {
        const oldCat = existing.category_id
          ? (db.prepare('SELECT label FROM categories WHERE id = ?').get(existing.category_id) as { label: string } | undefined)?.label ?? null
          : null;
        const newCat = safeUpdates.category_id
          ? (db.prepare('SELECT label FROM categories WHERE id = ?').get(safeUpdates.category_id as string) as { label: string } | undefined)?.label ?? null
          : null;
        historyInsert.run(uuidv4(), req.params.id, req.user!.id, 'category_id', oldCat, newCat);
      }
      if ('assigned_to' in safeUpdates && safeUpdates.assigned_to !== existing.assigned_to) {
        const userLabel = (uid: string | null) => {
          if (!uid) return null;
          const u = db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(uid) as { email: string; display_name: string | null } | undefined;
          return u ? (u.display_name || u.email) : null;
        };
        historyInsert.run(
          uuidv4(),
          req.params.id,
          req.user!.id,
          'assigned_to',
          userLabel(existing.assigned_to as string | null),
          userLabel(safeUpdates.assigned_to as string | null),
        );
      }
      if ('title' in safeUpdates && safeUpdates.title !== existing.title) {
        historyInsert.run(uuidv4(), req.params.id, req.user!.id, 'title', null, null);
      }
      if ('notes' in safeUpdates && safeUpdates.notes !== existing.notes) {
        historyInsert.run(uuidv4(), req.params.id, req.user!.id, 'notes', null, null);
      }
      if ('solution' in safeUpdates && safeUpdates.solution !== existing.solution) {
        const isNew = !existing.solution && safeUpdates.solution;
        historyInsert.run(uuidv4(), req.params.id, req.user!.id, 'solution', null, isNew ? 'added' : 'updated');
      }

      // Replace field values if customFields were provided
      if (customFields && Array.isArray(customFields) && customFields.length > 0) {
        db.prepare('DELETE FROM ticket_field_values WHERE ticket_id = ?').run(req.params.id);
        const insertFieldStmt = db.prepare(`
          INSERT INTO ticket_field_values (id, ticket_id, field_name, field_label, field_value)
          VALUES (?, ?, ?, ?, ?)
        `);
        customFields.forEach((field: CustomFieldInput) => {
          if (field.fieldName && field.fieldLabel) {
            insertFieldStmt.run(uuidv4(), req.params.id, field.fieldName, field.fieldLabel, field.fieldValue || '');
          }
        });
      }

      // Update tags if provided
      if (tag_ids && Array.isArray(tag_ids)) {
        db.prepare('DELETE FROM ticket_tags WHERE ticket_id = ?').run(req.params.id);
        const insertTag = db.prepare('INSERT INTO ticket_tags (id, ticket_id, tag_id) VALUES (?, ?, ?)');
        tag_ids.forEach((tagId: string) => {
          insertTag.run(uuidv4(), req.params.id, tagId);
        });
      }

      // FTS5 synkas automatiskt via triggers (migration 050)
    });

    updateTransaction();

    // SLA pause/resume + breach marking on status transitions. Runs after the
    // main update so the latest status is what handleSLAStatusChange reads.
    if ('status' in safeUpdates && safeUpdates.status !== existing.status) {
      try {
        handleSLAStatusChange(req.params.id as string, existing.status as string, safeUpdates.status as string);
      } catch (error) {
        logger.error('SLA status-change error (non-fatal):', { error: String(error) });
      }
    }

    // Notify the new assignee by mail when ticket is reassigned. Only fires on
    // assign (new value non-null) — clearing an assignee sends nothing.
    if (
      'assigned_to' in safeUpdates &&
      safeUpdates.assigned_to !== existing.assigned_to &&
      safeUpdates.assigned_to
    ) {
      try {
        const assignee = db.prepare('SELECT email, display_name FROM users WHERE id = ?')
          .get(safeUpdates.assigned_to as string) as { email: string; display_name: string | null } | undefined;
        const assigner = db.prepare('SELECT email, display_name FROM users WHERE id = ?')
          .get(req.user!.id) as { email: string; display_name: string | null } | undefined;
        if (assignee?.email) {
          // Avoid spamming users who assign tickets to themselves.
          const isSelfAssign = safeUpdates.assigned_to === req.user!.id;
          if (!isSelfAssign) {
            await sendTicketAssignedEmail({
              toEmail: assignee.email,
              toName: assignee.display_name || assignee.email.split('@')[0],
              ticketId: req.params.id as string,
              ticketTitle: existing.title,
              ticketPriority: (safeUpdates.priority as string) || existing.priority,
              assignerName: assigner?.display_name || assigner?.email?.split('@')[0] || 'System',
            });
          }
        }
      } catch (error) {
        logger.error('Assignee notification error (non-fatal):', { error: String(error) });
      }
    }

    const ticket = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`).get(req.params.id) as TicketRow;

    // Fetch tags for response
    const tags = db.prepare(`
      SELECT t.id, t.name, t.color, t.created_at
      FROM tags t
      JOIN ticket_tags tt ON t.id = tt.tag_id
      WHERE tt.ticket_id = ?
      ORDER BY t.name
    `).all(req.params.id) as TagRow[];

    const formattedTags = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdAt: new Date(tag.created_at),
    }));

    const warnings: string[] = [];

    // Dispatch webhook for ticket update
    if ('status' in safeUpdates && safeUpdates.status !== existing.status) {
      dispatchWebhook('ticket.updated', { id: req.params.id, ...safeUpdates }).catch((e) => logger.error('Webhook dispatch error (ticket.updated):', { error: String(e) }));

      if (safeUpdates.status === 'closed') {
        dispatchWebhook('ticket.closed', { id: req.params.id }).catch((e) => logger.error('Webhook dispatch error (ticket.closed):', { error: String(e) }));
      }
    }

    if (status === 'closed' && existing.status !== 'closed') {
      const requester = ticket.requester_id
        ? (db.prepare('SELECT name, email FROM contacts WHERE id = ?').get(ticket.requester_id) as { name: string; email: string } | undefined)
        : undefined;

      try {
        await sendTicketClosedEmail({
          id: ticket.id,
          title: ticket.title,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          categoryId: ticket.category_id,
          requesterName: requester?.name,
          requesterEmail: requester?.email,
        });
      } catch (error) {
        logger.error('Error sending ticket closed email:', { error: String(error) });
        warnings.push('E-postnotifiering vid stängning kunde inte skickas');
      }
    }

    res.json({ ...ticket, tags: formattedTags, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (error) {
    logger.error('Error updating ticket:', { error: String(error) });
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// Delete ticket
router.delete('/:id', writeRateLimiter, authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    // Hämta data för FTS-rensning och filbilagor innan radering
    // FTS5 rensas automatiskt via triggers (migration 050)
    const attachments = db.prepare(
      'SELECT file_path FROM ticket_attachments WHERE ticket_id = ?'
    ).all(req.params.id) as { file_path: string }[];

    const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Clean up attachment files from disk (DB relations cascade automatically)
    for (const attachment of attachments) {
      const filePath = join(UPLOAD_DIR, attachment.file_path);
      if (existsSync(filePath)) {
        try {
          unlinkSync(filePath);
        } catch (err) {
          logger.error('Failed to delete attachment file', { filePath, error: String(err) });
        }
      }
    }

    res.json({ message: 'Ticket deleted' });
  } catch (error) {
    logger.error('Error deleting ticket:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

// ===== REMINDER ROUTES =====

// POST /api/tickets/:id/reminders - Create reminder
router.post('/:id/reminders', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { reminder_time, message } = req.body;
    const ticketId = req.params.id;
    const userId = req.user!.id;

    if (!reminder_time) {
      return res.status(400).json({ error: 'Reminder time is required' });
    }

    // Validate future time
    if (new Date(reminder_time) <= new Date()) {
      return res.status(400).json({ error: 'Reminder must be in the future' });
    }

    // Check ticket exists
    const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const id = uuidv4();
    const insertResult = db.prepare(`
      INSERT INTO ticket_reminders (id, ticket_id, user_id, reminder_time, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, ticketId, userId, reminder_time, message || null);

    const reminder = db.prepare(
      'SELECT id, ticket_id, user_id, reminder_time, message, sent, created_at, sent_at FROM ticket_reminders WHERE id = ?'
    ).get(id);
    res.status(201).json(reminder);
  } catch (error) {
    logger.error('Error creating reminder:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

// GET /api/tickets/:id/reminders - List reminders for ticket
router.get('/:id/reminders', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const reminders = db.prepare(`
      SELECT tr.id, tr.ticket_id, tr.user_id, tr.reminder_time, tr.message, tr.sent, tr.created_at, tr.sent_at,
             u.display_name as user_name, u.email as user_email
      FROM ticket_reminders tr
      JOIN users u ON tr.user_id = u.id
      WHERE tr.ticket_id = ?
      ORDER BY tr.reminder_time ASC
    `).all(req.params.id);

    res.json(reminders);
  } catch (error) {
    logger.error('Error fetching reminders:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

// DELETE /api/tickets/:id/reminders/sent — Clear all sent reminders for a ticket
// Must be registered before /:reminderId to avoid Express matching "sent" as a param
router.delete('/:id/reminders/sent', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const ticketId = req.params.id as string;
    const userId = req.user!.id;

    const result = db.prepare(`
      DELETE FROM ticket_reminders
      WHERE ticket_id = ? AND user_id = ? AND sent = 1
    `).run(ticketId, userId);

    res.json({ deleted: result.changes });
  } catch (error) {
    logger.error('Error clearing sent reminders:', { error: String(error) });
    res.status(500).json({ error: 'Failed to clear sent reminders' });
  }
});

// DELETE /api/tickets/:id/reminders/:reminderId - Cancel reminder
router.delete('/:id/reminders/:reminderId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { reminderId } = req.params;
    const userId = req.user!.id;

    const reminder = db.prepare(
      'SELECT id, ticket_id, user_id, reminder_time, message, sent, created_at, sent_at FROM ticket_reminders WHERE id = ?'
    ).get(reminderId) as { id: string; ticket_id: string; user_id: string; reminder_time: string; message: string | null; sent: number; created_at: string; sent_at: string | null } | undefined;

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    // Only allow users to delete their own reminders (or admins)
    if (reminder.user_id !== userId && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    db.prepare('DELETE FROM ticket_reminders WHERE id = ?').run(reminderId);
    res.json({ message: 'Reminder deleted' });
  } catch (error) {
    logger.error('Error deleting reminder:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

export default router;
