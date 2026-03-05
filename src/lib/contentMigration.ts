import TurndownService from 'turndown';

// Initialize Turndown (HTML to Markdown converter)
// Note: We're using it in "reverse" - we'll detect Markdown and convert to HTML
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

/**
 * Detect if content appears to be Markdown based on common patterns
 */
export function isMarkdownContent(content: string): boolean {
  if (!content || typeof content !== 'string') return false;

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
 * Convert Markdown to HTML
 * Uses a simple approach: split by Markdown patterns and convert to HTML
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return '';

  let html = markdown;

  // Convert headings
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Convert bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Convert inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Convert code blocks
  html = html.replace(/```([a-z]*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Convert links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Convert unordered lists
  html = html.replace(/^\* (.+)$/gim, '<li>$1</li>');
  html = html.replace(/^- (.+)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Convert ordered lists
  html = html.replace(/^\d+\. (.+)$/gim, '<li>$1</li>');

  // Convert blockquotes
  html = html.replace(/^> (.+)$/gim, '<blockquote>$1</blockquote>');

  // Convert line breaks to paragraphs
  html = html.split('\n\n').map(para => {
    // Don't wrap if already has HTML tags
    if (para.match(/^<[a-z]/i)) return para;
    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
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
