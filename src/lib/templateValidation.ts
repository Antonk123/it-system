import type { CustomFieldInput, TemplateFieldRow } from '@/lib/api';

/** Validate the template definition, not a client-supplied required flag. */
export function requiredTemplateFieldErrors(
  fields: Pick<TemplateFieldRow, 'field_name' | 'field_label' | 'field_type' | 'required'>[],
  values: CustomFieldInput[],
): Record<string, string> {
  const valueByName = new Map(values.map(value => [value.fieldName, String(value.fieldValue ?? '').trim()]));
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!field.required) continue;
    const value = valueByName.get(field.field_name) ?? '';
    // TipTap represents an empty editor as HTML; whitespace and a <br> are
    // not an answer. Explicit checkbox "Nej" and numeric "0" remain valid.
    const content = field.field_type === 'textarea'
      ? (new DOMParser().parseFromString(value, 'text/html').body.textContent ?? '').trim()
      : value;
    if (!content) errors[field.field_name] = `${field.field_label} krävs`;
  }
  return errors;
}
