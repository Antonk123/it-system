// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { saveTicketExtras } from './ticketSaveExtras';

describe('saveTicketExtras', () => {
  it('keeps null and thrown uploads for retry while saving the remaining files', async () => {
    const files = ['a.pdf', 'b.pdf', 'c.pdf'].map(name => new File(['x'], name, { type: 'application/pdf' }));
    const uploadAttachment = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ id: 'attachment-c' });
    const addChecklistItems = vi.fn().mockResolvedValue([{ id: 'check-1' }]);
    const onUploadProgress = vi.fn();

    const result = await saveTicketExtras({
      ticketId: 'ticket-1', files, checklistLabels: ['Kontrollera'],
      uploadAttachment, addChecklistItems, onUploadProgress,
    });

    expect(result).toEqual({ failedFiles: files.slice(0, 2), checklistFailed: false });
    expect(uploadAttachment).toHaveBeenCalledTimes(3);
    expect(addChecklistItems).toHaveBeenCalledWith('ticket-1', ['Kontrollera']);
    expect(onUploadProgress).toHaveBeenLastCalledWith(0, 0);

    const retry = await saveTicketExtras({
      ticketId: 'ticket-1', files: result.failedFiles, checklistLabels: [],
      uploadAttachment: vi.fn().mockResolvedValue({ id: 'attachment' }), addChecklistItems,
    });
    expect(retry).toEqual({ failedFiles: [], checklistFailed: false });
    expect(addChecklistItems).toHaveBeenCalledTimes(1);
  });

  it('reports a swallowed checklist failure instead of treating the save as complete', async () => {
    const result = await saveTicketExtras({
      ticketId: 'ticket-1', files: [], checklistLabels: ['Kontrollera'],
      uploadAttachment: vi.fn(), addChecklistItems: vi.fn().mockResolvedValue([]),
    });

    expect(result).toEqual({ failedFiles: [], checklistFailed: true });
  });
});
