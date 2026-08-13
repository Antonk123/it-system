// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SystemUser } from '@/lib/api';

const clearSsoLink = vi.fn();
const deleteUser = vi.fn();
const updateRole = vi.fn();
const inviteUser = vi.fn();

let systemUsersValue: {
  users: SystemUser[];
  isLoading: boolean;
  error: string | null;
  inviteUser: typeof inviteUser;
  deleteUser: typeof deleteUser;
  updateRole: typeof updateRole;
  clearSsoLink: typeof clearSsoLink;
  refetch: () => void;
};
let authValue: { user: { id: string; email: string; role: 'admin' | 'user' } | null };

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authValue }));
vi.mock('@/hooks/useSystemUsers', () => ({ useSystemUsers: () => systemUsersValue }));
vi.mock('@/lib/api', () => ({
  api: {
    downloadBackup: vi.fn(),
    uploadFile: vi.fn(),
    request: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Backup-schema och granskningslogg har egen täckning och drar in nätverksanrop
// — stubbas bort så sviten fokuserar på systemanvändar-sektionen.
vi.mock('@/components/settings/BackupScheduleSection', () => ({
  BackupScheduleSection: () => null,
}));
vi.mock('@/components/settings/AuditLogSection', () => ({
  AuditLogSection: () => null,
}));

import AdminTab from './AdminTab';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

// Sektionen är kollapsad vid mount (Collapsible open=false) — öppna den innan
// vi letar efter användarraderna.
const openUsersSection = () => {
  fireEvent.click(screen.getByText('Systemanvändare'));
};

const makeUser = (overrides: Partial<SystemUser> & Pick<SystemUser, 'id' | 'email'>): SystemUser => ({
  displayName: null,
  role: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSignIn: null,
  emailConfirmed: true,
  ssoLinked: false,
  ...overrides,
});

beforeEach(() => {
  clearSsoLink.mockReset();
  clearSsoLink.mockResolvedValue(true);
  deleteUser.mockReset();
  updateRole.mockReset();
  inviteUser.mockReset();
  systemUsersValue = {
    users: [],
    isLoading: false,
    error: null,
    inviteUser,
    deleteUser,
    updateRole,
    clearSsoLink,
    refetch: vi.fn(),
  };
  // Inloggad admin är u-admin — de andra kontona i listan är alltså "andras".
  authValue = { user: { id: 'u-admin', email: 'admin@example.com', role: 'admin' } };
});

afterEach(() => cleanup());

describe('AdminTab — SSO-länkade konton', () => {
  it('visar SSO-badgen bara på konton som är länkade', () => {
    systemUsersValue.users = [
      makeUser({ id: 'u1', email: 'lankad@example.com', displayName: 'Länkad Larsson', ssoLinked: true }),
      makeUser({ id: 'u2', email: 'olankad@example.com', displayName: 'Olänkad Olsson', ssoLinked: false }),
    ];
    render(<AdminTab />, { wrapper });
    openUsersSection();

    // Exakt en badge — inte en per rad.
    expect(screen.getAllByText('SSO-länkad')).toHaveLength(1);
    // ...och bara det länkade kontot får en frånkopplings-knapp.
    expect(screen.getAllByRole('button', { name: /^Koppla loss SSO för/ })).toHaveLength(1);
  });

  it('ger varje "Koppla loss SSO"-knapp ett unikt tillgängligt namn med kontots identitet', () => {
    systemUsersValue.users = [
      makeUser({ id: 'u1', email: 'a@example.com', displayName: 'Anna Andersson', ssoLinked: true }),
      makeUser({ id: 'u2', email: 'b@example.com', displayName: null, ssoLinked: true }),
    ];
    render(<AdminTab />, { wrapper });
    openUsersSection();

    const buttons = screen.getAllByRole('button', { name: /Koppla loss SSO/ });
    expect(buttons).toHaveLength(2);

    const names = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    // Unika namn — annars kan en skärmläsaranvändare inte skilja knapparna åt.
    expect(new Set(names).size).toBe(2);
    // Visningsnamn används när det finns, annars e-postadressen.
    expect(screen.getByRole('button', { name: 'Koppla loss SSO för Anna Andersson' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Koppla loss SSO för b@example.com' })).toBeTruthy();
    // Den synliga texten måste ingå i det tillgängliga namnet (WCAG 2.5.3).
    names.forEach((name) => expect(name).toContain('Koppla loss SSO'));
  });

  it('bekräftelsedialogen anropar clearSsoLink med RÄTT konto-id', async () => {
    systemUsersValue.users = [
      makeUser({ id: 'u1', email: 'a@example.com', displayName: 'Anna Andersson', ssoLinked: true }),
      makeUser({ id: 'u2', email: 'b@example.com', displayName: 'Bertil Bengtsson', ssoLinked: true }),
    ];
    render(<AdminTab />, { wrapper });
    openUsersSection();

    fireEvent.click(screen.getByRole('button', { name: 'Koppla loss SSO för Bertil Bengtsson' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Bertil Bengtsson');

    fireEvent.click(screen.getByRole('button', { name: 'Koppla loss' }));
    await waitFor(() => expect(clearSsoLink).toHaveBeenCalledTimes(1));
    expect(clearSsoLink).toHaveBeenCalledWith('u2');
  });

  it('bekräftelsedialogen beskriver att sessionerna återkallas men att lösenordsinloggning finns kvar', async () => {
    systemUsersValue.users = [
      makeUser({ id: 'u1', email: 'a@example.com', displayName: 'Anna Andersson', ssoLinked: true }),
    ];
    render(<AdminTab />, { wrapper });
    openUsersSection();

    fireEvent.click(screen.getByRole('button', { name: 'Koppla loss SSO för Anna Andersson' }));
    const dialog = await screen.findByRole('alertdialog');
    const text = dialog.textContent ?? '';

    expect(text).toContain('loggas');
    expect(text).toContain('aktiva sessioner');
    expect(text).toContain('Inloggning med lösenord fungerar fortfarande');
    // Den gamla texten var osann efter att clearSsoLink började återkalla
    // refresh-tokens — den får inte komma tillbaka.
    expect(text).not.toContain('Inloggning med lösenord påverkas inte');
  });

  it('lämnar tillbaka fokus till knappen när dialogen avbryts — aldrig till <body>', async () => {
    systemUsersValue.users = [
      makeUser({ id: 'u1', email: 'a@example.com', displayName: 'Anna Andersson', ssoLinked: true }),
    ];
    render(<AdminTab />, { wrapper });
    openUsersSection();

    const trigger = screen.getByRole('button', { name: 'Koppla loss SSO för Anna Andersson' });
    fireEvent.click(trigger);
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('lämnar fokus till listcontainern efter en bekräftad frånkoppling — aldrig till <body>', async () => {
    systemUsersValue.users = [
      makeUser({ id: 'u1', email: 'a@example.com', displayName: 'Anna Andersson', ssoLinked: true }),
    ];
    const { container } = render(<AdminTab />, { wrapper });
    openUsersSection();

    fireEvent.click(screen.getByRole('button', { name: 'Koppla loss SSO för Anna Andersson' }));
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Koppla loss' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // Knappen kan hinna försvinna när listan refetchas — fokus måste ändå landa
    // på ett element, inte på <body>.
    const list = container.querySelector('div.border.rounded-lg.divide-y');
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(list);
    });
  });
});
