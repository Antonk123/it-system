// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TagMultiSelect } from './TagMultiSelect';

// jsdom doesn't implement ResizeObserver; cmdk's Command uses it internally.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
// jsdom doesn't implement scrollIntoView either; cmdk scrolls the active item into view.
Element.prototype.scrollIntoView = vi.fn();

const mockTags = [
  { id: '1', name: 'AutoCAD', color: '#000' },
  { id: '2', name: 'Betongstation', color: '#000' },
  { id: '3', name: 'Bluebeam', color: '#000' },
  { id: '4', name: 'Externa', color: '#000' },
];

vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({ tags: mockTags }),
}));

afterEach(cleanup);

describe('TagMultiSelect search', () => {
  it('filters the tag list as the user types', async () => {
    render(<TagMultiSelect selectedTagIds={[]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('combobox'));

    const input = await screen.findByPlaceholderText('Sök taggar...');
    fireEvent.change(input, { target: { value: 'Externa' } });

    await waitFor(() => {
      expect(screen.getByText('Externa')).toBeTruthy();
      expect(screen.queryByText('AutoCAD')).toBeNull();
    });
  });
});
