import { normalizeTemplateValues, missingRequiredTemplateFields, composeDescriptionFromFields, type TemplateFieldValue } from '../lib/templateValidation.js';
import { Router, Response } from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { db } from '../db/connection.js';
import { sendTicketClosedEmail, sendTicketCreatedEmail, sendTicketAssignedEmail } from '../lib/email.js';
import { authenticate, requireAdmin, AuthRequest, isEffectiveAdmin } from '../middleware/auth.js';
import { canAccessTicket, canWriteTicketRow } from '../lib/ticketAccess.js';
import { detectAutoPriority } from '../lib/automationHelper.js';
import { writeRateLimiter } from '../middleware/rateLimit.js';
import { dispatchWebhook } from '../lib/webhookDispatcher.js';
import { notifyStaffOfNewTicket } from '../lib/ticketNotifications.js';
import { sanitizePlainText } from '../lib/htmlSanitizer.js';
import { logger } from '../lib/logger.js';
import { logAudit } from '../lib/auditLog.js';
import { attachmentDisposition } from '../lib/contentDisposition.js';
import { resolveUploadPath } from '../lib/uploadPath.js';
import { validateTicketInput, MAX_BODY_LENGTH, type TicketInput } from '../lib/ticketValidation.js';
import {
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
// Listkolumner utan de tunga textfälten (description/notes/solution): listan
// och kanban-vyerna renderar dem aldrig, och de dominerar annars svarsstorleken.
const LIST_COLUMN_LIST = [
  'tickets.id', 'tickets.title', 'tickets.status', 'tickets.priority',
  'tickets.category_id', 'tickets.requester_id', 'tickets.company_id', 'tickets.assigned_to',
  '(SELECT COALESCE(display_name, email) FROM users WHERE id = tickets.assigned_to) AS assigned_to_name',
  '(SELECT name FROM contacts WHERE id = tickets.requester_id) AS requester_name',
  '(SELECT label FROM categories WHERE id = tickets.category_id) AS category_label',
  'tickets.template_id',
  'tickets.created_at', 'tickets.updated_at', 'tickets.resolved_at', 'tickets.closed_at',
];
const LIST_COLUMNS = LIST_COLUMN_LIST.join(', ');
// Detalj-, export- och uppdateringsvägar behöver hela raden.
const TICKET_COLUMNS = [...LIST_COLUMN_LIST, 'tickets.description', 'tickets.notes', 'tickets.solution'].join(', ');

// Statusar där ett ärende räknas som pågående — att flytta dit rensar resolved_at/closed_at.
const ACTIVE_STATUSES = ['open', 'in-progress', 'waiting'];

// SQLite-parametertak: IN-listor delas upp i bitar om högst så här många id:n.
const IN_CHUNK_SIZE = 500;
const MAX_BULK_IDS = 500;
const COMPOSED_DESCRIPTION_TOO_LONG = `Mallfälten ger en beskrivning över ${MAX_BODY_LENGTH} tecken — korta ner fälten`;
const MAX_REMINDER_MESSAGE_LENGTH = 500;

function chunked<T>(items: T[], size = IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const isIdArray = (ids: unknown): ids is string[] =>
  Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === 'string');

// Tar bort uppladdade filer från disk efter att DB-raderna committats.
function removeUploadedFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    const fullPath = resolveUploadPath(UPLOAD_DIR, filePath);
    if (fullPath && existsSync(fullPath)) {
      try {
        unlinkSync(fullPath);
      } catch (err) {
        logger.error('Failed to delete attachment file', { filePath: fullPath, error: String(err) });
      }
    }
  }
}

type TicketListRow = Omit<TicketRow, 'description' | 'notes' | 'solution'>;

// Multer config for CSV upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

const router = Router();


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
        SELECT ${LIST_COLUMNS} FROM tickets ORDER BY created_at DESC LIMIT 1000
      `).all() as TicketListRow[];
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
    const selectClause = joins ? `SELECT DISTINCT ${LIST_COLUMNS}` : `SELECT ${LIST_COLUMNS}`;
    const fromClause = joins ? `FROM tickets ${joins}` : 'FROM tickets';

    const offset = (page - 1) * limit;
    const tickets = db.prepare(`
      ${selectClause}
      ${fromClause}
      WHERE ${whereClause}
      ORDER BY ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as TicketListRow[];

    // Build pagination metadata
    const totalPages = Math.ceil(total / limit);
    const paginatedResponse: PaginatedResponse<TicketListRow> = {
      data: tickets,
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
router.post('/import/preview', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  // Wrap upload.single to catch multer errors (e.g. wrong file type/oversize)
  // as 400 instead of letting them propagate to Express's default error
  // handler (500). Mirrors attachments.ts's upload-error wrapping.
  upload.single('file')(req, res, (err) => {
    if (err) {
      logger.error('CSV upload validation error:', { error: err.message });
      return res.status(400).json({ error: err.message });
    }

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
      INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, notes, solution, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const importedBy = req.user!.id;

    // Validera + sanera alla rader före transaktionen (samma regler som POST/PUT).
    const rows: Array<{ input: TicketInput; ticket: Record<string, unknown> }> = [];
    for (const [index, ticket] of tickets.entries()) {
      const result = ticket && typeof ticket === 'object'
        ? validateTicketInput({
          title: ticket.title,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          notes: ticket.notes,
          solution: ticket.solution,
        }, { partial: false })
        : { ok: false as const, error: 'ogiltig rad' };
      if (!result.ok) {
        return res.status(400).json({ success: false, created: 0, failed: tickets.length, error: `Rad ${index + 1}: ${result.error}` });
      }
      rows.push({ input: result.value, ticket });
    }

    const contactStmt = db.prepare('INSERT INTO contacts (id, name, email, created_at) VALUES (?, ?, ?, ?)');

    // Use transaction for bulk insert - all-or-nothing approach
    // If ANY ticket fails, the entire transaction rolls back
    const insertMany = db.transaction(() => {
      let created = 0;
      const now = new Date().toISOString();

      for (const { input, ticket } of rows) {
        const id = randomUUID(); // Always generate new ID

        // Case-insensitive category lookup
        const category = typeof ticket.category === 'string' ? ticket.category.trim() : '';
        const categoryId = category ? categoryMap.get(category.toLowerCase()) || null : null;

        // Try to find or create contact
        const requesterName = typeof ticket.requester_name === 'string' ? sanitizePlainText(ticket.requester_name).trim() : '';
        const requesterEmail = typeof ticket.requester_email === 'string' ? sanitizePlainText(ticket.requester_email).trim() : '';
        let requesterId = null;
        if (requesterName || requesterEmail) {
          // Case-insensitive contact lookup
          requesterId = (requesterName ? contactByNameMap.get(requesterName.toLowerCase()) : null) ||
                       (requesterEmail ? contactByEmailMap.get(requesterEmail.toLowerCase()) : null) ||
                       null;

          // If contact doesn't exist and we have both name and email, create it
          if (!requesterId && requesterName && requesterEmail) {
            const newContactId = randomUUID();
            contactStmt.run(newContactId, requesterName, requesterEmail, now);
            requesterId = newContactId;
          }
        }

        // Insert ticket - will throw error if validation fails, causing rollback
        stmt.run(
          id,
          input.title,
          input.description || input.title,
          input.status || 'open',
          input.priority || 'medium',
          categoryId,
          requesterId,
          input.notes || null,
          input.solution || null,
          importedBy,
          now,
          now
        );

        // FTS5 synkas automatiskt via triggers (migration 050)
        created++;
      }

      return created;
    });

    // Execute transaction - handle errors outside
    try {
      const created = insertMany();

      logAudit(req.user!.id, 'ticket_import', 'ticket', null, `created: ${created}`, req.ip, req.apiKey?.id ?? null);

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
    // Filnamnet byggs av klientstyrda query-värden — attachmentDisposition kodar/neutraliserar dem.
    res.setHeader('Content-Disposition', attachmentDisposition(filename));
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
      tickets = chunked(ids).flatMap((chunk) => db.prepare(`
        SELECT id, title, priority, category_id, closed_at
        FROM tickets
        WHERE id IN (${chunk.map(() => '?').join(',')})
      `).all(...chunk) as typeof tickets);
      tickets.sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? ''));
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
    for (const chunk of chunked(tickets.map(t => t.id))) {
      const allTags = db.prepare(`
        SELECT tt.ticket_id, t.name
        FROM tags t
        JOIN ticket_tags tt ON t.id = tt.tag_id
        WHERE tt.ticket_id IN (${chunk.map(() => '?').join(',')})
        ORDER BY t.name
      `).all(...chunk) as { ticket_id: string; name: string }[];

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
    res.setHeader('Content-Disposition', attachmentDisposition(filename));
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
router.get('/dashboard-overview', authenticate, (_req: AuthRequest, res: Response) => {
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
          MAX(t.updated_at, COALESCE(lc.last_comment_at, t.updated_at))
        ) AS INTEGER) as age_days
      FROM tickets t
      LEFT JOIN contacts c ON t.requester_id = c.id
      LEFT JOIN companies comp ON t.company_id = comp.id
      LEFT JOIN (
        SELECT ticket_id, MAX(created_at) AS last_comment_at
        FROM ticket_comments
        WHERE deleted_at IS NULL
          AND ticket_id IN (SELECT id FROM tickets WHERE status IN ('open', 'in-progress', 'waiting'))
        GROUP BY ticket_id
      ) lc ON lc.ticket_id = t.id
      WHERE t.status IN ('open', 'in-progress', 'waiting')
      ORDER BY age_days DESC
      LIMIT 6
    `).all() as AgingTicketRow[];

    // Dagsintervall som textgränser (UTC, som date('now')): fungerar för både
    // ISO-tider ('2026-01-01T10:00:00Z') och äldre 'YYYY-MM-DD HH:MM:SS', och låter
    // SQLite använda index i stället för att köra date() på varje rad.
    const dayStart = new Date().toISOString().slice(0, 10);
    const dayEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayCounts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM tickets WHERE created_at >= ? AND created_at < ?) as created_today,
        (SELECT COUNT(*) FROM tickets WHERE resolved_at >= ? AND resolved_at < ?) as resolved_today,
        (SELECT COUNT(*) FROM tickets WHERE closed_at >= ? AND closed_at < ?) as closed_today
    `).get(dayStart, dayEnd, dayStart, dayEnd, dayStart, dayEnd) as TodayCountsRow;

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
router.get('/status-counts', authenticate, (_req: AuthRequest, res: Response) => {
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
router.get('/requester-open-counts', authenticate, (_req: AuthRequest, res: Response) => {
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
router.get('/upcoming-reminders', authenticate, (_req: AuthRequest, res: Response) => {
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

    res.json({ ...ticket, field_values: fieldValues });
  } catch (error) {
    logger.error('Error fetching ticket:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

// Create ticket
router.post('/', writeRateLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  let { customFields } = req.body;
  const { template_id } = req.body;

  try {
    // Längdtak, enum- och FK-kontroller samt HTML-sanering (defense-in-depth så
    // API-direkta anrop inte kan smuggla in <script>/onerror/javascript:).
    const validation = validateTicketInput(req.body, { partial: false });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    const { title, description, status, priority, category_id, requester_id, company_id, assigned_to, notes, solution } = validation.value;

    if (!description && (!customFields || customFields.length === 0)) {
      return res.status(400).json({ error: 'Either description or custom fields are required' });
    }

    if (customFields !== undefined) {
      const normalized = normalizeTemplateValues(customFields);
      if (!normalized) return res.status(400).json({ error: 'Invalid custom fields' });
      customFields = normalized;
    }
    const fieldErrors = missingRequiredTemplateFields(template_id || null, customFields ?? []);
    if (Object.keys(fieldErrors).length > 0) {
      return res.status(400).json({ error: 'Fyll i obligatoriska mallfält', fieldErrors });
    }
    const id = randomUUID();

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
      finalDescription = composeDescriptionFromFields(customFields);
      if (finalDescription.length > MAX_BODY_LENGTH) return res.status(400).json({ error: COMPOSED_DESCRIPTION_TOO_LONG });
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
    const now = new Date().toISOString();
    const createTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, company_id, assigned_to, notes, solution, template_id, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        req.user!.id,
        now,
        now
      );

      // Store custom field values if provided
      if (customFields && Array.isArray(customFields) && customFields.length > 0) {
        const insertFieldStmt = db.prepare(`
          INSERT INTO ticket_field_values (id, ticket_id, field_name, field_label, field_value, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        customFields.forEach((field: CustomFieldInput) => {
          if (field.fieldName && field.fieldLabel) {
            insertFieldStmt.run(randomUUID(), id, field.fieldName, field.fieldLabel, field.fieldValue || '', now);
          }
        });
      }

      // Log ticket creation in history
      db.prepare('INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), id, req.user!.id, 'created', null, null, now);

      // FTS5 synkas automatiskt via triggers (migration 050)
    });

    createTransaction();

    const ticket = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`).get(id) as TicketRow;

    const requester = ticket.requester_id
      ? (db.prepare('SELECT name, email FROM contacts WHERE id = ?').get(ticket.requester_id) as { name: string; email: string } | undefined)
      : undefined;

    const warnings: string[] = [];

    // Fire-and-forget: a notification email must NOT block the save response.
    // Inline-awaiting coupled the user's save latency to SMTP latency (up to
    // ~30s stalls when the relay throttled). Mirror the webhook dispatch below.
    sendTicketCreatedEmail({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      categoryId: ticket.category_id,
      requesterName: requester?.name,
      requesterEmail: requester?.email,
    }).catch((error) => logger.error('Error sending ticket created email:', { error: String(error) }));

    dispatchWebhook('ticket.created', { id: ticket.id, title: ticket.title, status: ticket.status, priority: ticket.priority }).catch((e) => logger.error('Webhook dispatch error (ticket.created):', { error: String(e) }));

    // Fire-and-forget web-push so staff get an instant notification on their
    // installed PWA (incl. iOS). Broadcast to all subscriptions — see
    // notifyStaffOfNewTicket for the recipient/privacy rationale.
    notifyStaffOfNewTicket(ticket.id, ticket.title, ticket.description || '').catch((e) => logger.error('new-ticket push error (ticket.created):', { error: String(e) }));

    res.status(201).json({ ...ticket, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (error) {
    logger.error('Error creating ticket:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// Get ticket history
router.get('/:id/history', authenticate, (req: AuthRequest, res: Response) => {
  try {
    // Läsning är öppen för alla inloggade.
    const t = db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(req.params.id);
    if (!t) {
      return res.status(404).json({ error: 'Ticket not found' });
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

  if (!isIdArray(ids)) {
    return res.status(400).json({ error: 'ids must be a non-empty array of strings' });
  }

  // Skydda mot DoS via extremt stora batcher
  if (ids.length > MAX_BULK_IDS) {
    return res.status(400).json({ error: 'För många ärenden i en batch (max 500)' });
  }

  const { status: rawStatus, priority: rawPriority, category_id: rawCategoryId, assigned_to: rawAssignedTo } = updates || {};

  if (rawStatus === undefined && rawPriority === undefined && rawCategoryId === undefined && rawAssignedTo === undefined) {
    return res.status(400).json({ error: 'At least one field to update is required' });
  }

  try {
    // Samma enum- och FK-kontroller som PUT /:id. assigned_to: self-service tillåts
    // (matchar single-PUT); history-loggen spårar vem som ändrade.
    const validation = validateTicketInput(
      { status: rawStatus, priority: rawPriority, category_id: rawCategoryId, assigned_to: rawAssignedTo },
      { partial: true },
    );
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    const { status, priority, category_id, assigned_to } = validation.value;

    const now = new Date().toISOString();
    const userId = req.user!.id;

    const historyInsert = db.prepare(
      `INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
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
      const statusChanges: { id: string; title: string; from: string; to: string }[] = [];

      // Pre-fetch alla berörda ärenden i en enda query för att undvika N+1.
      // created_by ingår (utöver TICKET_COLUMNS) så att behörighetskontrollen
      // nedan kan avgöras helt från denna batch — annars hade canAccessTicket
      // (lib/ticketAccess.ts) behövt köra en egen query per rad enbart för
      // created_by, vilket återinför N+1.
      const placeholders = ids.map(() => '?').join(',');
      const existingRows = db.prepare(
        `SELECT ${TICKET_COLUMNS}, tickets.created_by FROM tickets WHERE id IN (${placeholders})`
      ).all(...ids) as (TicketRow & { created_by: string | null })[];
      const existingMap = new Map<string, TicketRow & { created_by: string | null }>(
        existingRows.map(row => [row.id, row])
      );

      for (const ticketId of ids) {
        const existing = existingMap.get(ticketId);
        if (!existing) continue;

        // Behörighetsfilter (matchar PUT /:id): samma skrivregel som canAccessTicket
        // ({ write: true }), men avgjord från den redan batchade `existing`-raden för
        // att undvika en extra query per ärende. Ärenden utan skrivrätt tas inte tyst
        // med — de rapporteras i `skipped`.
        if (!canWriteTicketRow(req, existing)) {
          skipped.push(ticketId);
          continue;
        }

        const safeUpdates: Record<string, unknown> = {};

        if (status !== undefined) {
          safeUpdates.status = status;
          if (status === 'resolved' && !existing.resolved_at) safeUpdates.resolved_at = now;
          if (status === 'closed' && !existing.closed_at) safeUpdates.closed_at = now;
          // Återöppnat ärende: rensa lösnings-/stängningstidpunkt.
          if (ACTIVE_STATUSES.includes(status)) {
            if (existing.resolved_at) safeUpdates.resolved_at = null;
            if (existing.closed_at) safeUpdates.closed_at = null;
          }
          if (status !== existing.status) {
            historyInsert.run(randomUUID(), ticketId, userId, 'status', existing.status as string, status);
            statusChanges.push({ id: ticketId, title: existing.title, from: existing.status, to: status });
          }
        }
        if (priority !== undefined) {
          safeUpdates.priority = priority;
          if (priority !== existing.priority) {
            historyInsert.run(randomUUID(), ticketId, userId, 'priority', existing.priority as string, priority);
          }
        }
        if (category_id !== undefined) {
          safeUpdates.category_id = category_id;
          if (safeUpdates.category_id !== existing.category_id) {
            const oldCat = existing.category_id ? (categoryLabelMap.get(existing.category_id) ?? null) : null;
            const newCat = category_id ? (categoryLabelMap.get(category_id) ?? null) : null;
            historyInsert.run(randomUUID(), ticketId, userId, 'category_id', oldCat, newCat);
          }
        }
        if (assigned_to !== undefined) {
          const newAssignee = assigned_to;
          safeUpdates.assigned_to = newAssignee;
          if (newAssignee !== existing.assigned_to) {
            historyInsert.run(
              randomUUID(),
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

      return { updatedCount, skipped, statusChanges };
    });

    const { updatedCount, skipped, statusChanges } = bulkUpdate();

    for (const change of statusChanges) {
      dispatchWebhook('ticket.status_changed', { id: change.id, title: change.title, old_status: change.from, status: change.to })
        .catch((e) => logger.error('Webhook dispatch error (ticket.status_changed):', { error: String(e) }));
    }

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

  if (!isIdArray(ids)) {
    return res.status(400).json({ error: 'ids must be a non-empty array of strings' });
  }
  if (ids.length > MAX_BULK_IDS) {
    return res.status(400).json({ error: 'För många ärenden i en batch (max 500)' });
  }

  try {
    const bulkDelete = db.transaction(() => {
      const deleted: { id: string; title: string }[] = [];
      const filePaths: string[] = [];

      // Pre-fetch alla filbilagor i en enda query för att undvika N+1
      const placeholders = ids.map(() => '?').join(',');
      const allAttachments = db.prepare(
        `SELECT ticket_id, file_path FROM ticket_attachments WHERE ticket_id IN (${placeholders})`
      ).all(...ids) as { ticket_id: string; file_path: string }[];
      const attachmentsByTicket = new Map<string, string[]>();
      for (const att of allAttachments) {
        const list = attachmentsByTicket.get(att.ticket_id) ?? [];
        list.push(att.file_path);
        attachmentsByTicket.set(att.ticket_id, list);
      }
      const titles = new Map(
        (db.prepare(`SELECT id, title FROM tickets WHERE id IN (${placeholders})`).all(...ids) as { id: string; title: string }[])
          .map((row) => [row.id, row.title])
      );

      for (const ticketId of ids) {
        // FTS5 rensas automatiskt via triggers (migration 050)
        const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);

        if (result.changes > 0) {
          deleted.push({ id: ticketId, title: titles.get(ticketId) ?? '' });
          // Filerna tas bort först efter commit (DB CASCADE hanterar relationstabellerna)
          filePaths.push(...(attachmentsByTicket.get(ticketId) ?? []));
        }
      }

      return { deleted, filePaths };
    });

    const { deleted, filePaths } = bulkDelete();
    removeUploadedFiles(filePaths);

    if (deleted.length > 0) {
      logAudit(req.user!.id, 'ticket_bulk_delete', 'ticket', null, `count: ${deleted.length}, ids: ${deleted.map((t) => t.id).join(',')}`, req.ip, req.apiKey?.id ?? null);
      for (const ticket of deleted) {
        dispatchWebhook('ticket.deleted', { id: ticket.id, title: ticket.title })
          .catch((e) => logger.error('Webhook dispatch error (ticket.deleted):', { error: String(e) }));
      }
    }

    // Concurrent-guard: `result.changes` per rad räknas exakt, så ärenden som
    // redan hunnit raderas av en samtidig operation (eller aldrig fanns) ger
    // changes=0 och räknas inte med — `deleted` är alltid det faktiska antalet
    // borttagna rader. Ett benignt race 500:ar alltså aldrig endpointen. Om
    // färre raderades än begärt rapporteras differensen i `alreadyGone`.
    const alreadyGone = ids.length - deleted.length;
    const response: { deleted: number; alreadyGone?: number } = { deleted: deleted.length };
    if (alreadyGone > 0) response.alreadyGone = alreadyGone;
    return res.json(response);
  } catch (error) {
    logger.error('Bulk delete error:', { error: String(error) });
    return res.status(500).json({ error: 'Failed to bulk delete tickets' });
  }
});

// Update ticket
router.put('/:id', writeRateLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  let { customFields } = req.body;
  const { template_id } = req.body;

  try {
    // Längdtak, enum- och FK-kontroller samt HTML-sanering. Bara fält som faktiskt
    // skickas valideras — undefined betyder "rör inte" i PUT-logiken nedan.
    const validation = validateTicketInput(req.body, { partial: true });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    const { title, description, status, priority, category_id, requester_id, company_id, assigned_to, notes, solution } = validation.value;

    const existing = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`).get(req.params.id) as TicketRow | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Authorization: admin, assignee or creator may edit (canAccessTicket, write).
    // Unassigned tickets stay open for self-service pickup — any authenticated agent
    // may claim/work a ticket sitting in the queue. This blocks a non-owner from
    // rewriting a ticket already assigned to a colleague.
    if (!canAccessTicket(req, req.params.id as string, { write: true })) {
      return res.status(403).json({ error: 'Du har inte behörighet att ändra detta ärende' });
    }

    if (customFields !== undefined || template_id !== undefined) {
      const normalized = customFields !== undefined
        ? normalizeTemplateValues(customFields)
        : db.prepare(`SELECT field_name AS fieldName, field_label AS fieldLabel,
            COALESCE(field_value, '') AS fieldValue FROM ticket_field_values WHERE ticket_id = ?`)
          .all(req.params.id) as TemplateFieldValue[];
      if (!normalized) return res.status(400).json({ error: 'Invalid custom fields' });
      const effectiveTemplateId = template_id !== undefined ? (template_id || null) : ((existing as TicketRow & { template_id: string | null }).template_id || null);
      const fieldErrors = missingRequiredTemplateFields(effectiveTemplateId, normalized);
      if (Object.keys(fieldErrors).length > 0) {
        return res.status(400).json({ error: 'Fyll i obligatoriska mallfält', fieldErrors });
      }
      if (customFields !== undefined) customFields = normalized;
    }

    // When customFields are provided, compose description from them (same logic as POST)
    let finalDescription: string | undefined = description;
    if (customFields && Array.isArray(customFields) && customFields.length > 0) {
      finalDescription = composeDescriptionFromFields(customFields);
      if (finalDescription.length > MAX_BODY_LENGTH) return res.status(400).json({ error: COMPOSED_DESCRIPTION_TOO_LONG });
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
    // Återöppnat ärende: rensa lösnings-/stängningstidpunkt.
    if (status !== undefined && ACTIVE_STATUSES.includes(status)) {
      if (existing.resolved_at) updates.resolved_at = null;
      if (existing.closed_at) updates.closed_at = null;
    }

    // Whitelist of allowed field names to prevent SQL injection
    const allowedFields = [
      'title', 'description', 'status', 'priority', 'category_id',
      'requester_id', 'company_id', 'assigned_to',
      'notes', 'solution', 'resolved_at', 'closed_at', 'updated_at', 'template_id',
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
        `INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
      );
      if ('status' in safeUpdates && safeUpdates.status !== existing.status) {
        historyInsert.run(randomUUID(), req.params.id, req.user!.id, 'status', existing.status as string, safeUpdates.status as string);
      }
      if ('priority' in safeUpdates && safeUpdates.priority !== existing.priority) {
        historyInsert.run(randomUUID(), req.params.id, req.user!.id, 'priority', existing.priority as string, safeUpdates.priority as string);
      }
      if ('category_id' in safeUpdates && safeUpdates.category_id !== existing.category_id) {
        const oldCat = existing.category_id
          ? (db.prepare('SELECT label FROM categories WHERE id = ?').get(existing.category_id) as { label: string } | undefined)?.label ?? null
          : null;
        const newCat = safeUpdates.category_id
          ? (db.prepare('SELECT label FROM categories WHERE id = ?').get(safeUpdates.category_id as string) as { label: string } | undefined)?.label ?? null
          : null;
        historyInsert.run(randomUUID(), req.params.id, req.user!.id, 'category_id', oldCat, newCat);
      }
      if ('assigned_to' in safeUpdates && safeUpdates.assigned_to !== existing.assigned_to) {
        const userLabel = (uid: string | null) => {
          if (!uid) return null;
          const u = db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(uid) as { email: string; display_name: string | null } | undefined;
          return u ? (u.display_name || u.email) : null;
        };
        historyInsert.run(
          randomUUID(),
          req.params.id,
          req.user!.id,
          'assigned_to',
          userLabel(existing.assigned_to as string | null),
          userLabel(safeUpdates.assigned_to as string | null),
        );
      }
      if ('title' in safeUpdates && safeUpdates.title !== existing.title) {
        historyInsert.run(randomUUID(), req.params.id, req.user!.id, 'title', null, null);
      }
      if ('notes' in safeUpdates && safeUpdates.notes !== existing.notes) {
        historyInsert.run(randomUUID(), req.params.id, req.user!.id, 'notes', null, null);
      }
      if ('solution' in safeUpdates && safeUpdates.solution !== existing.solution) {
        const isNew = !existing.solution && safeUpdates.solution;
        historyInsert.run(randomUUID(), req.params.id, req.user!.id, 'solution', null, isNew ? 'added' : 'updated');
      }

      // Replace field values when explicitly supplied, including an empty array.
      if (Array.isArray(customFields)) {
        db.prepare('DELETE FROM ticket_field_values WHERE ticket_id = ?').run(req.params.id);
        const insertFieldStmt = db.prepare(`
          INSERT INTO ticket_field_values (id, ticket_id, field_name, field_label, field_value, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        customFields.forEach((field: CustomFieldInput) => {
          if (field.fieldName && field.fieldLabel) {
            insertFieldStmt.run(randomUUID(), req.params.id, field.fieldName, field.fieldLabel, field.fieldValue || '', new Date().toISOString());
          }
        });
      }

      // FTS5 synkas automatiskt via triggers (migration 050)
    });

    updateTransaction();

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
            // Fire-and-forget — notification must not block the update response.
            sendTicketAssignedEmail({
              toEmail: assignee.email,
              toName: assignee.display_name || assignee.email.split('@')[0],
              ticketId: req.params.id as string,
              ticketTitle: existing.title,
              ticketPriority: (safeUpdates.priority as string) || existing.priority,
              assignerName: assigner?.display_name || assigner?.email?.split('@')[0] || 'System',
            }).catch((error) => logger.error('Assignee notification error (non-fatal):', { error: String(error) }));
          }
        }
      } catch (error) {
        logger.error('Assignee notification error (non-fatal):', { error: String(error) });
      }
    }

    const ticket = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`).get(req.params.id) as TicketRow;

    const warnings: string[] = [];

    // Dispatch webhook for ticket update. Payloaden är medvetet minimal: interna
    // anteckningar och lösningstext ska inte lämna systemet till externa URL:er.
    if ('status' in safeUpdates && safeUpdates.status !== existing.status) {
      dispatchWebhook('ticket.updated', {
        id: ticket.id,
        status: ticket.status,
        priority: ticket.priority,
        assigned_to: ticket.assigned_to,
        title: ticket.title,
        updated_fields: Object.keys(safeUpdates).filter((field) => field !== 'updated_at'),
      }).catch((e) => logger.error('Webhook dispatch error (ticket.updated):', { error: String(e) }));
      dispatchWebhook('ticket.status_changed', { id: ticket.id, title: ticket.title, old_status: existing.status, status: ticket.status })
        .catch((e) => logger.error('Webhook dispatch error (ticket.status_changed):', { error: String(e) }));

      if (safeUpdates.status === 'closed') {
        dispatchWebhook('ticket.closed', { id: req.params.id }).catch((e) => logger.error('Webhook dispatch error (ticket.closed):', { error: String(e) }));
      }
    }

    if (status === 'closed' && existing.status !== 'closed') {
      const requester = ticket.requester_id
        ? (db.prepare('SELECT name, email FROM contacts WHERE id = ?').get(ticket.requester_id) as { name: string; email: string } | undefined)
        : undefined;

      // Fire-and-forget — notification must not block the update response.
      sendTicketClosedEmail({
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        categoryId: ticket.category_id,
        requesterName: requester?.name,
        requesterEmail: requester?.email,
      }).catch((error) => logger.error('Error sending ticket closed email:', { error: String(error) }));
    }

    res.json({ ...ticket, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (error) {
    logger.error('Error updating ticket:', { error: String(error) });
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// Delete ticket
router.delete('/:id', writeRateLimiter, authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    // Hämta data för audit/webhook och filbilagor innan radering
    // FTS5 rensas automatiskt via triggers (migration 050)
    const ticket = db.prepare('SELECT title FROM tickets WHERE id = ?').get(req.params.id) as { title: string } | undefined;
    const attachments = db.prepare(
      'SELECT file_path FROM ticket_attachments WHERE ticket_id = ?'
    ).all(req.params.id) as { file_path: string }[];

    const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Clean up attachment files from disk (DB relations cascade automatically)
    removeUploadedFiles(attachments.map((attachment) => attachment.file_path));

    logAudit(req.user!.id, 'ticket_delete', 'ticket', req.params.id, `title: ${ticket?.title ?? ''}`, req.ip, req.apiKey?.id ?? null);
    dispatchWebhook('ticket.deleted', { id: req.params.id, title: ticket?.title ?? '' })
      .catch((e) => logger.error('Webhook dispatch error (ticket.deleted):', { error: String(e) }));

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

    // Ogiltigt datum ger NaN, och NaN <= now är false — kontrollera uttryckligen.
    const reminderDate = new Date(reminder_time);
    if (Number.isNaN(reminderDate.getTime())) {
      return res.status(400).json({ error: 'Invalid reminder time' });
    }

    // Validate future time
    if (reminderDate <= new Date()) {
      return res.status(400).json({ error: 'Reminder must be in the future' });
    }

    if (message != null && (typeof message !== 'string' || message.length > MAX_REMINDER_MESSAGE_LENGTH)) {
      return res.status(400).json({ error: 'Message must be 500 characters or less' });
    }

    // Skrivbehörighet: admin, tilldelad, skapare eller otilldelat ärende.
    const t = db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(ticketId);
    if (!t) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    if (!canAccessTicket(req, ticketId, { write: true })) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }

    const id = randomUUID();
    db.prepare(`
      INSERT INTO ticket_reminders (id, ticket_id, user_id, reminder_time, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, ticketId, userId, reminderDate.toISOString(), message || null, new Date().toISOString());

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
    const ticketId = req.params.id;

    // Läsning är öppen för alla inloggade.
    const t = db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(ticketId);
    if (!t) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const reminders = db.prepare(`
      SELECT tr.id, tr.ticket_id, tr.user_id, tr.reminder_time, tr.message, tr.sent, tr.created_at, tr.sent_at,
             u.display_name as user_name, u.email as user_email
      FROM ticket_reminders tr
      JOIN users u ON tr.user_id = u.id
      WHERE tr.ticket_id = ?
      ORDER BY tr.reminder_time ASC
    `).all(ticketId);

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

    // Skrivbehörighet: admin, tilldelad, skapare eller otilldelat ärende.
    const t = db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(ticketId);
    if (!t) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    if (!canAccessTicket(req, ticketId, { write: true })) {
      return res.status(403).json({ error: 'Du har inte behörighet till detta ärende' });
    }

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
    const { id: ticketId, reminderId } = req.params;
    const userId = req.user!.id;

    // Påminnelsen måste tillhöra ärendet i URL:en.
    const reminder = db.prepare(
      'SELECT id, ticket_id, user_id, reminder_time, message, sent, created_at, sent_at FROM ticket_reminders WHERE id = ? AND ticket_id = ?'
    ).get(reminderId, ticketId) as { id: string; ticket_id: string; user_id: string; reminder_time: string; message: string | null; sent: number; created_at: string; sent_at: string | null } | undefined;

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    // Only allow users to delete their own reminders (or admins)
    if (reminder.user_id !== userId && !isEffectiveAdmin(req)) {
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
