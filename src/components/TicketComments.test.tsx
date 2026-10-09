// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
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
vi.mock('./CommentItem', () => ({ CommentItem: () => <p>kommentar</p> }));
const release = vi.hoisted(() => vi.fn());
const registerUnsavedWork = vi.hoisted(() => vi.fn());
vi.mock('@/registerSW', () => ({ registerUnsavedWork }));

const baseProps = {
  comments: [],
  isLoading: false,
  isError: false,
  onUpdateComment: vi.fn().mockResolvedValue(undefined),
  onDeleteComment: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  registerUnsavedWork.mockReturnValue(release);
});
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

describe('TicketComments', () => {
  it('visar notis när servern har fler kommentarer än de som returnerades', () => {
    const comment = {
      id: 'c1', ticketId: 't1', userId: 'u1', content: '<p>hej</p>', isInternal: true,
      createdAt: new Date('2026-09-08T10:00:00Z'), updatedAt: new Date('2026-09-08T10:00:00Z'),
    };
    render(<TicketComments {...baseProps} comments={[comment]} totalCount={1500} onAddComment={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Visar de 1 senaste kommentarerna');
  });

  it('visar ingen notis när alla kommentarer är hämtade', () => {
    render(<TicketComments {...baseProps} totalCount={0} onAddComment={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('registrerar ett påbörjat svar som osparat arbete och avregistrerar det när det skickats', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    render(<TicketComments {...baseProps} onAddComment={onAddComment} />);
    expect(registerUnsavedWork).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'påbörjat svar' } });
    expect(registerUnsavedWork).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /lägg till kommentar/i }));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });
});
