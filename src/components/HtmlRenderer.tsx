import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils';

interface HtmlRendererProps {
  content: string;
  className?: string;
}

/**
 * Safely render HTML content with DOMPurify sanitization
 * Replaces MarkdownRenderer for displaying HTML content from TipTap editor
 */
export const HtmlRenderer = ({ content, className }: HtmlRendererProps) => {
  if (!content) return null;

  // Sanitize HTML to prevent XSS attacks
  const sanitizedHtml = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [
      // Text formatting
      'p', 'div', 'span', 'br', 'hr',
      // Headings
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      // Emphasis
      'strong', 'em', 'u', 's', 'b', 'i',
      // Code
      'code', 'pre',
      // Links
      'a',
      // Lists
      'ul', 'ol', 'li',
      // Blockquotes
      'blockquote',
      // Tables
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: [
      'href', 'target', 'rel',
      'class', 'style',
      'colspan', 'rowspan', 'align',
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target', 'rel'],
  });

  return (
    <div
      className={cn(
        "prose prose-base max-w-none dark:prose-invert",
        "prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-4 prose-headings:mb-2",
        "prose-h3:text-lg prose-h3:font-bold",
        "prose-h4:text-base prose-h4:font-semibold",
        "prose-p:text-foreground prose-p:leading-relaxed prose-p:text-base",
        "prose-a:text-primary prose-a:underline hover:prose-a:text-primary/80",
        "prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted prose-pre:border prose-pre:border-border",
        "prose-ul:text-foreground prose-ol:text-foreground prose-ul:text-base prose-ol:text-base",
        "prose-li:marker:text-foreground prose-li:text-base",
        "prose-blockquote:border-l-primary prose-blockquote:text-foreground",
        "prose-strong:text-foreground prose-strong:font-bold",
        "prose-table:border prose-table:border-border",
        "prose-th:bg-muted prose-th:border prose-th:border-border prose-th:p-2",
        "prose-td:border prose-td:border-border prose-td:p-2",
        className
      )}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
};
