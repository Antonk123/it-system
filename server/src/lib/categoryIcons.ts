/**
 * Kategoriikoner: nycklarna i Markus Perlskogs verktygslådeikoner i Prefabnavet
 * (designsystemet, gruppen Toolbox). Frontendens ritningar ligger i
 * src/lib/categoryIcons.tsx — håll listorna i takt.
 */
export const CATEGORY_ICON_KEYS = [
  'default', 'document', 'spreadsheet', 'people', 'project', 'production', 'chart', 'finance',
  'safety', 'quality', 'calendar', 'time', 'checklist', 'folder', 'support', 'education', 'grid',
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

const KEYS = new Set<string>(CATEGORY_ICON_KEYS);

/**
 * Tolkar `icon` ur en request-body.
 * - `undefined` = fältet saknas (lämna befintligt värde orört)
 * - `null` = ta bort ikonen (också för tom sträng)
 * - en giltig nyckel
 * Returnerar `false` för allt annat, så att routen kan svara 400.
 */
export function parseCategoryIcon(value: unknown): CategoryIconKey | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' && KEYS.has(value) ? (value as CategoryIconKey) : false;
}
