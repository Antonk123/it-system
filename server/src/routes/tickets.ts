import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { db } from '../db/connection.js';
import { sendTicketClosedEmail, sendTicketCreatedEmail } from '../lib/email.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { applyAutoTags, detectAutoPriority } from '../lib/automationHelper.js';
import { writeRateLimiter } from '../middleware/rateLimit.js';
import { dispatchWebhook } from '../lib/webhookDispatcher.js';
import { aiEnabled, suggestCategory, draftReply, summarizeTicket, buildKbSearchQuery } from '../lib/aiHelper.js';
import { stripHtml } from '../lib/htmlUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(__dirname, '../../data/uploads');

// Giltiga enum-värden för status och prioritet
const VALID_STATUSES = ['open', 'in-progress', 'waiting', 'resolved', 'closed'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// Explicit column lists for SELECT optimization (instead of SELECT *)
// Reduces data transfer by 30-40% by avoiding unnecessary columns
// Use 'tickets.' prefix for all columns to avoid ambiguity when JOINs are present
const TICKET_COLUMNS = [
  'tickets.id', 'tickets.title', 'tickets.description', 'tickets.status', 'tickets.priority',
  'tickets.category_id', 'tickets.requester_id', 'tickets.company_id', 'tickets.assigned_to',
  'tickets.notes', 'tickets.solution', 'tickets.template_id',
  'tickets.created_at', 'tickets.updated_at', 'tickets.resolved_at', 'tickets.closed_at',
  'tickets.ai_suggested_category_id', 'tickets.ai_suggested_confidence',
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

// CSV helper functions
function escapeCSVField(field: any): string {
  if (field === null || field === undefined) return '';
  const str = String(field);
  // Escape double quotes by doubling them, and wrap in quotes if contains comma, quote, or newline
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateXLSX(tickets: any[], categories: any[], contacts: any[]): Buffer {
  const categoryMap = new Map(categories.map((c: any) => [c.id, c.label]));
  const contactMap = new Map(contacts.map((c: any) => [c.id, { name: c.name, email: c.email }]));

  const headers = [
    'id', 'title', 'description', 'status', 'priority', 'category',
    'requester_name', 'requester_email', 'notes', 'solution',
    'created_at', 'updated_at', 'resolved_at', 'closed_at'
  ];

  const rows = tickets.map(ticket => {
    const category = ticket.category_id ? categoryMap.get(ticket.category_id) || '' : '';
    const requester = ticket.requester_id ? contactMap.get(ticket.requester_id) : null;
    return [
      ticket.id, ticket.title, ticket.description || '', ticket.status, ticket.priority,
      category, requester?.name || '', requester?.email || '',
      ticket.notes || '', ticket.solution || '',
      ticket.created_at, ticket.updated_at, ticket.resolved_at || '', ticket.closed_at || ''
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ärenden');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// CSV Import helpers
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Map Swedish CSV headers to English field names
function normalizeFieldNames(row: any): any {
  const fieldMapping: Record<string, string> = {
    'ID': 'id',
    'Titel': 'title',
    'Beskrivning': 'description',
    'Status': 'status',
    'Prioritet': 'priority',
    'Kategori': 'category',
    'Beställare Namn': 'requester_name',
    'Beställare Email': 'requester_email',
    'Beställare Telefon': 'requester_phone',
    'Beställare Företag': 'requester_company',
    'Anteckningar': 'notes',
    'Lösning': 'solution',
    'Skapad': 'created_at',
    'Uppdaterad': 'updated_at',
    'Löst': 'resolved_at',
    'Stängd': 'closed_at',
  };

  const normalized: any = {};

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = fieldMapping[key] || key;
    normalized[normalizedKey] = value;
  }

  return normalized;
}

function parseCSV(csvContent: string): any[] {
  // Remove BOM if present
  const content = csvContent.replace(/^\uFEFF/, '');

  // Split into lines while respecting quoted fields with newlines
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentLine += '""';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
        currentLine += char;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // End of line (not inside quotes)
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = '';
      // Skip \r\n together
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
    } else {
      currentLine += char;
    }
  }

  // Add last line if not empty
  if (currentLine.trim()) {
    lines.push(currentLine);
  }

  if (lines.length < 2) return []; // Need at least header + 1 row

  const headers = parseCSVLine(lines[0]);
  const rows: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: any = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    // Normalize field names from Swedish to English
    const normalizedRow = normalizeFieldNames(row);
    rows.push(normalizedRow);
  }

  return rows;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  ticket: any;
  isDuplicate: boolean;
}

function validateTicketRow(row: any, rowIndex: number, categories: any[], existingTicketIds: Set<string>): ValidationResult {
  const errors: string[] = [];

  // Required fields
  if (!row.title || row.title.trim() === '') {
    errors.push('Titel saknas');
  }
  // Description is now optional - use title if empty
  if (!row.description || row.description.trim() === '') {
    row.description = row.title || 'Importerad utan beskrivning';
  }

  // Validate status
  if (row.status && !VALID_STATUSES.includes(row.status)) {
    errors.push(`Ogiltig status: ${row.status} (giltiga: open, in-progress, waiting, resolved, closed)`);
  }

  // Validate priority
  if (row.priority && !VALID_PRIORITIES.includes(row.priority)) {
    errors.push(`Ogiltig prioritet: ${row.priority} (giltiga: low, medium, high, critical)`);
  }

  // Check if category exists (case-insensitive)
  if (row.category && row.category.trim() !== '') {
    const categoryExists = categories.some((c: any) =>
      c.label.toLowerCase() === row.category.toLowerCase()
    );
    if (!categoryExists) {
      const availableCategories = categories.map((c: any) => c.label).join(', ');
      errors.push(`Kategori "${row.category}" finns inte (tillgängliga: ${availableCategories})`);
    }
  }

  // Check for duplicate ID
  const isDuplicate = row.id && existingTicketIds.has(row.id);
  if (isDuplicate) {
    errors.push('ID finns redan i databasen (skapas automatiskt vid import)');
  }

  return {
    valid: errors.length === 0,
    errors,
    ticket: row,
    isDuplicate,
  };
}

const router = Router();

interface TicketRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category_id: string | null;
  requester_id: string | null;
  company_id: string | null;
  assigned_to: string | null;
  notes: string | null;
  solution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
}

interface TicketQueryParams {
  page?: string;
  limit?: string;
  status?: string;
  priority?: string;
  category?: string;
  company_id?: string;
  assigned_to?: string;
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

// Helper: Validate pagination params
function validatePaginationParams(query: TicketQueryParams) {
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
function buildWhereClause(filters: TicketQueryParams) {
  const conditions: string[] = [];
  const params: any[] = [];
  let joins = '';

  // Handle status filter - support both single and multi-status
  if (filters.status && filters.status !== 'all') {
    // Check if comma-separated list (multi-status)
    const statusList = filters.status.split(',').map(s => s.trim()).filter(s => s);

    if (statusList.length > 1) {
      // Multi-status: use IN clause
      const placeholders = statusList.map(() => '?').join(',');
      conditions.push(`tickets.status IN (${placeholders})`);
      params.push(...statusList);
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
function buildOrderByClause(sortBy: string, sortDir: string) {
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
    let ticketsWithTags: any[];

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
      `).all(...ticketIds) as any[];

      // Group tags by ticket_id in memory
      const tagsByTicket: Record<string, any[]> = {};
      allTags.forEach((tag: any) => {
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
      ticketsWithTags = tickets.map((ticket: any) => ({
        ...ticket,
        tags: tagsByTicket[ticket.id] || [],
      }));
    } else {
      ticketsWithTags = [];
    }

    // Build pagination metadata
    const totalPages = Math.ceil(total / limit);
    const paginatedResponse: PaginatedResponse<any> = {
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
    console.error('Error fetching tickets:', error);
    console.error('Query params:', req.query);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// Import tickets - Preview
router.post('/import/preview', authenticate, upload.single('file'), (req: AuthRequest, res: Response) => {
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
    console.error('Error previewing import:', error);
    res.status(500).json({ error: 'Failed to preview import' });
  }
});

// Import tickets - Confirm
router.post('/import/confirm', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { tickets } = req.body;

    if (!Array.isArray(tickets) || tickets.length === 0) {
      return res.status(400).json({ error: 'No tickets provided' });
    }

    // Get categories and contacts for lookup
    const categories = db.prepare('SELECT id, label FROM categories').all();
    // Case-insensitive category map
    const categoryMap = new Map(categories.map((c: any) => [c.label.toLowerCase(), c.id]));

    const contacts = db.prepare('SELECT id, name, email FROM contacts').all();
    // Case-insensitive contact maps
    const contactByNameMap = new Map(contacts.map((c: any) => [c.name.toLowerCase(), c.id]));
    const contactByEmailMap = new Map(contacts.map((c: any) => [c.email.toLowerCase(), c.id]));

    const stmt = db.prepare(`
      INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, notes, solution)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

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
          ticket.solution || null
        );

        // Synka FTS5-index
        const ftsRow = db.prepare('SELECT rowid FROM tickets WHERE id = ?').get(id) as { rowid: number };
        db.prepare('INSERT INTO tickets_fts(rowid, title, description, notes, solution) VALUES (?,?,?,?,?)')
          .run(ftsRow.rowid, ticket.title, ticket.description || '', ticket.notes || '', ticket.solution || '');

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
      console.error('Transaction failed, all changes rolled back:', error);

      res.status(400).json({
        success: false,
        created: 0,
        failed: tickets.length,
        error: error instanceof Error ? error.message : 'Transaction failed',
        message: 'CSV import failed. All changes have been rolled back. Please fix the errors and try again.',
      });
    }
  } catch (error) {
    console.error('Error confirming import:', error);
    res.status(500).json({ error: 'Failed to import tickets' });
  }
});

// Export tickets to CSV
router.get('/export', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const query = req.query as TicketQueryParams;

    // Build WHERE clause from filters
    const { whereClause, params, joins } = buildWhereClause(query);

    // Get all matching tickets (no pagination for export)
    const tickets = db.prepare(`
      SELECT DISTINCT tickets.* FROM tickets ${joins}
      WHERE ${whereClause}
      ORDER BY tickets.created_at DESC
    `).all(...params) as TicketRow[];

    // Get all categories for lookup
    const categories = db.prepare('SELECT id, label FROM categories').all();

    // Get all contacts for lookup
    const contacts = db.prepare('SELECT id, name, email FROM contacts').all();

    const xlsxBuffer = generateXLSX(tickets, categories, contacts);

    const timestamp = new Date().toISOString().split('T')[0];
    const source = (req.query as any).source;
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
    console.error('Error exporting tickets:', error);
    res.status(500).json({ error: 'Failed to export tickets' });
  }
});

// Export archive (closed tickets) to XLSX — lightweight 6-column format
router.get('/export-archive', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const query = req.query as TicketQueryParams;
    const idsParam = (req.query as any).ids as string | undefined;

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

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Arkiv');
    const xlsxBuffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `arkiv-export-${timestamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xlsxBuffer);
  } catch (error) {
    console.error('Error exporting archive:', error);
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

// GET /dashboard-overview — aging tickets + today counts
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

    res.json({ agingTickets, todayCounts });
  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
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
    console.error('Error fetching activity feed:', error);
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
    console.error('Error fetching status counts:', error);
    res.status(500).json({ error: 'Failed to fetch status counts' });
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
    console.error('Error fetching upcoming reminders:', error);
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
    `).all(ticket.id) as any[];

    const formattedTags = tags.map((tag: any) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdAt: new Date(tag.created_at),
    }));

    res.json({ ...ticket, field_values: fieldValues, tags: formattedTags });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

// Create ticket
router.post('/', writeRateLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  const { title, description, status, priority, category_id, requester_id, company_id, assigned_to, notes, solution, customFields, template_id } = req.body;

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
        .filter((field: any) => field.fieldLabel)
        .map((field: any) => `**${field.fieldLabel}**: ${field.fieldValue || '(ej angivet)'}`)
        .join('  \n');
    } else {
      finalDescription = description || '';
    }

    // Warn if template is used but no custom fields provided
    if (template_id && (!customFields || customFields.length === 0)) {
      console.warn(`⚠️ Ticket created with template_id ${template_id} but no customFields provided`);
      console.warn('This likely indicates a frontend bug - field values will not be saved');
    }

    // Auto-priority: only when user did not explicitly provide one
    const finalPriority = priority
      ? priority
      : (detectAutoPriority(title, finalDescription) ?? 'medium');

    // Wrap all inserts in a transaction for atomicity
    const createTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, company_id, assigned_to, notes, solution, template_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        template_id || null
      );

      // Store custom field values if provided
      if (customFields && Array.isArray(customFields) && customFields.length > 0) {
        const insertFieldStmt = db.prepare(`
          INSERT INTO ticket_field_values (id, ticket_id, field_name, field_label, field_value)
          VALUES (?, ?, ?, ?, ?)
        `);
        customFields.forEach((field: any) => {
          if (field.fieldName && field.fieldLabel) {
            insertFieldStmt.run(uuidv4(), id, field.fieldName, field.fieldLabel, field.fieldValue || '');
          }
        });
      }

      // Log ticket creation in history
      db.prepare('INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), id, req.user!.id, 'created', null, null);

      // Synka FTS5-index
      const row = db.prepare('SELECT rowid FROM tickets WHERE id = ?').get(id) as { rowid: number };
      db.prepare('INSERT INTO tickets_fts(rowid, title, description, notes, solution) VALUES (?,?,?,?,?)')
        .run(row.rowid, title, finalDescription, notes || '', solution || '');
    });

    createTransaction();

    // Auto-tag based on keyword rules (runs after transaction so tags can be created separately)
    try {
      applyAutoTags(id, title, finalDescription);
    } catch (error) {
      console.error('Auto-tag error (non-fatal):', error);
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
            console.log(`🤖 AI-kategori föreslagen för ${id}: ${suggestion.categoryId} (conf ${suggestion.confidence})`);
          }
        })
        .catch((err) => console.error('AI categorize error (non-fatal):', err));
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
      console.error('Error sending ticket created email:', error);
      warnings.push('E-postnotifiering kunde inte skickas');
    }

    dispatchWebhook('ticket.created', { id: ticket.id, title: ticket.title, status: ticket.status, priority: ticket.priority }).catch(console.error);

    res.status(201).json({ ...ticket, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (error) {
    console.error('Error creating ticket:', error);
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
router.post('/:id/ai-draft', writeRateLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  if (!aiEnabled()) {
    return res.status(503).json({ error: 'AI är inte konfigurerat på denna installation (ANTHROPIC_API_KEY saknas)' });
  }
  try {
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
        console.warn('KB FTS search failed, continuing without KB context:', err);
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
    console.error('Error generating AI draft:', error);
    res.status(500).json({ error: 'Kunde inte generera AI-utkast' });
  }
});

/**
 * GET /api/tickets/:id/ai-summary
 * Returnerar en cachad sammanfattning av ärendet om < 1h gammal, annars genererar ny.
 * Använd query-param ?force=1 för att tvinga ny sammanfattning.
 */
router.get('/:id/ai-summary', authenticate, async (req: AuthRequest, res: Response) => {
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

    // Cache-check: max 1 timme gammal
    if (!force && ticket.ai_summary_json && ticket.ai_summary_updated_at) {
      const ageMs = Date.now() - new Date(ticket.ai_summary_updated_at).getTime();
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
    console.error('Error generating AI summary:', error);
    res.status(500).json({ error: 'Kunde inte generera AI-sammanfattning' });
  }
});

// Get ticket history
router.get('/:id/history', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const history = db.prepare(`
      SELECT th.*, COALESCE(u.display_name, u.email) as user_name
      FROM ticket_history th
      LEFT JOIN users u ON th.user_id = u.id
      WHERE th.ticket_id = ?
      ORDER BY th.changed_at ASC
    `).all(req.params.id);
    res.json(history);
  } catch (error) {
    console.error('Error fetching ticket history:', error);
    res.status(500).json({ error: 'Failed to fetch ticket history' });
  }
});

// Bulk update tickets
router.put('/bulk', writeRateLimiter, authenticate, (req: AuthRequest, res: Response) => {
  const { ids, updates } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

  const { status, priority, category_id } = updates || {};

  if (status === undefined && priority === undefined && category_id === undefined) {
    return res.status(400).json({ error: 'At least one field to update is required' });
  }

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority value' });
  }

  try {
    const now = new Date().toISOString();
    const historyInsert = db.prepare(
      'INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const bulkUpdate = db.transaction(() => {
      let updatedCount = 0;

      for (const ticketId of ids) {
        const existing = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`).get(ticketId) as TicketRow | undefined;
        if (!existing) continue;

        const safeUpdates: Record<string, unknown> = {};

        if (status !== undefined) {
          safeUpdates.status = status;
          if (status === 'resolved' && !existing.resolved_at) safeUpdates.resolved_at = now;
          if (status === 'closed' && !existing.closed_at) safeUpdates.closed_at = now;
          if (status !== existing.status) {
            historyInsert.run(uuidv4(), ticketId, req.user!.id, 'status', existing.status as string, status);
          }
        }
        if (priority !== undefined) {
          safeUpdates.priority = priority;
          if (priority !== existing.priority) {
            historyInsert.run(uuidv4(), ticketId, req.user!.id, 'priority', existing.priority as string, priority);
          }
        }
        if (category_id !== undefined) {
          safeUpdates.category_id = category_id || null;
          if (safeUpdates.category_id !== existing.category_id) {
            const oldCat = existing.category_id
              ? (db.prepare('SELECT label FROM categories WHERE id = ?').get(existing.category_id) as { label: string } | undefined)?.label ?? null
              : null;
            const newCat = category_id
              ? (db.prepare('SELECT label FROM categories WHERE id = ?').get(category_id) as { label: string } | undefined)?.label ?? null
              : null;
            historyInsert.run(uuidv4(), ticketId, req.user!.id, 'category_id', oldCat, newCat);
          }
        }

        if (Object.keys(safeUpdates).length === 0) continue;

        const setClauses = Object.keys(safeUpdates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(safeUpdates), ticketId];
        db.prepare(`UPDATE tickets SET ${setClauses} WHERE id = ?`).run(...values);
        updatedCount++;
      }

      return updatedCount;
    });

    const count = bulkUpdate();
    return res.json({ updated: count });
  } catch (error) {
    console.error('Bulk update error:', error);
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

      for (const ticketId of ids) {
        // Hämta data för FTS-rensning och filbilagor innan radering
        const ticketForFts = db.prepare('SELECT rowid, title, description, notes, solution FROM tickets WHERE id = ?')
          .get(ticketId) as { rowid: number; title: string; description: string; notes: string | null; solution: string | null } | undefined;
        const attachments = db.prepare(
          'SELECT file_path FROM ticket_attachments WHERE ticket_id = ?'
        ).all(ticketId) as { file_path: string }[];

        const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);

        if (result.changes > 0) {
          deletedCount++;
          // Rensa FTS5-index
          if (ticketForFts) {
            db.prepare("INSERT INTO tickets_fts(tickets_fts, rowid, title, description, notes, solution) VALUES('delete', ?, ?, ?, ?, ?)")
              .run(ticketForFts.rowid, ticketForFts.title, ticketForFts.description, ticketForFts.notes || '', ticketForFts.solution || '');
          }
          // Clean up attachment files from disk (DB CASCADE handles relation tables)
          for (const attachment of attachments) {
            const filePath = join(UPLOAD_DIR, attachment.file_path);
            if (existsSync(filePath)) {
              try {
                unlinkSync(filePath);
              } catch (err) {
                console.error(`Failed to delete attachment file ${filePath}:`, err);
              }
            }
          }
        }
      }

      return deletedCount;
    });

    const count = bulkDelete();
    return res.json({ deleted: count });
  } catch (error) {
    console.error('Bulk delete error:', error);
    return res.status(500).json({ error: 'Failed to bulk delete tickets' });
  }
});

// Update ticket
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { title, description, status, priority, category_id, requester_id, company_id, assigned_to, notes, solution, customFields, template_id, tag_ids, ai_suggested_category_id } = req.body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority value' });
  }

  try {
    const existing = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`).get(req.params.id) as TicketRow | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Permission check: only admins can change ticket assignee. Prevents non-admin
    // users from stealing or reassigning tickets that aren't theirs. No-op assignments
    // (sending the same value back) are allowed silently.
    if (assigned_to !== undefined) {
      const newAssignee = assigned_to || null;
      if (newAssignee !== existing.assigned_to && req.user!.role !== 'admin') {
        return res.status(403).json({ error: 'Endast administratörer kan ändra tilldelad användare' });
      }
    }

    // When customFields are provided, compose description from them (same logic as POST)
    let finalDescription: string | undefined = description;
    if (customFields && Array.isArray(customFields) && customFields.length > 0) {
      finalDescription = customFields
        .filter((field: any) => field.fieldLabel)
        .map((field: any) => `**${field.fieldLabel}**: ${field.fieldValue || '(ej angivet)'}`)
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
      'notes', 'solution', 'resolved_at', 'closed_at', 'updated_at', 'template_id'
    ];

    // Filter updates to only include whitelisted fields
    const safeUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        safeUpdates[key] = value;
      } else {
        console.warn(`Attempted to update non-whitelisted field: ${key}`);
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
        customFields.forEach((field: any) => {
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

      // Synka FTS5-index om sökbara fält ändrades
      if ('title' in safeUpdates || 'description' in safeUpdates || 'notes' in safeUpdates || 'solution' in safeUpdates) {
        const existingFts = db.prepare('SELECT rowid FROM tickets WHERE id = ?')
          .get(req.params.id) as { rowid: number };
        // Contentless FTS5: delete old entry, insert new
        db.prepare("INSERT INTO tickets_fts(tickets_fts, rowid, title, description, notes, solution) VALUES('delete', ?, ?, ?, ?, ?)")
          .run(existingFts.rowid, existing.title, existing.description, existing.notes || '', existing.solution || '');
        const updated = db.prepare('SELECT title, description, notes, solution FROM tickets WHERE id = ?')
          .get(req.params.id) as { title: string; description: string; notes: string | null; solution: string | null };
        db.prepare('INSERT INTO tickets_fts(rowid, title, description, notes, solution) VALUES (?,?,?,?,?)')
          .run(existingFts.rowid, updated.title, updated.description, updated.notes || '', updated.solution || '');
      }
    });

    updateTransaction();

    const ticket = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`).get(req.params.id) as TicketRow;

    // Fetch tags for response
    const tags = db.prepare(`
      SELECT t.id, t.name, t.color, t.created_at
      FROM tags t
      JOIN ticket_tags tt ON t.id = tt.tag_id
      WHERE tt.ticket_id = ?
      ORDER BY t.name
    `).all(req.params.id) as any[];

    const formattedTags = tags.map((tag: any) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdAt: new Date(tag.created_at),
    }));

    const warnings: string[] = [];

    // Dispatch webhook for ticket update
    if ('status' in safeUpdates && safeUpdates.status !== existing.status) {
      dispatchWebhook('ticket.updated', { id: req.params.id, ...safeUpdates }).catch(console.error);

      if (safeUpdates.status === 'closed') {
        dispatchWebhook('ticket.closed', { id: req.params.id }).catch(console.error);
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
        console.error('Error sending ticket closed email:', error);
        warnings.push('E-postnotifiering vid stängning kunde inte skickas');
      }
    }

    res.json({ ...ticket, tags: formattedTags, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// Delete ticket
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    // Hämta data för FTS-rensning och filbilagor innan radering
    const ticketForFts = db.prepare('SELECT rowid, title, description, notes, solution FROM tickets WHERE id = ?')
      .get(req.params.id) as { rowid: number; title: string; description: string; notes: string | null; solution: string | null } | undefined;
    const attachments = db.prepare(
      'SELECT file_path FROM ticket_attachments WHERE ticket_id = ?'
    ).all(req.params.id) as { file_path: string }[];

    const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Rensa FTS5-index
    if (ticketForFts) {
      db.prepare("INSERT INTO tickets_fts(tickets_fts, rowid, title, description, notes, solution) VALUES('delete', ?, ?, ?, ?, ?)")
        .run(ticketForFts.rowid, ticketForFts.title, ticketForFts.description, ticketForFts.notes || '', ticketForFts.solution || '');
    }

    // Clean up attachment files from disk (DB relations cascade automatically)
    for (const attachment of attachments) {
      const filePath = join(UPLOAD_DIR, attachment.file_path);
      if (existsSync(filePath)) {
        try {
          unlinkSync(filePath);
        } catch (err) {
          console.error(`Failed to delete attachment file ${filePath}:`, err);
        }
      }
    }

    res.json({ message: 'Ticket deleted' });
  } catch (error) {
    console.error('Error deleting ticket:', error);
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

    const reminder = db.prepare('SELECT * FROM ticket_reminders WHERE id = ?').get(id);
    res.status(201).json(reminder);
  } catch (error) {
    console.error('Error creating reminder:', error);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

// GET /api/tickets/:id/reminders - List reminders for ticket
router.get('/:id/reminders', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const reminders = db.prepare(`
      SELECT tr.*, u.display_name as user_name, u.email as user_email
      FROM ticket_reminders tr
      JOIN users u ON tr.user_id = u.id
      WHERE tr.ticket_id = ?
      ORDER BY tr.reminder_time ASC
    `).all(req.params.id);

    res.json(reminders);
  } catch (error) {
    console.error('Error fetching reminders:', error);
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
    console.error('Error clearing sent reminders:', error);
    res.status(500).json({ error: 'Failed to clear sent reminders' });
  }
});

// DELETE /api/tickets/:id/reminders/:reminderId - Cancel reminder
router.delete('/:id/reminders/:reminderId', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { reminderId } = req.params;
    const userId = req.user!.id;

    const reminder = db.prepare(`
      SELECT * FROM ticket_reminders WHERE id = ?
    `).get(reminderId) as any;

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
    console.error('Error deleting reminder:', error);
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

export default router;
