import { describe, it, expect } from 'vitest';
import {
  escapeCSVField,
  parseCSVLine,
  parseCSV,
  normalizeFieldNames,
  validateTicketRow,
} from './ticketImportExport.js';

// Pure import/export helpers extracted from routes/tickets.ts (M-cq3).
// No DB or request/response access — straightforward unit tests.

describe('escapeCSVField', () => {
  it('returns empty string for null', () => {
    expect(escapeCSVField(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeCSVField(undefined)).toBe('');
  });

  it('passes through a plain string unchanged', () => {
    expect(escapeCSVField('hello')).toBe('hello');
  });

  it('stringifies numbers', () => {
    expect(escapeCSVField(42)).toBe('42');
  });

  it('wraps fields containing a comma in quotes', () => {
    expect(escapeCSVField('a,b')).toBe('"a,b"');
  });

  it('doubles embedded double-quotes and wraps', () => {
    expect(escapeCSVField('say "hi"')).toBe('"say ""hi"""');
  });

  it('wraps fields containing a newline', () => {
    expect(escapeCSVField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('wraps fields containing a carriage return', () => {
    expect(escapeCSVField('line1\rline2')).toBe('"line1\rline2"');
  });

  it('does not wrap a field with no special characters', () => {
    expect(escapeCSVField('plain text 123')).toBe('plain text 123');
  });
});

describe('parseCSVLine', () => {
  it('splits a simple comma-separated line and trims', () => {
    expect(parseCSVLine('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCSVLine('"a,b",c')).toEqual(['a,b', 'c']);
  });

  it('unescapes doubled quotes inside quoted fields', () => {
    expect(parseCSVLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
  });

  it('returns a single element for a line with no commas', () => {
    expect(parseCSVLine('solo')).toEqual(['solo']);
  });

  it('produces an empty trailing field for a trailing comma', () => {
    expect(parseCSVLine('a,')).toEqual(['a', '']);
  });
});

describe('parseCSV', () => {
  it('returns [] when fewer than 2 lines (header only)', () => {
    expect(parseCSV('id,title')).toEqual([]);
  });

  it('parses a header + one data row into an object', () => {
    const rows = parseCSV('title,status\nHello,open');
    expect(rows).toEqual([{ title: 'Hello', status: 'open' }]);
  });

  it('strips a leading BOM', () => {
    const rows = parseCSV('\uFEFFtitle,status\nHello,open');
    expect(rows).toEqual([{ title: 'Hello', status: 'open' }]);
  });

  it('round-trips quoted fields containing commas', () => {
    const rows = parseCSV('title,description\n"A, B","C, D"');
    expect(rows).toEqual([{ title: 'A, B', description: 'C, D' }]);
  });

  it('handles quoted fields that contain newlines', () => {
    const rows = parseCSV('title,description\n"A","line1\nline2"');
    expect(rows).toEqual([{ title: 'A', description: 'line1\nline2' }]);
  });

  it('normalizes Swedish headers to English field names', () => {
    const rows = parseCSV('Titel,Status\nHej,open');
    expect(rows).toEqual([{ title: 'Hej', status: 'open' }]);
  });

  it('handles CRLF line endings', () => {
    const rows = parseCSV('title,status\r\nHello,open\r\nBye,closed');
    expect(rows).toEqual([
      { title: 'Hello', status: 'open' },
      { title: 'Bye', status: 'closed' },
    ]);
  });

  it('fills missing trailing columns with empty strings', () => {
    const rows = parseCSV('title,status,priority\nHello,open');
    expect(rows).toEqual([{ title: 'Hello', status: 'open', priority: '' }]);
  });
});

describe('normalizeFieldNames', () => {
  it('maps known Swedish keys to English', () => {
    const out = normalizeFieldNames({
      Titel: 'T',
      Beskrivning: 'D',
      Status: 'open',
      Prioritet: 'high',
      Kategori: 'IT',
    });
    expect(out).toEqual({
      title: 'T',
      description: 'D',
      status: 'open',
      priority: 'high',
      category: 'IT',
    });
  });

  it('maps requester/company/contact Swedish headers', () => {
    const out = normalizeFieldNames({
      'Beställare Namn': 'Anna',
      'Beställare Email': 'a@x.se',
      'Beställare Telefon': '123',
      'Beställare Företag': 'Acme',
    });
    expect(out).toEqual({
      requester_name: 'Anna',
      requester_email: 'a@x.se',
      requester_phone: '123',
      requester_company: 'Acme',
    });
  });

  it('passes through unknown keys unchanged', () => {
    const out = normalizeFieldNames({ custom_field: 'x', title: 'y' });
    expect(out).toEqual({ custom_field: 'x', title: 'y' });
  });
});

describe('validateTicketRow', () => {
  const categories = [{ label: 'IT' }, { label: 'HR' }];
  const noExisting = new Set<string>();

  it('accepts a minimal valid row (title only)', () => {
    const row: any = { title: 'Broken laptop' };
    const result = validateTicketRow(row, 0, categories, noExisting);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.isDuplicate).toBeFalsy();
  });

  it('defaults missing description to the title', () => {
    const row: any = { title: 'Broken laptop' };
    validateTicketRow(row, 0, categories, noExisting);
    expect(row.description).toBe('Broken laptop');
  });

  it('defaults description to placeholder when title is also empty', () => {
    const row: any = { title: '' };
    validateTicketRow(row, 0, categories, noExisting);
    expect(row.description).toBe('Importerad utan beskrivning');
  });

  it('rejects a row with missing title', () => {
    const result = validateTicketRow({ title: '' }, 0, categories, noExisting);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Titel saknas');
  });

  it('rejects an invalid status', () => {
    const result = validateTicketRow(
      { title: 'X', status: 'nonsense' },
      0,
      categories,
      noExisting
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith('Ogiltig status'))).toBe(true);
  });

  it('accepts a valid status', () => {
    const result = validateTicketRow(
      { title: 'X', status: 'in-progress' },
      0,
      categories,
      noExisting
    );
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid priority', () => {
    const result = validateTicketRow(
      { title: 'X', priority: 'urgent' },
      0,
      categories,
      noExisting
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith('Ogiltig prioritet'))).toBe(true);
  });

  it('rejects a non-existent category', () => {
    const result = validateTicketRow(
      { title: 'X', category: 'Finance' },
      0,
      categories,
      noExisting
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('finns inte'))).toBe(true);
  });

  it('accepts a category case-insensitively', () => {
    const result = validateTicketRow(
      { title: 'X', category: 'it' },
      0,
      categories,
      noExisting
    );
    expect(result.valid).toBe(true);
  });

  it('flags a duplicate id present in existing ids', () => {
    const result = validateTicketRow(
      { title: 'X', id: 'abc' },
      0,
      categories,
      new Set(['abc'])
    );
    expect(result.valid).toBe(false);
    expect(result.isDuplicate).toBe(true);
    expect(result.errors.some((e) => e.includes('finns redan'))).toBe(true);
  });

  it('accumulates multiple errors for one row', () => {
    const result = validateTicketRow(
      { title: '', status: 'bad', priority: 'bad', category: 'Nope' },
      0,
      categories,
      noExisting
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
