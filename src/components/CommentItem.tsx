import { useState } from 'react';
import { Comment } from '@/types/ticket';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

interface CommentItemProps {
  comment: Comment;
  onUpdate: (commentId: string, content: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
}

export const CommentItem = ({ comment, onUpdate, onDelete }: CommentItemProps) => {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [isUpdating, setIsUpdating] = useState(false);

  const canEdit = user?.id === comment.userId || user?.role === 'admin';

  const handleUpdate = async () => {
    if (!editContent.trim()) return;
    setIsUpdating(true);
    try {
      await onUpdate(comment.id, editContent);
      setIsEditing(false);
      toast.success('Kommentar uppdaterad');
    } catch (error) {
      toast.error('Kunde inte uppdatera kommentar');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Är du säker på att du vill ta bort denna kommentar?')) return;
    try {
      await onDelete(comment.id);
      toast.success('Kommentar borttagen');
    } catch (error) {
      toast.error('Kunde inte ta bort kommentar');
    }
  };

  return (
    <div className="border rounded p-2 bg-muted/20">
      <div className="flex items-start justify-between mb-1">
        <div>
          <span className="font-medium text-xs">{comment.userName || comment.userEmail || 'Okänd användare'}</span>
          <span className="text-xs text-muted-foreground ml-2">
            {format(comment.createdAt, 'PPp', { locale: sv })}
            {comment.updatedAt > comment.createdAt && ' (redigerad)'}
          </span>
        </div>
        {canEdit && !isEditing && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="h-6 w-6 p-0"
            >
              <Pencil className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-1">
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={2}
            disabled={isUpdating}
            className="text-xs"
          />
          <div className="flex gap-1 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsEditing(false);
                setEditContent(comment.content);
              }}
              disabled={isUpdating}
              className="h-7 text-xs"
            >
              <X className="w-3 h-3 mr-1" />
              Avbryt
            </Button>
            <Button size="sm" onClick={handleUpdate} disabled={isUpdating || !editContent.trim()} className="h-7 text-xs">
              <Check className="w-3 h-3 mr-1" />
              Spara
            </Button>
          </div>
        </div>
      ) : (
        <MarkdownRenderer
          content={comment.content}
          className="prose-sm prose-p:text-xs prose-p:my-1 prose-li:text-xs prose-headings:text-sm"
        />
      )}
    </div>
  );
};
