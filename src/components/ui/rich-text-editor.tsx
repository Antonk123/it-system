import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Underline } from '@tiptap/extension-underline';
import {
  Bold, Italic, Strikethrough, Code, Link as LinkIcon,
  List, ListOrdered, Quote, CodeSquare, Minus,
  Heading2, Heading3, Table as TableIcon, RemoveFormatting,
  Underline as UnderlineIcon, Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState, useMemo } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './popover';

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  minHeight?: string;
  showToolbar?: boolean;
  error?: boolean;
}

export const RichTextEditor = ({
  value,
  onChange,
  placeholder = 'Skriv här...',
  className,
  disabled = false,
  required = false,
  minHeight = '200px',
  showToolbar = true,
  error = false,
}: RichTextEditorProps) => {
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [savedSelection, setSavedSelection] = useState<{ from: number; to: number } | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [isInserting, setIsInserting] = useState(false);

  // Memoize extensions to prevent recreating them on every render
  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: {
        levels: [2, 3, 4],
      },
      // Disable Link and Underline in StarterKit since we configure them manually below
      link: false,
      underline: false,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    }),
    Underline,
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
    Placeholder.configure({
      placeholder,
    }),
    // TextAlign disabled - was causing right-alignment issues
  ], [placeholder]);

  const editor = useEditor({
    extensions,
    content: value || '',
    editable: !disabled,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
    },
  }, []);

  // Update editor content when value prop changes from outside
  // Skip updates during link insertion to prevent race condition
  useEffect(() => {
    if (editor && value !== editor.getHTML() && !isInserting) {
      editor.commands.setContent(value || '');
    }
  }, [value, editor, isInserting]);

  // Update editable state when disabled prop changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  if (!editor) {
    return null;
  }

  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event from bubbling to parent forms

    if (!linkUrl.trim()) return;

    const url = linkUrl.trim();
    const text = linkText.trim();

    // Prevent external updates during insertion
    setIsInserting(true);

    // Close popover first to avoid focus issues
    setLinkPopoverOpen(false);

    // Use requestAnimationFrame to ensure popover is closed before inserting
    requestAnimationFrame(() => {
      // Restore saved selection before inserting link
      if (savedSelection) {
        editor.chain().focus().setTextSelection(savedSelection).run();
      }

      if (text) {
        // If display text is provided, insert it as a link
        editor.chain().focus().insertContent(`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`).run();
      } else {
        // Use the saved selection to check if there was selected text
        const selectedText = savedSelection
          ? editor.state.doc.textBetween(savedSelection.from, savedSelection.to)
          : '';

        if (selectedText) {
          editor.chain().focus().setLink({ href: url }).run();
        } else {
          editor.chain().focus().insertContent(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`).run();
        }
      }

      // Reset form state
      setLinkUrl('');
      setLinkText('');
      setSavedSelection(null);

      // Re-enable external updates after next frame
      requestAnimationFrame(() => {
        setIsInserting(false);
      });
    });
  };

  const addTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  return (
    <div className={cn('rich-text-editor', className)}>
      {/* Toolbar */}
      {showToolbar && (
        <div className="border border-input rounded-t-lg bg-muted/30 p-2 flex flex-wrap gap-1">
          {/* Text formatting */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={cn(
              'h-8 w-8 p-0',
              editor.isActive('bold') && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Bold (Ctrl+B)"
          >
            <Bold className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={cn(
              'h-8 w-8 p-0',
              editor.isActive('italic') && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Italic (Ctrl+I)"
          >
            <Italic className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={cn(
              'h-8 w-8 p-0',
              editor.isActive('underline') && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Underline (Ctrl+U)"
          >
            <UnderlineIcon className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={cn(
              'h-8 w-8 p-0',
              editor.isActive('strike') && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Strikethrough"
          >
            <Strikethrough className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={cn(
              'h-8 w-8 p-0',
              editor.isActive('code') && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Inline Code"
          >
            <Code className="h-4 w-4" />
          </Button>

          <div className="w-px h-8 bg-border mx-1" />

          {/* Headings */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={cn(
              'h-8 px-2',
              editor.isActive('heading', { level: 2 }) && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={cn(
              'h-8 px-2',
              editor.isActive('heading', { level: 3 }) && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </Button>

          <div className="w-px h-8 bg-border mx-1" />

          {/* Lists */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={cn(
              'h-8 w-8 p-0',
              editor.isActive('bulletList') && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Bullet List"
          >
            <List className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={cn(
              'h-8 w-8 p-0',
              editor.isActive('orderedList') && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Ordered List"
          >
            <ListOrdered className="h-4 w-4" />
          </Button>

          <div className="w-px h-8 bg-border mx-1" />

          {/* Advanced */}
          <Popover open={linkPopoverOpen} onOpenChange={(open) => {
            if (open) {
              // Save current selection before opening popover
              const { from, to } = editor.state.selection;
              setSavedSelection({ from, to });
            } else {
              // Clear saved selection and form if popover is closed
              setSavedSelection(null);
              setLinkUrl('');
              setLinkText('');
            }
            setLinkPopoverOpen(open);
          }}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 w-8 p-0',
                  editor.isActive('link') && 'bg-primary/20 text-primary'
                )}
                disabled={disabled}
                title="Add Link (Ctrl+K)"
              >
                <LinkIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b pb-2">
                  <LinkIcon className="h-4 w-4" />
                  <h4 className="font-semibold text-sm">Infoga länk</h4>
                </div>

                <form onSubmit={handleLinkSubmit} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="link-url" className="text-xs">URL *</Label>
                    <Input
                      id="link-url"
                      type="url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://example.com"
                      required
                      autoFocus
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="link-text" className="text-xs">Visningstext (valfritt)</Label>
                    <Input
                      id="link-text"
                      type="text"
                      value={linkText}
                      onChange={(e) => setLinkText(e.target.value)}
                      placeholder="Klicka här"
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLinkPopoverOpen(false)}
                    >
                      Avbryt
                    </Button>
                    <Button type="submit" size="sm" disabled={!linkUrl.trim()}>
                      Infoga
                    </Button>
                  </div>
                </form>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={cn(
              'h-8 w-8 p-0',
              editor.isActive('blockquote') && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Blockquote"
          >
            <Quote className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={cn(
              'h-8 w-8 p-0',
              editor.isActive('codeBlock') && 'bg-primary/20 text-primary'
            )}
            disabled={disabled}
            title="Code Block"
          >
            <CodeSquare className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addTable}
            className="h-8 w-8 p-0"
            disabled={disabled}
            title="Insert Table"
          >
            <TableIcon className="h-4 w-4" />
          </Button>

          {/* Delete Table - Only shows when cursor is in a table */}
          {editor.isActive('table') && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().deleteTable().run()}
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              disabled={disabled}
              title="Delete Table"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            className="h-8 w-8 p-0"
            disabled={disabled}
            title="Horizontal Rule"
          >
            <Minus className="h-4 w-4" />
          </Button>

          <div className="w-px h-8 bg-border mx-1" />

          {/* Clear formatting */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
            className="h-8 w-8 p-0"
            disabled={disabled}
            title="Clear Formatting"
          >
            <RemoveFormatting className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Editor content */}
      <EditorContent
        editor={editor}
        className={cn(
          'rich-text-editor-content',
          showToolbar ? 'rounded-b-lg' : 'rounded-lg',
          'border border-input bg-background/50 backdrop-blur-sm',
          'transition-all duration-200',
          !disabled && 'hover:bg-background/80 hover:border-primary/30 hover:shadow-sm',
          error && 'border-destructive',
          'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          disabled && 'cursor-not-allowed opacity-50'
        )}
        style={{ minHeight }}
      />

      {/* Required indicator (hidden input for form validation) */}
      {required && (
        <input
          type="text"
          value={editor.getText().trim()}
          onChange={() => {}}
          required
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
      )}

      <style>{`
        .rich-text-editor-content .ProseMirror {
          padding: 0.75rem;
          outline: none;
          min-height: ${minHeight};
          text-align: left;
          direction: ltr;
        }

        .rich-text-editor-content .ProseMirror p {
          text-align: left !important;
        }

        .rich-text-editor-content .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          height: 0;
        }

        .rich-text-editor-content .ProseMirror h2 {
          font-size: 1.5rem;
          font-weight: 600;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }

        .rich-text-editor-content .ProseMirror h3 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .rich-text-editor-content .ProseMirror ul {
          list-style-type: disc;
          padding-left: 1.5rem;
          margin: 0.5rem 0;
        }

        .rich-text-editor-content .ProseMirror ol {
          list-style-type: decimal;
          padding-left: 1.5rem;
          margin: 0.5rem 0;
        }

        .rich-text-editor-content .ProseMirror li {
          margin: 0.25rem 0;
          display: list-item;
        }

        .rich-text-editor-content .ProseMirror blockquote {
          border-left: 3px solid hsl(var(--primary));
          padding-left: 1rem;
          margin: 1rem 0;
          font-style: italic;
        }

        .rich-text-editor-content .ProseMirror code {
          background: hsl(var(--muted));
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-size: 0.875rem;
          font-family: monospace;
        }

        .rich-text-editor-content .ProseMirror pre {
          background: hsl(var(--muted));
          border: 1px solid hsl(var(--border));
          border-radius: 0.5rem;
          padding: 0.75rem;
          margin: 0.5rem 0;
          overflow-x: auto;
        }

        .rich-text-editor-content .ProseMirror pre code {
          background: none;
          padding: 0;
          border-radius: 0;
          font-size: inherit;
        }

        .rich-text-editor-content .ProseMirror a {
          color: hsl(var(--primary));
          text-decoration: underline;
          cursor: pointer;
        }

        .rich-text-editor-content .ProseMirror a:hover {
          opacity: 0.8;
        }

        .rich-text-editor-content .ProseMirror table {
          border-collapse: collapse;
          margin: 1rem 0;
          width: 100%;
        }

        .rich-text-editor-content .ProseMirror th,
        .rich-text-editor-content .ProseMirror td {
          border: 1px solid hsl(var(--border));
          padding: 0.5rem;
          text-align: left;
        }

        .rich-text-editor-content .ProseMirror th {
          background: hsl(var(--muted));
          font-weight: 600;
        }

        .rich-text-editor-content .ProseMirror hr {
          border: none;
          border-top: 2px solid hsl(var(--border));
          margin: 1.5rem 0;
        }
      `}</style>

    </div>
  );
};
