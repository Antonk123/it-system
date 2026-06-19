// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { KPICard } from './KPICard';

beforeAll(() => {
  // jsdom saknar matchMedia (AnimatedNumber läser prefers-reduced-motion).
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(cleanup);

describe('KPICard', () => {
  it('renderar etiketten', () => {
    render(<KPICard label="Öppna ärenden" value={42} icon={<span>i</span>} />);
    expect(screen.getByText('Öppna ärenden')).toBeTruthy();
  });

  it('är tangentbordsnåbar när klickbar (role=button, tabIndex, Enter/Space/klick)', () => {
    const onClick = vi.fn();
    render(<KPICard label="Klicka" value={1} icon={<span>i</span>} onClick={onClick} />);
    const card = screen.getByRole('button');
    expect(card.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('är inte en knapp när onClick saknas', () => {
    render(<KPICard label="Statisk" value={1} icon={<span>i</span>} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
