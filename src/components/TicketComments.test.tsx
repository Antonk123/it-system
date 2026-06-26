// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TicketComments } from './TicketComments';

// TipTap doesn't run cleanly in jsdom — replace the editor with a plain textarea
// that mirrors the value/onChange contract.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <textarea aria-label={placeholder || 'editor'} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const baseProps = {
  comments: [],
  isLoading: false,
  isError: false,
  onUpdateComment: vi.fn().mockResolvedValue(undefined),
  onDeleteComment: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('TicketComments visibility mode', () => {
  it('posts an INTERNAL comment by default (isInternal=true)', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    render(<TicketComments {...baseProps} onAddComment={onAddComment} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'intern notering' } });
    fireEvent.click(screen.getByRole('button', { name: /lägg till kommentar/i }));

    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith('intern notering', true));
  });

  it('posts a PUBLIC reply when the public mode is selected (isInternal=false)', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    render(<TicketComments {...baseProps} onAddComment={onAddComment} />);

    // Switch to public reply mode (emails the customer).
    fireEvent.click(screen.getByRole('button', { name: /publikt svar/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Vi har löst det' } });
    fireEvent.click(screen.getByRole('button', { name: /skicka svar till kund/i }));

    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith('Vi har löst det', false));
  });

  it('hides the visibility toggle and posts internal when public replies are disabled', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    render(<TicketComments {...baseProps} onAddComment={onAddComment} allowPublicReply={false} />);

    // The visibility group is gone...
    expect(screen.queryByRole('group', { name: /synlighet/i })).toBeNull();

    // ...and submitting posts an internal comment (isInternal=true).
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'notering' } });
    fireEvent.click(screen.getByRole('button', { name: /lägg till kommentar/i }));
    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith('notering', true));
  });
});
