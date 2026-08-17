// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { StatusMultiSelect } from './StatusMultiSelect';

// jsdom doesn't implement ResizeObserver; cmdk's Command uses it internally.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
// jsdom doesn't implement scrollIntoView either; cmdk scrolls the active item into view.
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

describe('StatusMultiSelect search', () => {
  it('filters the status list as the user types', async () => {
    render(<StatusMultiSelect selectedStatuses={[]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('combobox'));

    const input = await screen.findByPlaceholderText('Sök status...');
    fireEvent.change(input, { target: { value: 'Löst' } });

    await waitFor(() => {
      expect(screen.getByText('Löst')).toBeTruthy();
      expect(screen.queryByText('Öppen')).toBeNull();
    });
  });
});
