// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CommentItem } from './CommentItem';
import { Comment } from '@/types/ticket';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user' } }),
}));

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <textarea aria-label="editor" />,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const baseComment: Comment = {
  id: 'c1',
  ticketId: 't1',
  userId: 'system-user',
  content: 'Ja, jag har kollat med min chef.',
  isInternal: false,
  createdAt: new Date('2026-08-19T08:38:00Z'),
  updatedAt: new Date('2026-08-19T08:38:00Z'),
  userName: 'Systemanvändaren',
};

const noop = vi.fn().mockResolvedValue(undefined);

afterEach(cleanup);

describe('CommentItem author header', () => {
  it('shows the email sender and a via-e-post marker for inbound comments', () => {
    render(
      <CommentItem
        comment={{ ...baseComment, emailFromName: 'Anna Svensson', emailFromAddress: 'anna@kund.se' }}
        onUpdate={noop}
        onDelete={noop}
      />
    );

    // The actual sender wins over the system user the comment is stored on.
    expect(screen.getByText('Anna Svensson')).toBeTruthy();
    expect(screen.queryByText('Systemanvändaren')).toBeNull();
    expect(screen.getByText(/via e-post/)).toBeTruthy();
    // The address stays available to screen readers without cluttering the header.
    expect(screen.getByText(/från anna@kund\.se/)).toBeTruthy();
  });

  it('falls back to the user name and shows no marker for app-authored comments', () => {
    render(<CommentItem comment={baseComment} onUpdate={noop} onDelete={noop} />);

    expect(screen.getByText('Systemanvändaren')).toBeTruthy();
    expect(screen.queryByText(/via e-post/)).toBeNull();
  });
});
