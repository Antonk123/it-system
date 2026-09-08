// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ createTag: vi.fn(async () => ({})), deleteTag: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/hooks/useTags', () => ({ useTags: () => ({ tags: [{ id: 'wifi', name: 'Wi-Fi', color: '#3b82f6' }], ...mocks }) }));
import { KBTagSettings } from './KBTagSettings';
afterEach(cleanup);
describe('Kunskapsbasens flyttade taggadministration', () => {
  it('behåller befintliga KB-taggar och möjligheten att skapa en tagg', async () => {
    render(<KBTagSettings />);
    expect(screen.getByText('Wi-Fi')).toBeInTheDocument();
    expect(screen.getByText(/Hantera taggar för artiklar i kunskapsbasen/)).toBeInTheDocument();
    const input = screen.getByPlaceholderText('Nytt taggnamn...');
    fireEvent.change(input, { target: { value: 'Nätverk' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.createTag).toHaveBeenCalledWith({ name: 'Nätverk', color: '#3b82f6' }));
    expect(mocks.deleteTag).not.toHaveBeenCalled();
  });
});
