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
