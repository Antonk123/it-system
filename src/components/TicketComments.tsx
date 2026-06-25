import { memo, useState } from 'react';
import { Comment } from '@/types/ticket';
import { Button } from '@/components/ui/button';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { MessageSquare, Loader2, Lock, Send } from 'lucide-react';
import { CommentItem } from './CommentItem';
import { hasVisibleText } from '@/lib/textValidation';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface TicketCommentsProps {
  comments: Comment[];
  isLoading: boolean;
  isError?: boolean;
  onAddComment: (content: string, isInternal: boolean) => Promise<void>;
  onUpdateComment: (commentId: string, content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
}

export const TicketComments = memo(function TicketComments({
  comments,
  isLoading,
  isError,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: TicketCommentsProps) {
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Internal note (default, staff-only) vs public reply (emailed to the requester).
  const [isInternal, setIsInternal] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasVisibleText(newComment)) return;

    setIsSubmitting(true);
    try {
      await onAddComment(newComment, isInternal);
      setNewComment('');
      toast.success(isInternal ? 'Intern kommentar tillagd' : 'Svar skickat till kund');
    } catch (error) {
      toast.error('Kunde inte lägga till kommentar');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-foreground flex items-center gap-2 text-sm">
        <MessageSquare className="w-4 h-4" />
        Kommentarer ({comments.length})
      </h3>

      {/* Comment Form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        {/* Visibility mode: internal note vs public reply to the customer */}
        <div role="group" aria-label="Synlighet" className="inline-flex rounded-md border border-border p-0.5 bg-muted/40">
          <button
            type="button"
            aria-pressed={isInternal}
            onClick={() => setIsInternal(true)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              isInternal ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Lock className="w-3 h-3" />
            Internt
          </button>
          <button
            type="button"
            aria-pressed={!isInternal}
            onClick={() => setIsInternal(false)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              !isInternal ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Send className="w-3 h-3" />
            Publikt svar
          </button>
        </div>

        <RichTextEditor
          value={newComment}
          onChange={(html) => setNewComment(html)}
          placeholder={isInternal ? 'Lägg till en intern kommentar...' : 'Skriv ett svar till kunden...'}
          minHeight="80px"
          disabled={isSubmitting}
          showToolbar={true}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {isInternal
              ? 'Syns bara internt — skickas inte till kunden.'
              : 'Skickas som e-post till beställaren.'}
          </p>
          <Button type="submit" size="sm" disabled={isSubmitting || !hasVisibleText(newComment)}>
            {isSubmitting && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
            {isInternal ? 'Lägg till kommentar' : 'Skicka svar till kund'}
          </Button>
        </div>
      </form>

      {/* Comments List */}
      {isLoading ? (
        <div className="flex justify-center py-2">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <p className="text-destructive text-xs text-center py-2">
          Kunde inte hämta kommentarer
        </p>
      ) : comments.length === 0 ? (
        <p className="text-muted-foreground text-xs text-center py-2">
          Inga kommentarer ännu
        </p>
      ) : (
        <div className="space-y-2">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              onUpdate={onUpdateComment}
              onDelete={onDeleteComment}
            />
          ))}
        </div>
      )}
    </div>
  );
});
