import { convert } from 'html-to-text';
import { db } from '../db/connection.js';
import { sanitizePlainText, sanitizeRichText } from './htmlSanitizer.js';

export interface TemplateFieldValue {
  fieldName: string;
  fieldLabel: string;
  fieldValue: string;
}

export const MAX_FIELD_LABEL_LENGTH = 200;
export const MAX_FIELD_VALUE_LENGTH = 5000;

/**
 * Validerar och sanerar fältvärden från klienten (interna ärenden och mallar).
 * Längder mäts på rå text före sanering. Returnerar null vid ogiltig form,
 * för långa fält eller dubblettnamn.
 */
export function normalizeTemplateValues(input: unknown): TemplateFieldValue[] | null {
  if (!Array.isArray(input)) return null;
  const values: TemplateFieldValue[] = [];
  const names = new Set<string>();
  for (const value of input) {
    if (!value || typeof value !== 'object' || typeof value.fieldName !== 'string' ||
      typeof value.fieldLabel !== 'string' ||
      (value.fieldValue != null && !['string', 'number', 'boolean'].includes(typeof value.fieldValue))) return null;
    const rawValue = String(value.fieldValue ?? '');
    if (value.fieldName.length > MAX_FIELD_LABEL_LENGTH || value.fieldLabel.length > MAX_FIELD_LABEL_LENGTH ||
      rawValue.length > MAX_FIELD_VALUE_LENGTH) return null;
    const fieldName = sanitizePlainText(value.fieldName);
    const fieldLabel = sanitizePlainText(value.fieldLabel);
    if (!fieldName.trim() || !fieldLabel.trim() || names.has(fieldName)) return null;
    names.add(fieldName);
    values.push({ fieldName, fieldLabel, fieldValue: sanitizeRichText(rawValue) });
  }
  return values;
}

/** Beskrivningen som komponeras av mallfälten (ersätter inkommande description). */
export function composeDescriptionFromFields(values: TemplateFieldValue[]): string {
  return values
    .filter((field) => field.fieldLabel)
    .map((field) => `**${field.fieldLabel}**: ${field.fieldValue || '(ej angivet)'}`)
    .join('  \n');
}

/** The stored template determines required fields and their types. */
export function missingRequiredTemplateFields(templateId: string | null, values: TemplateFieldValue[]): Record<string, string> {
  if (!templateId) return {};
  const fields = db.prepare(`SELECT field_name, field_label, field_type FROM template_fields
    WHERE template_id = ? AND required = 1`).all(templateId) as Array<{
      field_name: string; field_label: string; field_type: string;
    }>;
  const byName = new Map(values.map(value => [value.fieldName, value.fieldValue]));
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = byName.get(field.field_name) ?? '';
    const content = field.field_type === 'textarea'
      ? convert(value, { wordwrap: false, selectors: [
        { selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' },
      ] }).trim()
      : value.trim();
    // Explicit false/Nej and number 0 are answers; only missing content fails.
    if (!content) errors[field.field_name] = `${field.field_label} krävs`;
  }
  return errors;
}
