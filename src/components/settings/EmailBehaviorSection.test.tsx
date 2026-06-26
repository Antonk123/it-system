// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EmailBehaviorSection } from './EmailBehaviorSection';

const mutate = vi.fn();

let settingsValue: {
  twoWayEmailEnabled: boolean;
  isLoading: boolean;
  isError: boolean;
  updateTwoWayEmail: { mutate: typeof mutate; isPending: boolean };
};
let authValue: { user: { id: string; email: string; role: 'admin' | 'user' } | null };

vi.mock('@/hooks/useSettings', () => ({ useSettings: () => settingsValue }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authValue }));

beforeEach(() => {
  mutate.mockReset();
  settingsValue = {
    twoWayEmailEnabled: true,
    isLoading: false,
    isError: false,
    updateTwoWayEmail: { mutate, isPending: false },
  };
  authValue = { user: { id: 'u1', email: 'admin@b.c', role: 'admin' } };
});

afterEach(cleanup);

describe('EmailBehaviorSection', () => {
  it('renders the switch for admins reflecting the current setting (on)', () => {
    render(<EmailBehaviorSection />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('renders nothing for non-admin users', () => {
    authValue = { user: { id: 'u2', email: 'user@b.c', role: 'user' } };
    const { container } = render(<EmailBehaviorSection />);
    expect(container.firstChild).toBeNull();
  });

  it('calls the mutation with the toggled value when clicked', () => {
    render(<EmailBehaviorSection />);
    fireEvent.click(screen.getByRole('switch'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(false);
  });
});
