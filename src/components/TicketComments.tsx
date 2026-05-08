import { useState } from 'react';
import { Comment } from '@/types/ticket';
import { Button } from '@/components/ui/button';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { MessageSquare, Loader2, Sparkles, X } from 'lucide-react';
import { CommentItem } from './CommentItem';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface TicketCommentsProps {
  ticketId: string;
  comments: Comment[];
  isLoading: boolean;
  onAddComment: (content: string, isInternal: boolean) => Promise<void>;
  onUpdateComment: (commentId: string, content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
}

export const TicketComments = ({
  ticketId,
  comments,
  isLoading,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: TicketCommentsProps) => {
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [aiDraftKbTitles, setAiDraftKbTitles] = useState<string[]>([]);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);

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

  const handleGenerateAiDraft = async () => {
    setIsGeneratingDraft(true);
    try {
      const result = await api.generateAiDraft(ticketId);
      setAiDraft(result.draft);
      setAiDraftKbTitles(result.kbTitles || []);
    } catch {
      toast.error('Kunde inte generera AI-utkast. Kontrollera att AI är konfigurerat.');
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const handleUseAiDraft = () => {
    if (aiDraft) {
      setNewComment(aiDraft);
      setAiDraft(null);
      setAiDraftKbTitles([]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-foreground flex items-center gap-2 text-sm">
          <MessageSquare className="w-4 h-4" />
          Kommentarer ({comments.length})
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerateAiDraft}
          disabled={isGeneratingDraft}
          className="gap-1.5 text-xs"
        >
          {isGeneratingDraft ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          Föreslå svar (AI)
        </Button>
      </div>

      {/* AI Draft */}
      {aiDraft && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-purple-400 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              AI-utkast — granska innan du skickar
            </span>
            <button onClick={() => { setAiDraft(null); setAiDraftKbTitles([]); }} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            value={aiDraft}
            onChange={(e) => setAiDraft(e.target.value)}
            className="w-full min-h-[120px] bg-background/50 border border-border rounded-md p-3 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-purple-500/50"
          />
          {aiDraftKbTitles.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Baserat på: {aiDraftKbTitles.join(', ')}
            </p>
          )}
          <div className="flex justify-end">
            <Button size="sm" onClick={handleUseAiDraft} className="gap-1.5">
              Använd som svar
            </Button>
          </div>
        </div>
      )}

      {/* Comment Form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <RichTextEditor
          value={newComment}
          onChange={(html) => setNewComment(html)}
          placeholder="Lägg till en intern kommentar..."
          minHeight="80px"
          disabled={isSubmitting}
          showToolbar={true}
        />
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
