// Pure CSV/XLSX import & export helpers for the tickets routes.
// Extracted verbatim from routes/tickets.ts (item M-cq3) for isolated unit
// testing. These functions are side-effect-free (generateXLSX builds a Buffer
// in memory; nothing here touches the database).

import ExcelJS from 'exceljs';
import { VALID_STATUSES, VALID_PRIORITIES } from './ticketQuery.js';

export interface TicketRow {
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

export interface CategoryLookup {
  id: string;
  label: string;
}

export interface ContactLookup {
  id: string;
  name: string;
  email: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  ticket: any;
  isDuplicate: boolean;
}

// CSV helper functions
export function escapeCSVField(field: any): string {
  if (field === null || field === undefined) return '';
  const str = String(field);
  // Escape double quotes by doubling them, and wrap in quotes if contains comma, quote, or newline
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function generateXLSX(tickets: TicketRow[], categories: CategoryLookup[], contacts: ContactLookup[]): Promise<Buffer> {
  const categoryMap = new Map(categories.map((c) => [c.id, c.label]));
  const contactMap = new Map(contacts.map((c) => [c.id, { name: c.name, email: c.email }]));

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

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ärenden');
  ws.addRow(headers);
  ws.addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// CSV Import helpers
export function parseCSVLine(line: string): string[] {
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
export function normalizeFieldNames(row: any): any {
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

export function parseCSV(csvContent: string): any[] {
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

export function validateTicketRow(row: any, rowIndex: number, categories: any[], existingTicketIds: Set<string>): ValidationResult {
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
