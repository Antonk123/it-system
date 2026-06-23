import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Comment, CommentRow } from '@/types/ticket';
import { parseServerDate } from '@/lib/date';

// Query-key factory — invalidate the SPECIFIC ticket(id) key (not a generic
// ['comments'] prefix) so unrelated comment queries are never blown away.
export const commentKeys = {
  all: ['comments'] as const,
  ticket: (id: string) => ['comments', id] as const,
};

const mapComment = (c: CommentRow): Comment => ({
  id: c.id,
  ticketId: c.ticket_id,
  userId: c.user_id,
  content: c.content,
  isInternal: c.is_internal === 1,
  createdAt: parseServerDate(c.created_at),
  updatedAt: parseServerDate(c.updated_at),
  deletedAt: c.deleted_at ? parseServerDate(c.deleted_at) : undefined,
  userName: c.user_name,
  userEmail: c.user_email,
});

export const useTicketComments = (ticketId: string) => {
  const queryClient = useQueryClient();
  const queryKey = commentKeys.ticket(ticketId);

  const { data: comments = [], isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await api.getComments(ticketId) as CommentRow[];
      return data.map(mapComment);
    },
    enabled: Boolean(ticketId),
  });

  const addCommentMutation = useMutation({
    mutationFn: async ({ content, isInternal }: { content: string; isInternal: boolean }) => {
      const data = await api.createComment(ticketId, content, isInternal) as CommentRow;
      return mapComment(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error adding comment:', error);
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, content }: { commentId: string; content: string }) => {
      const data = await api.updateComment(commentId, content) as CommentRow;
      return { commentId, content: data.content, updatedAt: parseServerDate(data.updated_at) };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error updating comment:', error);
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      await api.deleteComment(commentId);
      return commentId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error('Error deleting comment:', error);
    },
  });

  const addComment = useCallback(async (content: string, isInternal: boolean = true) => {
    return addCommentMutation.mutateAsync({ content, isInternal });
  }, [addCommentMutation]);

  const updateComment = useCallback(async (commentId: string, content: string) => {
    await updateCommentMutation.mutateAsync({ commentId, content });
  }, [updateCommentMutation]);

  const deleteComment = useCallback(async (commentId: string) => {
    await deleteCommentMutation.mutateAsync(commentId);
  }, [deleteCommentMutation]);

  return {
    comments,
    isLoading,
    isError,
    addComment,
    updateComment,
    deleteComment,
    refetch: () => refetch(),
  };
};
