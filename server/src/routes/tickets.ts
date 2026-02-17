import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { db } from '../db/connection.js';
import { sendTicketClosedEmail, sendTicketCreatedEmail } from '../lib/email.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

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

function generateCSV(tickets: any[], categories: any[], contacts: any[]): string {
  // Create lookup maps for performance
  const categoryMap = new Map(categories.map((c: any) => [c.id, c.label]));
  const contactMap = new Map(contacts.map((c: any) => [c.id, { name: c.name, email: c.email }]));

  // CSV Header with BOM for Excel UTF-8 compatibility
  const BOM = '\uFEFF';
  const headers = [
    'id', 'title', 'description', 'status', 'priority', 'category',
    'requester_name', 'requester_email', 'notes', 'solution',
    'created_at', 'updated_at', 'resolved_at', 'closed_at'
  ];

  let csv = BOM + headers.join(',') + '\n';

  // Add rows
  for (const ticket of tickets) {
    const category = ticket.category_id ? categoryMap.get(ticket.category_id) || '' : '';
    const requester = ticket.requester_id ? contactMap.get(ticket.requester_id) : null;

    const row = [
      escapeCSVField(ticket.id),
      escapeCSVField(ticket.title),
      escapeCSVField(ticket.description),
      escapeCSVField(ticket.status),
      escapeCSVField(ticket.priority),
      escapeCSVField(category),
      escapeCSVField(requester?.name || ''),
      escapeCSVField(requester?.email || ''),
      escapeCSVField(ticket.notes),
      escapeCSVField(ticket.solution),
      escapeCSVField(ticket.created_at),
      escapeCSVField(ticket.updated_at),
      escapeCSVField(ticket.resolved_at),
      escapeCSVField(ticket.closed_at)
    ];

    csv += row.join(',') + '\n';
  }

  return csv;
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
  const validStatuses = ['open', 'in-progress', 'waiting', 'resolved', 'closed'];
  const validPriorities = ['low', 'medium', 'high', 'critical'];

  // Required fields
  if (!row.title || row.title.trim() === '') {
    errors.push('Titel saknas');
  }
  // Description is now optional - use title if empty
  if (!row.description || row.description.trim() === '') {
    row.description = row.title || 'Importerad utan beskrivning';
  }

  // Validate status
  if (row.status && !validStatuses.includes(row.status)) {
    errors.push(`Ogiltig status: ${row.status} (giltiga: open, in-progress, waiting, resolved, closed)`);
  }

  // Validate priority
  if (row.priority && !validPriorities.includes(row.priority)) {
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
  search?: string;
  sortBy?: string;
  sortDir?: string;
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
  const allowedLimits = [20, 25, 50, 100];
  const limit = allowedLimits.includes(parseInt(query.limit || '50'))
    ? parseInt(query.limit!)
    : 50;
  const sortBy = ['createdAt', 'status', 'priority', 'category'].includes(query.sortBy || '')
    ? query.sortBy!
    : 'createdAt';
  const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';

  return { page, limit, sortBy, sortDir };
}

// Helper: Build WHERE clause
function buildWhereClause(filters: TicketQueryParams) {
  const conditions: string[] = [];
  const params: any[] = [];

  // Handle status filter
  if (filters.status && filters.status !== 'all') {
    conditions.push('status = ?');
    params.push(filters.status);
  } else if (!filters.status) {
    // Default behavior: exclude closed tickets if no status specified
    conditions.push("status != 'closed'");
  }

  if (filters.priority && filters.priority !== 'all') {
    conditions.push('priority = ?');
    params.push(filters.priority);
  }

  if (filters.category && filters.category !== 'all') {
    conditions.push('category_id = ?');
    params.push(filters.category);
  }

  if (filters.search) {
    conditions.push('(title LIKE ? OR description LIKE ?)');
    const pattern = `%${filters.search}%`;
    params.push(pattern, pattern);
  }

  // If no conditions, return '1=1' to make valid SQL
  const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  return { whereClause, params };
}

// Helper: Build ORDER BY clause
function buildOrderByClause(sortBy: string, sortDir: string) {
  const dir = sortDir.toUpperCase();

  switch (sortBy) {
    case 'status':
      return `CASE status
        WHEN 'open' THEN 0
        WHEN 'in-progress' THEN 1
        WHEN 'waiting' THEN 2
        WHEN 'resolved' THEN 3
        WHEN 'closed' THEN 4
      END ${dir}`;
    case 'priority':
      return `CASE priority
        WHEN 'low' THEN 0
        WHEN 'medium' THEN 1
        WHEN 'high' THEN 2
        WHEN 'critical' THEN 3
      END ${dir}`;
    case 'category':
      return `category_id ${dir}`;
    default:
      return `created_at ${dir}`;
  }
}

// Get all tickets
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const query = req.query as TicketQueryParams;

    // Check if pagination is requested
    const usePagination = query.page || query.limit;

    if (!usePagination) {
      // BACKWARD COMPATIBILITY: Return old format
      const tickets = db.prepare(`
        SELECT * FROM tickets ORDER BY created_at DESC
      `).all() as TicketRow[];
      return res.json(tickets);
    }

    // NEW: Paginated response
    const { page, limit, sortBy, sortDir } = validatePaginationParams(query);
    const { whereClause, params } = buildWhereClause(query);
    const orderByClause = buildOrderByClause(sortBy, sortDir);

    // Get total count
    const countResult = db.prepare(`
      SELECT COUNT(*) as total FROM tickets WHERE ${whereClause}
    `).get(...params) as { total: number };
    const total = countResult.total;

    // Get paginated data
    const offset = (page - 1) * limit;
    const tickets = db.prepare(`
      SELECT * FROM tickets
      WHERE ${whereClause}
      ORDER BY ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as TicketRow[];

    // Build pagination metadata
    const totalPages = Math.ceil(total / limit);
    const paginatedResponse: PaginatedResponse<TicketRow> = {
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
    console.error('Error fetching tickets:', error);
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

    console.log('Valid tickets:', valid.length);
    console.log('Invalid tickets:', invalid.length);
    console.log('======================');

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

    // DEBUG: Log received tickets
    console.log('=== IMPORT CONFIRM DEBUG ===');
    console.log('Received tickets count:', tickets.length);
    console.log('First ticket:', JSON.stringify(tickets[0], null, 2));

    // Get categories and contacts for lookup
    const categories = db.prepare('SELECT id, label FROM categories').all();
    // Case-insensitive category map
    const categoryMap = new Map(categories.map((c: any) => [c.label.toLowerCase(), c.id]));

    const contacts = db.prepare('SELECT id, name, email FROM contacts').all();
    // Case-insensitive contact maps
    const contactByNameMap = new Map(contacts.map((c: any) => [c.name.toLowerCase(), c.id]));
    const contactByEmailMap = new Map(contacts.map((c: any) => [c.email.toLowerCase(), c.id]));

    console.log('Category map keys:', Array.from(categoryMap.keys()));
    console.log('Contact name map keys:', Array.from(contactByNameMap.keys()));
    console.log('Contact email map keys:', Array.from(contactByEmailMap.keys()));

    let created = 0;
    let failed = 0;
    const errors: string[] = [];

    const stmt = db.prepare(`
      INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, notes, solution)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Use transaction for bulk insert
    const insertMany = db.transaction((ticketList: any[]) => {
      for (const ticket of ticketList) {
        try {
          const id = uuidv4(); // Always generate new ID

          // DEBUG: Log ticket being processed
          console.log('Processing ticket:', {
            title: ticket.title,
            category: ticket.category,
            requester_name: ticket.requester_name,
            requester_email: ticket.requester_email,
          });

          // Case-insensitive category lookup
          const categoryId = ticket.category && ticket.category.trim()
            ? categoryMap.get(ticket.category.toLowerCase()) || null
            : null;

          console.log('Category lookup:', {
            input: ticket.category,
            lowercase: ticket.category?.toLowerCase(),
            found: categoryId,
          });

          // Try to find or create contact
          let requesterId = null;
          if (ticket.requester_name || ticket.requester_email) {
            // Case-insensitive contact lookup
            requesterId = (ticket.requester_name ? contactByNameMap.get(ticket.requester_name.toLowerCase()) : null) ||
                         (ticket.requester_email ? contactByEmailMap.get(ticket.requester_email.toLowerCase()) : null) ||
                         null;

            console.log('Contact lookup:', {
              name: ticket.requester_name,
              email: ticket.requester_email,
              found: requesterId,
            });

            // If contact doesn't exist and we have both name and email, create it
            if (!requesterId && ticket.requester_name && ticket.requester_email) {
              const newContactId = uuidv4();
              db.prepare('INSERT INTO contacts (id, name, email) VALUES (?, ?, ?)')
                .run(newContactId, ticket.requester_name.trim(), ticket.requester_email.trim());
              requesterId = newContactId;
              console.log('Created new contact:', newContactId);
            }
          }

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

          console.log('Inserted ticket:', id, 'with category:', categoryId, 'and requester:', requesterId);

          created++;
        } catch (error) {
          failed++;
          errors.push(`Failed to import ticket "${ticket.title}": ${error}`);
          console.error('Failed to insert ticket:', error);
        }
      }
    });

    insertMany(tickets);

    res.json({
      success: true,
      created,
      failed,
      errors: errors.slice(0, 10), // Return max 10 errors
    });
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
    const { whereClause, params } = buildWhereClause(query);

    // Get all matching tickets (no pagination for export)
    const tickets = db.prepare(`
      SELECT * FROM tickets
      WHERE ${whereClause}
      ORDER BY created_at DESC
    `).all(...params) as TicketRow[];

    // Get all categories for lookup
    const categories = db.prepare('SELECT id, label FROM categories').all();

    // Get all contacts for lookup
    const contacts = db.prepare('SELECT id, name, email FROM contacts').all();

    // Generate CSV
    const csv = generateCSV(tickets, categories, contacts);

    // Set headers for file download
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `tickets-export-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting tickets:', error);
    res.status(500).json({ error: 'Failed to export tickets' });
  }
});

// Get single ticket
router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id) as TicketRow | undefined;

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Include stored field values for edit-mode support
    const fieldValues = db.prepare(
      'SELECT field_name, field_label, field_value FROM ticket_field_values WHERE ticket_id = ? ORDER BY rowid ASC'
    ).all(ticket.id) as { field_name: string; field_label: string; field_value: string }[];

    res.json({ ...ticket, field_values: fieldValues });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

// Create ticket
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  const { title, description, status, priority, category_id, requester_id, notes, solution, customFields, template_id } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  if (!description && (!customFields || customFields.length === 0)) {
    return res.status(400).json({ error: 'Either description or custom fields are required' });
  }

  try {
    const id = uuidv4();

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

    const stmt = db.prepare(`
      INSERT INTO tickets (id, title, description, status, priority, category_id, requester_id, notes, solution, template_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      title,
      finalDescription,
      status || 'open',
      priority || 'medium',
      category_id || null,
      requester_id || null,
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

    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow;

    // Log ticket creation in history
    db.prepare('INSERT INTO ticket_history (id, ticket_id, user_id, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), id, req.user!.id, 'created', null, null);

    const requester = ticket.requester_id
      ? (db.prepare('SELECT name, email FROM contacts WHERE id = ?').get(ticket.requester_id) as { name: string; email: string } | undefined)
      : undefined;

    sendTicketCreatedEmail({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      categoryId: ticket.category_id,
      requesterName: requester?.name,
      requesterEmail: requester?.email,
    }).catch((error) => {
      console.error('Error sending ticket created email:', error);
    });

    res.status(201).json(ticket);
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ error: 'Failed to create ticket' });
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

// Update ticket
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { title, description, status, priority, category_id, requester_id, notes, solution, customFields, template_id } = req.body;

  try {
    const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id) as TicketRow | undefined;
    
    if (!existing) {
      return res.status(404).json({ error: 'Ticket not found' });
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
    if (notes !== undefined) updates.notes = notes || null;
    if (solution !== undefined) updates.solution = solution || null;
    if (template_id !== undefined) updates.template_id = template_id || null;

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
      'requester_id', 'notes', 'solution', 'resolved_at', 'closed_at', 'updated_at', 'template_id'
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

    // Log meaningful field changes to history
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

    if (setClauses) {
      db.prepare(`UPDATE tickets SET ${setClauses} WHERE id = ?`).run(...values, req.params.id);
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

    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id) as TicketRow;

    if (status === 'closed' && existing.status !== 'closed') {
      const requester = ticket.requester_id
        ? (db.prepare('SELECT name, email FROM contacts WHERE id = ?').get(ticket.requester_id) as { name: string; email: string } | undefined)
        : undefined;

      sendTicketClosedEmail({
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        categoryId: ticket.category_id,
        requesterName: requester?.name,
        requesterEmail: requester?.email,
      }).catch((error) => {
        console.error('Error sending ticket closed email:', error);
      });
    }

    res.json(ticket);
  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// Delete ticket
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    res.json({ message: 'Ticket deleted' });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

export default router;
