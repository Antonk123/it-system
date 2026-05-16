import sanitizeHtml from 'sanitize-html';

// Allowlist matchar TipTap-editorn på frontend (rich-text-editor.tsx).
// Vid utökning av editorn, uppdatera även denna lista.
const RICH_TEXT_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4',
    'ul', 'ol', 'li',
    'blockquote',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    '*': ['class'],  // TipTap använder class för code-block styling
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],  // tillåt data: URI bara på img
  },
  // Strippar EVENT-handlers, javascript:-URLs, <script>, <style> etc by default.
  // Transformera <a> så target=_blank får rel=noopener noreferrer automatiskt:
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
  },
};

const PLAIN_TEXT_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
};

export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeHtml(html, RICH_TEXT_CONFIG);
}

export function sanitizePlainText(text: string | null | undefined): string {
  if (!text) return '';
  return sanitizeHtml(text, PLAIN_TEXT_CONFIG);
}
