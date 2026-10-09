import { db } from '../db/connection.js';
import { sanitizePlainText, sanitizeRichText } from './htmlSanitizer.js';
import { VALID_STATUSES, VALID_PRIORITIES } from './ticketQuery.js';

export const MAX_TITLE_LENGTH = 200;
export const MAX_BODY_LENGTH = 5000;

// Referenskolumn -> tabell. Tabellnamnen är hårdkodade här och aldrig
// klientstyrda, så de kan interpoleras i SELECT 1-frågan nedan.
const REFERENCES = {
  category_id: 'categories',
  requester_id: 'contacts',
  company_id: 'companies',
  assigned_to: 'users',
} as const;

type ReferenceField = keyof typeof REFERENCES;

export interface TicketInput {
  title?: string;
  description?: string;
  notes?: string;
  solution?: string;
  status?: string;
  priority?: string;
  category_id?: string | null;
  requester_id?: string | null;
  company_id?: string | null;
  assigned_to?: string | null;
}

export type TicketValidation<V = TicketInput> =
  | { ok: true; value: V }
  | { ok: false; error: string };

/**
 * Sanerar en kort etikett (kategori, tagg): strippar HTML, trimmar och kräver
 * 1..maxLength tecken (längd mäts före sanering). sanitizePlainText kodar `&`
 * som `&amp;`; det avkodas här så att "Nätverk & Wifi" lagras som skrivet — det
 * är ren text som React ändå escapar vid rendering. Returnerar null om ogiltig.
 */
export function sanitizeLabel(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string' || raw.length > maxLength) return null;
  return sanitizePlainText(raw).replace(/&amp;/g, '&').trim() || null;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const REFERENCE_ERRORS: Record<ReferenceField, string> = {
  category_id: 'Ogiltig category_id: kategorin finns inte',
  requester_id: 'Ogiltig requester_id: kontakten finns inte',
  company_id: 'Ogiltig company_id: företaget finns inte',
  assigned_to: 'Invalid assigned_to: user does not exist',
};

/**
 * Gemensam validering + sanering av ärendefält för POST, PUT, bulk och import.
 * Längd mäts på rå inkommande text (före sanering) så att en överstor payload
 * inte döljs av att HTML strippas. partial=true: bara skickade fält (undefined
 * = rör inte) valideras; partial=false kräver titel. Tomma id-fält (null/'')
 * betyder "rensa" och slås inte upp.
 */
export function validateTicketInput(body: Record<string, unknown>, options: { partial: false }): TicketValidation<TicketInput & { title: string }>;
export function validateTicketInput(body: Record<string, unknown>, options: { partial: boolean }): TicketValidation;
export function validateTicketInput(body: Record<string, unknown>, options: { partial: boolean }): TicketValidation {
  const value: TicketInput = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return fail('Title is required');
    if (body.title.length > MAX_TITLE_LENGTH) return fail('Title must be 200 characters or less');
    const title = sanitizePlainText(body.title);
    if (!title.trim()) return fail('Title is required');
    value.title = title;
  } else if (!options.partial) {
    return fail('Title is required');
  }

  const bodyFields = [
    ['description', 'Description'],
    ['notes', 'Notes'],
    ['solution', 'Solution'],
  ] as const;
  for (const [field, label] of bodyFields) {
    const raw = body[field];
    if (raw === undefined) continue;
    if (raw !== null && typeof raw !== 'string') return fail(`${label} must be a string`);
    if (raw && raw.length > MAX_BODY_LENGTH) return fail(`${label} must be 5000 characters or less`);
    value[field] = sanitizeRichText(raw);
  }

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !VALID_STATUSES.includes(body.status)) return fail('Invalid status value');
    value.status = body.status;
  }
  if (body.priority !== undefined) {
    if (typeof body.priority !== 'string' || !VALID_PRIORITIES.includes(body.priority)) return fail('Invalid priority value');
    value.priority = body.priority;
  }

  for (const field of Object.keys(REFERENCES) as ReferenceField[]) {
    const raw = body[field];
    if (raw === undefined) continue;
    if (raw === null || raw === '') {
      value[field] = null;
      continue;
    }
    if (typeof raw !== 'string') return fail(REFERENCE_ERRORS[field]);
    const exists = db.prepare(`SELECT 1 FROM ${REFERENCES[field]} WHERE id = ?`).get(raw);
    if (!exists) return fail(REFERENCE_ERRORS[field]);
    value[field] = raw;
  }

  return { ok: true, value };
}
