// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UnifiedFilterBar } from './UnifiedFilterBar';
vi.mock('@/hooks/useCategories', () => ({useCategories: () => ({categories:[]})}));
vi.mock('@/hooks/use-mobile', () => ({useIsMobile: () => false}));
afterEach(cleanup);
describe('förenklat filterfält', () => {
  it('har Bara mina och vanliga filter men inga status- eller vyreglage', () => {
    const onMineChange = vi.fn();
    render(<UnifiedFilterBar search="" mine={false} onMineChange={onMineChange} priorityFilter="all" categoryFilter="all" checklistFilter="" dateFrom="" dateTo="" dateField="created_at" onChange={vi.fn()} onClearAll={vi.fn()} />);
    const mine = screen.getByRole('button', {name:'Bara mina'});
    expect(mine).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(mine);
    expect(onMineChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.queryByText(/Status:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name:'Hantera filtervyer'})).not.toBeInTheDocument();
    expect(screen.queryByText(/Vy:/)).not.toBeInTheDocument();
  });
});
