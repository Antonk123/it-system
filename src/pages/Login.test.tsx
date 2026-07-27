// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const completeSsoLogin = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ signIn: vi.fn(), completeSsoLogin }),
}));
vi.mock('@/lib/api', () => ({
  api: {
    getOidcStatus: vi.fn(),
    oidcLoginUrl: () => 'http://api.test/auth/oidc/login',
  },
}));
const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));

import { api } from '@/lib/api';
import Login from './Login';

function renderLogin(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <Login />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getOidcStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: false, label: null });
});

describe('SSO-knappen', () => {
  it('visas inte när SSO är avstängt', async () => {
    renderLogin();
    await waitFor(() => expect(api.getOidcStatus).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /logga in med/i })).toBeNull();
  });
  it('visas med label + länk när SSO är på', async () => {
    (api.getOidcStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: true, label: 'Logga in med Microsoft' });
    renderLogin();
    const link = await screen.findByRole('link', { name: 'Logga in med Microsoft' });
    expect(link).toHaveAttribute('href', 'http://api.test/auth/oidc/login');
  });
});

describe('callback-hantering', () => {
  it('?sso=1 → completeSsoLogin → navigate("/")', async () => {
    completeSsoLogin.mockResolvedValue(true);
    renderLogin('?sso=1');
    await waitFor(() => expect(completeSsoLogin).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });
  it('?sso_error=unknown_user → felmeddelande om saknat konto', async () => {
    renderLogin('?sso_error=unknown_user');
    expect(await screen.findByText(/finns inte i IT-Ticket/i)).toBeInTheDocument();
  });
  it('?sso_error=failed → generiskt felmeddelande', async () => {
    renderLogin('?sso_error=failed');
    expect(await screen.findByText(/SSO-inloggningen misslyckades/i)).toBeInTheDocument();
  });
  it('?sso=1 → completeSsoLogin anropas bara EN gång trots StrictMode-dubbelkörning av effekten', async () => {
    completeSsoLogin.mockResolvedValue(true);
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/login?sso=1']}>
          <Login />
        </MemoryRouter>
      </StrictMode>
    );
    await waitFor(() => expect(completeSsoLogin).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(completeSsoLogin).toHaveBeenCalledTimes(1);
  });
});
