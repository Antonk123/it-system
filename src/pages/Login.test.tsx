// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const completeSsoLogin = vi.fn();
const signIn = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ signIn, completeSsoLogin }),
}));
vi.mock('@/lib/api', () => ({
  api: {
    getOidcStatus: vi.fn(),
    oidcLoginUrl: () => 'http://api.test/auth/oidc/login',
    // BrandLogo → useBranding() anropar denna; degraderar precis som den
    // riktiga implementationen gör vid fel — aldrig relevant för dessa tester.
    getBranding: vi.fn().mockResolvedValue({ logoUrl: null }),
  },
}));
const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { api } from '@/lib/api';
import { toast } from 'sonner';
import Login from './Login';

function renderLogin(search = '', state?: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/login', search, state }]}>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function submitLogin() {
  fireEvent.change(screen.getByLabelText('E-post'), { target: { value: 'a@b.se' } });
  fireEvent.change(screen.getByLabelText('Lösenord'), { target: { value: 'hemligt' } });
  fireEvent.click(screen.getByRole('button', { name: /logga in/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getOidcStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: false, label: null });
  signIn.mockResolvedValue({ error: null });
});

// Utan denna läcker varje render() in i nästa test (vitest kör inte
// @testing-library/react:s auto-cleanup eftersom test.globals inte är
// aktiverat i vite.config.ts) — synligt först när flera tester i filen
// delar samma role/name-query (t.ex. "Logga in"-knappen i de nya
// returnTo-testerna nedan, som annars matchar flera kvarlämnade DOM-träd).
afterEach(() => {
  cleanup();
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
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/login?sso=1']}>
            <Login />
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>
    );
    await waitFor(() => expect(completeSsoLogin).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(completeSsoLogin).toHaveBeenCalledTimes(1);
  });
});

describe('returnTo vid lösenordslogin (navigate("/", ...) → bevarad plats)', () => {
  it('state.from finns → navigerar dit (replace)', async () => {
    renderLogin('', { from: '/tickets/42?tab=comments' });
    await submitLogin();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/tickets/42?tab=comments', { replace: true }));
  });

  it('state saknas men ?returnTo= finns → navigerar dit (replace)', async () => {
    renderLogin('?returnTo=%2Fkb%2F9');
    await submitLogin();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/kb/9', { replace: true }));
  });

  it('state.from prioriteras över ?returnTo= när båda finns', async () => {
    renderLogin('?returnTo=%2Fkb%2F9', { from: '/companies/7' });
    await submitLogin();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/companies/7', { replace: true }));
  });

  it('varken state eller ?returnTo= → fallback "/" (replace)', async () => {
    renderLogin();
    await submitLogin();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('skadligt returnTo-värde ("//evil.com") saneras bort → "/"', async () => {
    renderLogin('', { from: '//evil.com' });
    await submitLogin();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('felaktig inloggning navigerar INTE — toast.error visas istället', async () => {
    signIn.mockResolvedValue({ error: 'Fel lösenord' });
    renderLogin('', { from: '/tickets/42' });
    await submitLogin();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Fel lösenord'));
    expect(navigate).not.toHaveBeenCalled();
  });
});
