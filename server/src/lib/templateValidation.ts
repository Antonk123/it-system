import { convert } from 'html-to-text';
import { db } from '../db/connection.js';

export interface TemplateFieldValue {
  fieldName: string;
  fieldLabel: string;
  fieldValue: string;
}

export function normalizeTemplateValues(input: unknown): TemplateFieldValue[] | null {
  if (!Array.isArray(input)) return null;
  const values: TemplateFieldValue[] = [];
  const names = new Set<string>();
  for (const value of input) {
    if (!value || typeof value !== 'object' || typeof value.fieldName !== 'string' ||
      !value.fieldName.trim() || typeof value.fieldLabel !== 'string' || !value.fieldLabel.trim() ||
      (value.fieldValue != null && !['string', 'number', 'boolean'].includes(typeof value.fieldValue)) ||
      names.has(value.fieldName)) return null;
    names.add(value.fieldName);
    values.push({ fieldName: value.fieldName, fieldLabel: value.fieldLabel, fieldValue: String(value.fieldValue ?? '') });
  }
  return values;
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
