/**
 * Parse a JSON string, returning a typed fallback instead of throwing.
 *
 * Guards against malformed/null/undefined input (e.g. corrupt DB rows or
 * empty option strings) so callers never crash on bad JSON.
 */
export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}
