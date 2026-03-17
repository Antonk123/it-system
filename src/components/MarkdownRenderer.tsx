import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Regex to detect URLs that aren't already in markdown link syntax
const urlRegex = /(https?:\/\/[^\s<>\[\]()]+)/g;

// Pre-process content to convert bare URLs to markdown links
const processUrls = (text: string): string => {
  // Split by existing markdown links and code blocks to avoid double-processing
  const parts = text.split(/(\[.*?\]\(.*?\)|`[^`]+`|```[\s\S]*?```)/g);
  
  return parts.map((part) => {
    // If it's already a markdown link or code block, leave it alone
    if (part.match(/^\[.*?\]\(.*?\)$/) || part.match(/^`/) || part.match(/^```/)) {
      return part;
    }
    // Convert bare URLs to markdown links
    return part.replace(urlRegex, (url) => `[${url}](${url})`);
  }).join('');
};

export const MarkdownRenderer = ({ content, className }: MarkdownRendererProps) => {
  const processedContent = processUrls(content);
  
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
        className
      )}
    >
      <ReactMarkdown 
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children, ...props }) => (
            <a 
              href={href} 
              target="_blank" 
              rel="noopener noreferrer" 
              {...props}
            >
              {children}
            </a>
          ),
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};
