// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import Settings from './Settings';
const auth = vi.hoisted(() => ({ role: 'user' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));
vi.mock('@/components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./settings/GeneralTab', () => ({ default: () => <p>Aviseringar</p> }));
vi.mock('./settings/TicketsTab', () => ({ default: () => null }));
vi.mock('./settings/IntegrationsTab', () => ({ default: () => null }));
vi.mock('./settings/AdminTab', () => ({ default: () => null }));
afterEach(cleanup);

describe('Sekundär företagsåtkomst', () => {
  it.each(['user', 'admin'])('behåller företagslänk för rollen %s utan nya rättighetskrav', role => {
    auth.role = role;
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Företag/ })).toHaveAttribute('href', '/companies');
    expect(screen.getByRole('tab', { name: 'E-post' })).toBeTruthy();
    expect(!!screen.queryByRole('tab', { name: 'Administration' })).toBe(role === 'admin');
  });
});
