import { convert } from 'html-to-text';

/** Check HTML only after it has passed through sanitizeRichText. */
export function hasVisibleContent(sanitizedHtml: string): boolean {
  for (const image of sanitizedHtml.matchAll(/<img\b[^>]*\s+src\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    if ((image[1] || image[2] || image[3]).trim()) return true;
  }
  return convert(sanitizedHtml, {
    wordwrap: false,
    selectors: [{ selector: 'img', format: 'skip' }],
  }).trim().length > 0;
}
