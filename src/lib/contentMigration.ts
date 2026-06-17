import MarkdownIt from 'markdown-it';

// Initialize markdown-it with table support (enabled by default in v14)
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

/**
 * Detect if content appears to be Markdown based on common patterns
 */
export function isMarkdownContent(content: string): boolean {
  if (!content || typeof content !== 'string') return false;

  // Content that already starts with an HTML tag is not Markdown
  if (content.trim().startsWith('<')) return false;

  // A GFM table separator row is a strong single-pattern indicator
  // (e.g. "| --- | --- |" or ":---" or "---:")
  const hasTableSeparator = /^\s*\|?\s*:?-{2,}[^|]*\|/m.test(content);
  if (hasTableSeparator) return true;

  // Check for common Markdown patterns
  const markdownPatterns = [
    /\*\*[^*]+\*\*/,        // Bold: **text**
    /\*[^*\s][^*]*\*/,      // Italic: *text*
    /\[[^\]]+\]\([^)]+\)/,  // Links: [text](url)
    /^#{1,6}\s/m,           // Headings: # Heading
    /^[-*+]\s/m,            // Unordered lists: - item
    /^\d+\.\s/m,            // Ordered lists: 1. item
    /`[^`]+`/,              // Inline code: `code`
    /```[\s\S]*?```/,       // Code blocks: ```code```
    /^>\s/m,                // Blockquotes: > quote
  ];

  // If at least 2 patterns match, consider it Markdown
  const matchCount = markdownPatterns.filter(pattern => pattern.test(content)).length;
  return matchCount >= 2;
}

/**
 * Convert Markdown to HTML using markdown-it.
 * Supports GFM tables, headings, bold, italic, links, code blocks, lists, blockquotes.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return '';
  return md.render(markdown);
}

/**
 * Clean up table cells in imported Markdown that contain placeholder values
 * produced by Excel→Markdown exporters (NaN, NULL, None, undefined, nan, null).
 * Only cells inside pipe-delimited table rows are touched — running text is preserved.
 */
export function cleanImportedMarkdownTables(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return markdown;

  const PLACEHOLDER = /^(NaN|nan|NULL|null|undefined|None)$/;

  return markdown
    .split('\n')
    .map(line => {
      // Only process lines that contain a pipe character (table rows)
      if (!line.includes('|')) return line;

      // Split on pipes, clean matching cells, rejoin
      return line
        .split('|')
        .map(cell => {
          const trimmed = cell.trim();
          return PLACEHOLDER.test(trimmed) ? cell.replace(trimmed, '') : cell;
        })
        .join('|');
    })
    .join('\n');
}

/**
 * Auto-detect content format and migrate to HTML if needed
 * This is the main entry point for content migration
 */
export function migrateContent(content: string | null | undefined): string {
  if (!content) return '';

  // If content already looks like HTML, return as-is
  if (content.trim().startsWith('<')) {
    return content;
  }

  // If content looks like Markdown, convert to HTML
  if (isMarkdownContent(content)) {
    return markdownToHtml(content);
  }

  // Plain text - wrap in paragraphs
  return `<p>${content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
}
