/**
 * Parse a human-readable duration string to integer minutes.
 *
 * Supported formats:
 *   '1.5h', '2t'     → decimal hours (Swedish 't' = timme)
 *   '1h 30m', '1t30m' → combined hours + minutes
 *   '90m', '45min'   → minutes only
 *   '90'             → plain integer (assumed minutes)
 *
 * Returns null if input cannot be parsed or resolves to 0.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();

  // Decimal hours: e.g. '1.5h', '2t', '0.5h'
  const decimalHours = s.match(/^(\d+(?:\.\d+)?)\s*[ht]$/);
  if (decimalHours) {
    const result = Math.round(parseFloat(decimalHours[1]) * 60);
    return result > 0 ? result : null;
  }

  // Combined hours + minutes: e.g. '1h 30m', '1t30m', '2h 15min'
  const combined = s.match(/^(\d+)\s*[ht]\s*(\d+)\s*m(?:in)?$/);
  if (combined) {
    const result = parseInt(combined[1], 10) * 60 + parseInt(combined[2], 10);
    return result > 0 ? result : null;
  }

  // Minutes only: e.g. '90m', '45min'
  const minutesOnly = s.match(/^(\d+)\s*m(?:in)?$/);
  if (minutesOnly) {
    const result = parseInt(minutesOnly[1], 10);
    return result > 0 ? result : null;
  }

  // Plain integer (assumed minutes): e.g. '90', '45'
  const plain = s.match(/^(\d+)$/);
  if (plain) {
    const result = parseInt(plain[1], 10);
    return result > 0 ? result : null;
  }

  return null;
}

/**
 * Format integer minutes into a human-readable string.
 *
 * Examples:
 *   0  → '0m'
 *   45 → '45m'
 *   60 → '1h'
 *   90 → '1h 30m'
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
