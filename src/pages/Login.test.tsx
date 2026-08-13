// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
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

// navigate() är mockad, men URL-städningen sker via useSearchParams() — alltså
// en ÄKTA navigering inne i MemoryRouter. Sonden är enda sättet att observera
// resultatet av den städningen från testerna.
function LocationProbe() {
  return <div data-testid="location-search">{useLocation().search}</div>;
}

/** Aktuell query-sträng enligt routern (efter ev. städning). */
function currentParams() {
  return new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');
}

function renderLogin(search = '', state?: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/login', search, state }]}>
        <Login />
        <LocationProbe />
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
    (api.getOidcStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: false, label: null });
    renderLogin();
    await waitFor(() => expect(api.getOidcStatus).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /logga in med/i })).toBeNull();
    // Hela SSO-blocket ska bort, inte bara länken — avdelaren skulle annars
    // antyda att det finns ett andra inloggningssätt som saknas.
    expect(screen.queryByText('eller')).toBeNull();
  });
  it('visas med label + länk när SSO är på', async () => {
    (api.getOidcStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: true, label: 'Logga in med Microsoft' });
    renderLogin();
    const link = await screen.findByRole('link', { name: 'Logga in med Microsoft' });
    expect(link).toHaveAttribute('href', 'http://api.test/auth/oidc/login');
  });
  it('whitespace-label → länken faller tillbaka på standardtexten (aldrig utan tillgängligt namn)', async () => {
    // Andra försvarslinjen: getOidcStatus trimmar redan, men slinker en tom
    // sträng ändå igenom blir länken helt namnlös för skärmläsare. ?? fångar
    // varken '' eller '   ' — bara null/undefined.
    (api.getOidcStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: true, label: '   ' });
    renderLogin();
    const link = await screen.findByRole('link', { name: 'Logga in med SSO' });
    expect(link).toHaveAttribute('href', 'http://api.test/auth/oidc/login');
  });
});

describe('Microsoft-märket på SSO-knappen', () => {
  it('renderas till vänster om texten när provider === "microsoft" — dekorativt, exakta varumärkesfärger', async () => {
    (api.getOidcStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      label: 'Logga in med Microsoft',
      provider: 'microsoft',
    });
    renderLogin();
    // Etiketten kommer fortfarande från backend — märket äger inte texten.
    const link = await screen.findByRole('link', { name: 'Logga in med Microsoft' });
    const svg = link.querySelector('svg');
    expect(svg).not.toBeNull();
    // Dekorativ: knappens text bär redan betydelsen, en beskriven grafik
    // skulle annars annonseras meningslöst för skärmläsare.
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    const fills = Array.from(svg!.querySelectorAll('rect')).map((r) => r.getAttribute('fill'));
    expect(fills.sort()).toEqual(['#00A4EF', '#7FBA00', '#F25022', '#FFB900']);
  });

  it('renderas INTE när provider är null', async () => {
    (api.getOidcStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      label: 'Logga in med SSO',
      provider: null,
    });
    renderLogin();
    const link = await screen.findByRole('link', { name: 'Logga in med SSO' });
    expect(link.querySelector('svg')).toBeNull();
  });

  it('renderas INTE för ett okänt providervärde (aldrig gissat ur labeln)', async () => {
    // Labeln är fri operatörstext och kan innehålla "Microsoft" utan att
    // providern faktiskt är det — märket får bara styras av sso.provider.
    (api.getOidcStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      label: 'Logga in med Microsoft',
      provider: 'okta',
    });
    renderLogin();
    const link = await screen.findByRole('link', { name: 'Logga in med Microsoft' });
    expect(link.querySelector('svg')).toBeNull();
  });
});

describe('callback-hantering', () => {
  it('?sso=1 → completeSsoLogin → navigate("/", { replace: true })', async () => {
    completeSsoLogin.mockResolvedValue(true);
    renderLogin('?sso=1');
    await waitFor(() => expect(completeSsoLogin).toHaveBeenCalled());
    // replace: annars leder bakåtknappen tillbaka till /login?sso=1 och den nya
    // mounten kör hela completion-flödet igen mot en förbrukad refresh-token.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
  });
  it('lyckad SSO → ?sso=1 finns inte kvar i URL:en', async () => {
    completeSsoLogin.mockResolvedValue(true);
    renderLogin('?sso=1');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    // Ligger parametern kvar gör en reload av /login?sso=1 ett nytt
    // refresh-försök mot en redan roterad refresh-token.
    await waitFor(() => expect(currentParams().has('sso')).toBe(false));
  });
  it('städningen rör bara sso-parametrarna — övriga query-parametrar lämnas orörda', async () => {
    completeSsoLogin.mockResolvedValue(true);
    renderLogin('?sso=1&returnTo=%2Fkb%2F9');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    await waitFor(() => expect(currentParams().has('sso')).toBe(false));
    expect(currentParams().get('returnTo')).toBe('/kb/9');
  });
  it('completeSsoLogin → false: KVARSTÅENDE role="alert" + toast, och INGEN navigering', async () => {
    completeSsoLogin.mockResolvedValue(false);
    renderLogin('?sso=1');
    // Toasten försvinner efter ~4 s. Utan det kvarstående meddelandet får en
    // skärmläsaranvändare aldrig veta VARFÖR inloggningen uteblev — samma
    // behandling som backend-felet (?sso_error=) redan har.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'SSO-inloggningen misslyckades. Försök igen eller logga in med lösenord.'
      )
    );
    expect(toast.error).toHaveBeenCalledWith(
      'SSO-inloggningen misslyckades. Försök igen eller logga in med lösenord.'
    );
    expect(navigate).not.toHaveBeenCalled();
  });
  it('?sso_error=unknown_user → felmeddelande om saknat konto', async () => {
    renderLogin('?sso_error=unknown_user');
    expect(await screen.findByText(/finns inte i IT-Ticket/i)).toBeInTheDocument();
  });
  it('?sso_error=failed → generiskt felmeddelande', async () => {
    renderLogin('?sso_error=failed');
    expect(await screen.findByText(/SSO-inloggningen misslyckades/i)).toBeInTheDocument();
  });
  it('?sso_error rensas ur URL:en men meddelandet blir kvar på skärmen', async () => {
    renderLogin('?sso_error=unknown_user');
    expect(await screen.findByText(/finns inte i IT-Ticket/i)).toBeInTheDocument();
    // Kvarliggande ?sso_error= väcker ett inaktuellt fel vid varje reload.
    await waitFor(() => expect(currentParams().has('sso_error')).toBe(false));
    expect(screen.getByText(/finns inte i IT-Ticket/i)).toBeInTheDocument();
  });
  it('okänd sso_error-kod → generiskt felmeddelande', async () => {
    renderLogin('?sso_error=nagot_vi_aldrig_sett');
    expect(await screen.findByText(/SSO-inloggningen misslyckades/i)).toBeInTheDocument();
  });
  it('sso_error=constructor (Object.prototype-nyckel) → generiskt felmeddelande, inte en renderad funktion', async () => {
    // Rak uppslagning i SSO_ERROR_MESSAGES hämtar här Object.prototype.constructor
    // — en funktion som ?? inte fångar och som React vägrar rendera.
    renderLogin('?sso_error=constructor');
    expect(await screen.findByRole('alert')).toHaveTextContent(/SSO-inloggningen misslyckades/i);
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
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(completeSsoLogin).toHaveBeenCalledTimes(1);
  });
});

describe('felmeddelandets live-region', () => {
  it('regionen finns i DOM:en redan innan något fel inträffat — tom och utan marginal', async () => {
    renderLogin();
    await waitFor(() => expect(api.getOidcStatus).toHaveBeenCalled());
    const region = screen.getByRole('alert');
    // Monteras regionen in först när felet sätts annonserar skärmläsare den
    // opålitligt — den ska finnas i tillgänglighetsträdet i förväg.
    expect(region).toBeEmptyDOMElement();
    // ...men en tom region får inte lägga till luft i layouten.
    expect(region).not.toHaveClass('mt-4');
  });

  it('SAMMA element fylls när felet uppstår (regionen byts inte ut) och får då marginalen', async () => {
    completeSsoLogin.mockResolvedValue(false);
    renderLogin('?sso=1');
    // Referensen tas FÖRE felet: hade regionen monterats om vid felet skulle
    // den här noden ligga kvar detached och aldrig få text → waitFor timeout.
    const region = screen.getByRole('alert');
    await waitFor(() => expect(region).toHaveTextContent(/SSO-inloggningen misslyckades/i));
    expect(region).toHaveClass('mt-4');
  });
});

/**
 * getOidcStatus() bor i src/lib/api.ts, som resten av den här filen mockar bort.
 * Trimningen där är första försvarslinjen för SSO-länkens tillgängliga namn och
 * hör därför ihop med testerna ovan — vi importerar den ÄKTA modulen via
 * importActual och stubbar fetch i stället för att lita på mocken.
 */
describe('api.getOidcStatus — label-trimning', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function callRealGetOidcStatus(body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) })
    );
    const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
    return actual.api.getOidcStatus();
  }

  it('whitespace-label → null (annars blir SSO-länken utan tillgängligt namn)', async () => {
    await expect(callRealGetOidcStatus({ enabled: true, label: '   ' })).resolves.toEqual({
      enabled: true,
      label: null,
      provider: null,
    });
  });

  it('tom label → null', async () => {
    await expect(callRealGetOidcStatus({ enabled: true, label: '' })).resolves.toEqual({
      enabled: true,
      label: null,
      provider: null,
    });
  });

  it('label med kringliggande blanktecken trimmas', async () => {
    await expect(
      callRealGetOidcStatus({ enabled: true, label: '  Logga in med Microsoft \n' })
    ).resolves.toEqual({ enabled: true, label: 'Logga in med Microsoft', provider: null });
  });

  it('icke-sträng-label → null (oförändrat)', async () => {
    await expect(callRealGetOidcStatus({ enabled: true, label: 42 })).resolves.toEqual({
      enabled: true,
      label: null,
      provider: null,
    });
  });

  it('provider: "microsoft" från backend bevaras', async () => {
    await expect(
      callRealGetOidcStatus({ enabled: true, label: 'Logga in med Microsoft', provider: 'microsoft' })
    ).resolves.toEqual({ enabled: true, label: 'Logga in med Microsoft', provider: 'microsoft' });
  });

  it('okänt providervärde normaliseras till null (rå fetch utan schemavalidering, får inte krascha Login)', async () => {
    await expect(
      callRealGetOidcStatus({ enabled: true, label: 'SSO', provider: 'okta' })
    ).resolves.toEqual({ enabled: true, label: 'SSO', provider: null });
  });

  it('provider saknas i svaret → null', async () => {
    await expect(callRealGetOidcStatus({ enabled: true, label: 'SSO' })).resolves.toEqual({
      enabled: true,
      label: 'SSO',
      provider: null,
    });
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
