import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

interface ContactRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  created_at: string;
}

// Get all contacts
router.get('/', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all() as ContactRow[];
    res.json(contacts);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// CSV Helper: Escape field for CSV
function escapeCSVField(field: any): string {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// CSV Helper: Parse CSV line
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

// CSV Helper: Parse full CSV content
function parseCSV(buffer: Buffer): Record<string, string>[] {
  const content = buffer.toString('utf-8').replace(/^\uFEFF/, ''); // Remove BOM
  const lines = content.split(/\r?\n/).filter(line => line.trim());

  if (lines.length < 2) return []; // Need header + at least one row

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

// Export contacts to CSV (must come before /:id route)
router.get('/export', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all() as ContactRow[];

    if (contacts.length === 0) {
      return res.status(404).json({ error: 'No contacts to export' });
    }

    // Generate CSV with BOM for Excel UTF-8 compatibility
    const BOM = '\uFEFF';
    const headers = ['Namn', 'Email', 'Telefon', 'Företag', 'Skapad'];
    let csv = BOM + headers.join(',') + '\n';

    for (const contact of contacts) {
      const row = [
        escapeCSVField(contact.name),
        escapeCSVField(contact.email),
        escapeCSVField(contact.phone || ''),
        escapeCSVField(contact.company || ''),
        escapeCSVField(contact.created_at),
      ];
      csv += row.join(',') + '\n';
    }

    const timestamp = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kontakter-${timestamp}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting contacts:', error);
    res.status(500).json({ error: 'Failed to export contacts' });
  }
});

// Helper: Normalize field names (Swedish -> English)
function normalizeContactFieldNames(row: Record<string, string>): Record<string, string> {
  const mapping: Record<string, string> = {
    Namn: 'name',
    Email: 'email',
    Telefon: 'phone',
    Företag: 'company',
    Avdelning: 'company', // Alternative Swedish term
    // English alternatives
    Name: 'name',
    Phone: 'phone',
    Company: 'company',
    Department: 'company',
  };

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = mapping[key] || key.toLowerCase();
    normalized[normalizedKey] = value;
  }
  return normalized;
}

// Import contacts - Preview (must come before /:id route)
router.post('/import/preview', authenticate, upload.single('file'), (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const rows = parseCSV(req.file.buffer);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    // Get existing emails for duplicate detection
    const existingEmails = new Set(
      (db.prepare('SELECT email FROM contacts').all() as { email: string }[]).map((c) => c.email.toLowerCase())
    );

    const results = rows.map((row) => {
      const normalized = normalizeContactFieldNames(row);
      const errors: string[] = [];

      // Required fields validation
      if (!normalized.name || !normalized.name.trim()) {
        errors.push('Namn saknas');
      }
      if (!normalized.email || !normalized.email.trim()) {
        errors.push('Email saknas');
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email.trim())) {
        errors.push('Ogiltig e-postadress');
      }

      // Check for duplicates
      const isDuplicate = normalized.email && existingEmails.has(normalized.email.trim().toLowerCase());
      if (isDuplicate) {
        errors.push('E-post finns redan i systemet');
      }

      return {
        contact: {
          name: normalized.name?.trim() || '',
          email: normalized.email?.trim() || '',
          phone: normalized.phone?.trim() || null,
          company: normalized.company?.trim() || null,
        },
        valid: errors.length === 0 && !isDuplicate,
        errors,
      };
    });

    const valid = results.filter((r) => r.valid).length;
    const invalid = results.filter((r) => !r.valid).length;
    const duplicates = results.filter((r) => r.errors.includes('E-post finns redan i systemet')).length;

    res.json({
      total: rows.length,
      valid,
      invalid,
      duplicates,
      results,
    });
  } catch (error) {
    console.error('Error previewing contact import:', error);
    res.status(500).json({ error: 'Failed to preview import' });
  }
});

// Import contacts - Confirm (must come before /:id route)
router.post('/import/confirm', authenticate, (req: AuthRequest, res: Response) => {
  const { contacts } = req.body;

  if (!Array.isArray(contacts)) {
    return res.status(400).json({ error: 'Invalid contacts data' });
  }

  let created = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    const insertStmt = db.prepare('INSERT INTO contacts (id, name, email, phone, company) VALUES (?, ?, ?, ?, ?)');

    for (const contact of contacts) {
      try {
        const id = uuidv4();
        insertStmt.run(
          id,
          contact.name,
          contact.email,
          contact.phone || null,
          contact.company || null
        );
        created++;
      } catch (err) {
        failed++;
        errors.push(`${contact.name || contact.email}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    res.json({ success: true, created, failed, errors });
  } catch (error) {
    console.error('Error confirming contact import:', error);
    res.status(500).json({ error: 'Failed to import contacts' });
  }
});

// Get single contact
router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id) as ContactRow | undefined;
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    res.json(contact);
  } catch (error) {
    console.error('Error fetching contact:', error);
    res.status(500).json({ error: 'Failed to fetch contact' });
  }
});

// Create contact
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  const { name, email, phone, company } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  try {
    const id = uuidv4();
    db.prepare('INSERT INTO contacts (id, name, email, phone, company) VALUES (?, ?, ?, ?, ?)').run(
      id, name, email, phone || null, company || null
    );
    
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactRow;
    res.status(201).json(contact);
  } catch (error) {
    console.error('Error creating contact:', error);
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

// Update contact
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { name, email, phone, company } = req.body;

  try {
    const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id) as ContactRow | undefined;
    
    if (!existing) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone || null;
    if (company !== undefined) updates.company = company || null;

    // Whitelist of allowed field names to prevent SQL injection
    const allowedFields = ['name', 'email', 'phone', 'company', 'updated_at'];

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

    if (setClauses) {
      db.prepare(`UPDATE contacts SET ${setClauses} WHERE id = ?`).run(...values, req.params.id);
    }

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id) as ContactRow;
    res.json(contact);
  } catch (error) {
    console.error('Error updating contact:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Delete contact
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ message: 'Contact deleted' });
  } catch (error) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

export default router;
