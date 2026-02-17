import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Comment, CommentRow } from '@/types/ticket';

export const useTicketComments = (ticketId: string) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchComments = useCallback(async () => {
    if (!ticketId) return;

    setIsLoading(true);
    try {
      const data = await api.getComments(ticketId) as CommentRow[];
      const mapped: Comment[] = data.map((c) => ({
        id: c.id,
        ticketId: c.ticket_id,
        userId: c.user_id,
        content: c.content,
        isInternal: c.is_internal === 1,
        createdAt: new Date(c.created_at),
        updatedAt: new Date(c.updated_at),
        deletedAt: c.deleted_at ? new Date(c.deleted_at) : undefined,
        userName: c.user_name,
        userEmail: c.user_email,
      }));
      setComments(mapped);
    } catch (error) {
      console.error('Error fetching comments:', error);
    } finally {
      setIsLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const addComment = useCallback(async (content: string, isInternal: boolean = true) => {
    try {
      const data = await api.createComment(ticketId, content, isInternal) as CommentRow;
      const newComment: Comment = {
        id: data.id,
        ticketId: data.ticket_id,
        userId: data.user_id,
        content: data.content,
        isInternal: data.is_internal === 1,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
        userName: data.user_name,
        userEmail: data.user_email,
      };
      setComments((prev) => [...prev, newComment]);
      return newComment;
    } catch (error) {
      console.error('Error adding comment:', error);
      throw error;
    }
  }, [ticketId]);

  const updateComment = useCallback(async (commentId: string, content: string) => {
    try {
      const data = await api.updateComment(commentId, content) as CommentRow;
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                content: data.content,
                updatedAt: new Date(data.updated_at),
              }
            : c
        )
      );
    } catch (error) {
      console.error('Error updating comment:', error);
      throw error;
    }
  }, []);

  const deleteComment = useCallback(async (commentId: string) => {
    try {
      await api.deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (error) {
      console.error('Error deleting comment:', error);
      throw error;
    }
  }, []);

  return { comments, isLoading, addComment, updateComment, deleteComment, refetch: fetchComments };
};
