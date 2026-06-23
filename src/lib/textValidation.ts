/**
 * Shared visible-text check that strips HTML tags. TipTap stores empty content
 * as "<p></p>" which has non-zero length but no visible body — naive .trim()
 * lets these slip through and creates blank comments/values in the thread.
 *
 * Single source of truth: CommentItem / TicketComments import this instead of
 * each defining their own copy.
 */
export const hasVisibleText = (html: string): boolean =>
  html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
