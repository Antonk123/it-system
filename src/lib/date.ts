/**
 * Parse a timestamp coming from the backend into a Date.
 *
 * The database stores timestamps in two formats, both representing UTC:
 *  - SQLite `CURRENT_TIMESTAMP` → "YYYY-MM-DD HH:MM:SS" (naive, no timezone marker)
 *  - JS `new Date().toISOString()` → "YYYY-MM-DDTHH:MM:SS.sssZ"
 *
 * `new Date("YYYY-MM-DD HH:MM:SS")` interprets the naive string as *local* time,
 * which on a CEST server/client shows events 2 hours early (08:00 → 06:00).
 * This helper marks naive SQLite timestamps as UTC so they render in local time,
 * while leaving already-zoned ISO strings untouched (no double conversion).
 */

/**
 * Format an ISO/Date value as a Swedish locale date string.
 *
 * Uses `sv-SE` locale. Pass `options` to control the output format, e.g.:
 *   - short: `{ year: 'numeric', month: 'short', day: 'numeric' }` → "17 jun 2026"
 *   - long:  `{ year: 'numeric', month: 'long',  day: 'numeric' }` → "17 juni 2026"
 *   - omit options for the browser default ("2026-06-17")
 */
export function formatDate(iso: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = typeof iso === 'string' ? parseServerDate(iso) ?? new Date(iso) : iso;
  return date.toLocaleDateString('sv-SE', options);
}
export function parseServerDate(value: string | number | Date): Date;
export function parseServerDate(value: null | undefined): null;
export function parseServerDate(value: string | number | Date | null | undefined): Date | null;
export function parseServerDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);

  const s = value.trim();
  // Already carries timezone info (trailing Z, or +HH:MM / -HH:MM offset) → parse as-is.
  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s);
  }
  // Naive SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → make the UTC intent explicit.
  const iso = s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(s) : d;
}
