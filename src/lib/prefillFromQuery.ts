export const PREFILL_TITLE_MAX = 200;
export const PREFILL_DESCRIPTION_MAX = 2000;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Ren text -> säker HTML: allt escapas, radbrytningar blir stycken. */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

/** Läser title/description ur query (URLSearchParams avkodar redan). */
export function readTicketPrefill(search: string): { title: string; description: string } | null {
  const params = new URLSearchParams(search);
  const title = (params.get('title') ?? '').replace(/\s+/g, ' ').trim().slice(0, PREFILL_TITLE_MAX);
  const rawDescription = (params.get('description') ?? '').slice(0, PREFILL_DESCRIPTION_MAX);
  const description = plainTextToHtml(rawDescription);
  if (!title && !description) return null;
  return { title, description };
}

const hasText = (value: unknown): boolean =>
  typeof value === 'string' &&
  value.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;

/**
 * True when a new-ticket draft holds anything a person typed. An empty editor
 * serializes to markup such as `<p></p>`, which is truthy but not content — it
 * must not count, or an untouched form would restore/protect an empty "draft".
 */
export function hasDraftContent(draft: unknown): boolean {
  if (!draft || typeof draft !== 'object') return false;
  const d = draft as Record<string, unknown>;
  return hasText(d.title) || hasText(d.description) || Boolean(d.requesterId) || hasText(d.notes) || hasText(d.solution);
}
