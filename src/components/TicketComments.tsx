import { useState } from 'react';
import { Comment } from '@/types/ticket';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Loader2 } from 'lucide-react';
import { CommentItem } from './CommentItem';
import { toast } from 'sonner';

interface TicketCommentsProps {
  comments: Comment[];
  isLoading: boolean;
  onAddComment: (content: string, isInternal: boolean) => Promise<void>;
  onUpdateComment: (commentId: string, content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
}

export const TicketComments = ({
  comments,
  isLoading,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: TicketCommentsProps) => {
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    try {
      await onAddComment(newComment, true);  // Always internal by default
      setNewComment('');
      toast.success('Kommentar tillagd');
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
        Interna kommentarer ({comments.length})
      </h3>

      {/* Comment Form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          placeholder="Lägg till en intern kommentar... (Markdown stöds)"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={2}
          disabled={isSubmitting}
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">Tips: använd t.ex. `**fetstil**`, listor eller länkar.</p>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={isSubmitting || !newComment.trim()}>
            {isSubmitting && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
            Lägg till kommentar
          </Button>
        </div>
      </form>

      {/* Comments List */}
      {isLoading ? (
        <div className="flex justify-center py-2">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
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
};
