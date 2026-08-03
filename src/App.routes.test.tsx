// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { act, useState, type ReactNode } from 'react';
import {
  MemoryRouter,
  useParams,
  useLocation,
  useSearchParams,
  useNavigationType,
  useNavigate,
  Link,
} from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Vite-specifik ?raw-import (deklarerad av vite/client.d.ts, se
// src/vite-env.d.ts) — läser App.tsx:s källa som sträng utan node:fs, som
// annars inte typechecker under tsconfig.app.json (inga node-typer där).
import appSource from './App.tsx?raw';

// ---------------------------------------------------------------------------
// Mock-rigg
// ---------------------------------------------------------------------------
// authState + registry måste vara tillgängliga INUTI vi.mock-fabrikerna, som
// hissas ovanför alla imports. vi.hoisted() ger oss den delade, muterbara
// staten på rätt sida av hissningen.
const { authState, registry } = vi.hoisted(() => ({
  authState: { isAuthenticated: false, isLoading: false },
  registry: {} as Record<string, (props: unknown) => unknown>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
  // App.tsx importerar AuthProvider (även om AppRoutes själv inte använder
  // den) — passthrough så modulen inte kraschar vid import.
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// 22 sidmoduler, en vi.mock per modul (App.tsx:12-33). Varje default-export
// slår upp sin stub i `registry` VID ANROPSTILLFÄLLET (inte vid
// hissningstillfället) — registret fylls i längre ned i filen, efter de
// riktiga imports av react/react-router som stubkomponenten behöver.
vi.mock('@/pages/Index', () => ({ default: (p: unknown) => registry.Index(p) }));
vi.mock('@/pages/TicketList', () => ({ default: (p: unknown) => registry.TicketList(p) }));
vi.mock('@/pages/TicketForm', () => ({ default: (p: unknown) => registry.TicketForm(p) }));
vi.mock('@/pages/TicketDetail', () => ({ default: (p: unknown) => registry.TicketDetail(p) }));
vi.mock('@/pages/Archive', () => ({ default: (p: unknown) => registry.Archive(p) }));
vi.mock('@/pages/UserList', () => ({ default: (p: unknown) => registry.UserList(p) }));
vi.mock('@/pages/Settings', () => ({ default: (p: unknown) => registry.Settings(p) }));
vi.mock('@/pages/Reports', () => ({ default: (p: unknown) => registry.Reports(p) }));
vi.mock('@/pages/Login', () => ({ default: (p: unknown) => registry.Login(p) }));
vi.mock('@/pages/ForgotPassword', () => ({ default: (p: unknown) => registry.ForgotPassword(p) }));
vi.mock('@/pages/ResetPassword', () => ({ default: (p: unknown) => registry.ResetPassword(p) }));
vi.mock('@/pages/PublicTicketForm', () => ({ default: (p: unknown) => registry.PublicTicketForm(p) }));
vi.mock('@/pages/SharedTicket', () => ({ default: (p: unknown) => registry.SharedTicket(p) }));
vi.mock('@/pages/NotFound', () => ({ default: (p: unknown) => registry.NotFound(p) }));
vi.mock('@/pages/KnowledgeBase', () => ({ default: (p: unknown) => registry.KnowledgeBase(p) }));
vi.mock('@/pages/KBArticleDetail', () => ({ default: (p: unknown) => registry.KBArticleDetail(p) }));
vi.mock('@/pages/KBArticleForm', () => ({ default: (p: unknown) => registry.KBArticleForm(p) }));
vi.mock('@/pages/SharedKBArticle', () => ({ default: (p: unknown) => registry.SharedKBArticle(p) }));
vi.mock('@/pages/Recurring', () => ({ default: (p: unknown) => registry.Recurring(p) }));
vi.mock('@/pages/CompanyList', () => ({ default: (p: unknown) => registry.CompanyList(p) }));
vi.mock('@/pages/CompanyDetail', () => ({ default: (p: unknown) => registry.CompanyDetail(p) }));
vi.mock('@/pages/Invoices', () => ({ default: (p: unknown) => registry.Invoices(p) }));

// react-router MOCKAS INTE — äkta router i den här filen, annars bevisar
// testerna ingenting om routing.
import { AppRoutes } from '@/App';
import { SW_NAVIGATE_MESSAGE } from '@/lib/swNavigation';

// ---------------------------------------------------------------------------
// Stub-fabrik — populerar `registry` (deklarerad ovan via vi.hoisted).
// Körs vid modul-init, EFTER de riktiga react/react-router-importerna ovan,
// så useParams/useLocation/useSearchParams/Link är riktiga hook-referenser.
// ---------------------------------------------------------------------------
const mountCounts: Record<string, number> = {};

function makeStub(name: string) {
  return function Stub() {
    // Lazy useState-initializer körs EXAKT en gång per komponent-INSTANS
    // (inte vid varje re-render) — det är vad som gör mount-räknaren till ett
    // sant remount-bevis för key={location.pathname}-testet.
    const [mountId] = useState(() => {
      mountCounts[name] = (mountCounts[name] ?? 0) + 1;
      return mountCounts[name];
    });
    const params = useParams();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    return (
      <div
        data-testid={`stub:${name}`}
        data-params={JSON.stringify(params)}
        data-search={location.search}
        data-searchparams={JSON.stringify(Object.fromEntries(searchParams.entries()))}
        data-pathname={location.pathname}
        data-state={JSON.stringify(location.state ?? null)}
        data-mount-id={mountId}
      >
        {name}
        {name === 'TicketList' && (
          <Link to="/kb" data-testid="link-to-kb">
            till KB
          </Link>
        )}
      </div>
    );
  };
}

const STUB_NAMES = [
  'Index', 'TicketList', 'TicketForm', 'TicketDetail', 'Archive', 'UserList', 'Settings',
  'Reports', 'Login', 'ForgotPassword', 'ResetPassword', 'PublicTicketForm', 'SharedTicket',
  'NotFound', 'KnowledgeBase', 'KBArticleDetail', 'KBArticleForm', 'SharedKBArticle',
  'Recurring', 'CompanyList', 'CompanyDetail', 'Invoices',
] as const;

STUB_NAMES.forEach((name) => {
  registry[name] = makeStub(name);
});

// ---------------------------------------------------------------------------
// Render-helpers
// ---------------------------------------------------------------------------
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderRoutes(path: string) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function NavTypeProbe() {
  const navigationType = useNavigationType();
  return <div data-testid="nav-type">{navigationType}</div>;
}

function BackButtonProbe() {
  const navigate = useNavigate();
  return (
    <button data-testid="go-back" onClick={() => navigate(-1)}>
      tillbaka
    </button>
  );
}

function renderWithProbes(initialEntries: string[], initialIndex?: number) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <NavTypeProbe />
        <BackButtonProbe />
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-pathname">{location.pathname}</div>;
}

function renderWithLocationProbe(path: string) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Flushar en väntande makrouppgifts-runda (efter att alla köade
 * mikrouppgifter — inkl. Promise-kedjan från React.lazy()'s dynamiska
 * import — har tömts). Behövs för isLoading-guardens frånvaro-assertioner:
 * körs testfilen ISOLERAT (`-t "isLoading"`) har INGEN tidigare test redan
 * resolvat de lazy-laddade sidmodulerna, så en trasig guard (isLoading-check
 * borttagen) hinner annars inte visa sitt symptom innan den synkrona
 * assertionen körs — Suspense-fallbacken har för övrigt SAMMA klass
 * ".animate-spin" som guardens egen spinner, så en trasig guard kan annars
 * maskera sig som en frisk en. Detta är EN deterministisk flush (inte en
 * flaky sleep-och-hoppas-loop): den väntar in en redan schemalagd
 * Promise-kedja, inte en godtycklig tidsgräns.
 */
async function flushPendingLazyImports() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function createFakeServiceWorker() {
  const listeners = new Map<string, Set<(event: { data: unknown }) => void>>();
  return {
    addEventListener: (type: string, cb: (event: { data: unknown }) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener: (type: string, cb: (event: { data: unknown }) => void) => {
      listeners.get(type)?.delete(cb);
    },
    dispatch: (type: string, data: unknown) => {
      listeners.get(type)?.forEach((cb) => cb({ data }));
    },
  };
}

// ---------------------------------------------------------------------------
// ROUTES — speglar App.tsx:161-185 rad för rad. Testat i sig av
// täckningsvakten (describe-block "täckningsvakt" nedan).
// ---------------------------------------------------------------------------
type Guard = 'protected' | 'public' | 'none';

interface RouteCase {
  path: string;
  concretePath: string;
  stub: string;
  guard: Guard;
}

const ROUTES: RouteCase[] = [
  { path: '/login', concretePath: '/login', stub: 'Login', guard: 'public' },
  { path: '/forgot-password', concretePath: '/forgot-password', stub: 'ForgotPassword', guard: 'public' },
  { path: '/reset-password/:token', concretePath: '/reset-password/reset-tok-7', stub: 'ResetPassword', guard: 'public' },
  { path: '/submit-ticket', concretePath: '/submit-ticket', stub: 'PublicTicketForm', guard: 'none' },
  { path: '/shared/:token', concretePath: '/shared/share-tok-1', stub: 'SharedTicket', guard: 'none' },
  { path: '/kb/shared/:token', concretePath: '/kb/shared/kb-share-tok', stub: 'SharedKBArticle', guard: 'none' },
  { path: '/', concretePath: '/', stub: 'Index', guard: 'protected' },
  { path: '/tickets', concretePath: '/tickets', stub: 'TicketList', guard: 'protected' },
  { path: '/my-tickets', concretePath: '/my-tickets', stub: 'TicketList', guard: 'protected' },
  { path: '/tickets/new', concretePath: '/tickets/new', stub: 'TicketForm', guard: 'protected' },
  { path: '/tickets/:id', concretePath: '/tickets/42', stub: 'TicketDetail', guard: 'protected' },
  { path: '/tickets/:id/edit', concretePath: '/tickets/42/edit', stub: 'TicketForm', guard: 'protected' },
  { path: '/recurring', concretePath: '/recurring', stub: 'Recurring', guard: 'protected' },
  { path: '/companies', concretePath: '/companies', stub: 'CompanyList', guard: 'protected' },
  { path: '/companies/:id', concretePath: '/companies/7', stub: 'CompanyDetail', guard: 'protected' },
  { path: '/invoices', concretePath: '/invoices', stub: 'Invoices', guard: 'protected' },
  { path: '/archive', concretePath: '/archive', stub: 'Archive', guard: 'protected' },
  { path: '/users', concretePath: '/users', stub: 'UserList', guard: 'protected' },
  { path: '/reports', concretePath: '/reports', stub: 'Reports', guard: 'protected' },
  { path: '/settings', concretePath: '/settings', stub: 'Settings', guard: 'protected' },
  { path: '/kb', concretePath: '/kb', stub: 'KnowledgeBase', guard: 'protected' },
  { path: '/kb/new', concretePath: '/kb/new', stub: 'KBArticleForm', guard: 'protected' },
  { path: '/kb/:id', concretePath: '/kb/9', stub: 'KBArticleDetail', guard: 'protected' },
  { path: '/kb/:id/edit', concretePath: '/kb/9/edit', stub: 'KBArticleForm', guard: 'protected' },
  { path: '*', concretePath: '/definitely/not/a/route/at/all', stub: 'NotFound', guard: 'none' },
];

const NON_SPLAT_ROUTES = ROUTES.filter((r) => r.path !== '*');
const PROTECTED_ROUTES = ROUTES.filter((r) => r.guard === 'protected');
const PUBLIC_AUTH_ROUTES = ROUTES.filter((r) => r.guard === 'public');
const OPEN_ROUTES = ROUTES.filter((r) => r.guard === 'none' && r.path !== '*');

beforeEach(() => {
  authState.isAuthenticated = false;
  authState.isLoading = false;
  Object.keys(mountCounts).forEach((k) => delete mountCounts[k]);
  // jsdom saknar en riktig scrollTo-implementation — ScrollToTopOnNavigate
  // anropar den på varje icke-POP-navigering (inkl. guard-redirects), vilket
  // annars spammar konsolen med "Not implemented"-varningar i tester som
  // inte bryr sig om scroll. Testet i describe("scroll vid navigering …")
  // stubbar sin egen spy ovanpå denna.
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. Hela ruttabellen, inloggad
// ---------------------------------------------------------------------------
describe('hela ruttabellen — inloggad', () => {
  it.each(NON_SPLAT_ROUTES.map((r) => [r.concretePath, r] as const))(
    '%s renderar rätt sida (guard-medveten — publika auth-rutter redirectar till /)',
    async (_label, route) => {
      authState.isAuthenticated = true;
      renderRoutes(route.concretePath);
      // Publika auth-rutter (login m.fl.) redirectar till / när man redan är
      // inloggad — "rätt sida" där är alltså Index, inte rutten själv.
      const expectedStub = route.guard === 'public' ? 'Index' : route.stub;
      expect(await screen.findByTestId(`stub:${expectedStub}`)).toBeInTheDocument();
    }
  );
});

// ---------------------------------------------------------------------------
// 2. Skyddade rutter, utloggad
// ---------------------------------------------------------------------------
describe('skyddade rutter — utloggad', () => {
  it.each(PROTECTED_ROUTES.map((r) => [r.concretePath, r] as const))(
    '%s → ingen sida renderas, redirect till /login',
    async (_label, route) => {
      renderRoutes(route.concretePath);
      expect(await screen.findByTestId('stub:Login')).toBeInTheDocument();
      expect(screen.queryByTestId(`stub:${route.stub}`)).toBeNull();
    }
  );
});

// ---------------------------------------------------------------------------
// 3. Publika auth-rutter, inloggad
// ---------------------------------------------------------------------------
describe('publika auth-rutter — inloggad', () => {
  it.each(PUBLIC_AUTH_ROUTES.map((r) => [r.concretePath, r] as const))(
    '%s → redirect till /',
    async (_label, route) => {
      authState.isAuthenticated = true;
      renderRoutes(route.concretePath);
      expect(await screen.findByTestId('stub:Index')).toBeInTheDocument();
      expect(screen.queryByTestId(`stub:${route.stub}`)).toBeNull();
    }
  );
});

// ---------------------------------------------------------------------------
// 3b. Publika auth-rutter, UTLOGGAT — täcker det element som PublicRoute
// släpper igenom när man INTE är inloggad. Utan detta block testas
// /forgot-password aldrig i det läge där dess eget element faktiskt
// renderas (i inloggat läge redirectar PublicRoute bort det, så ett fel
// element där syns aldrig i sviten).
// ---------------------------------------------------------------------------
describe('publika auth-rutter — utloggad (renderar egen sida, ingen redirect)', () => {
  it.each(PUBLIC_AUTH_ROUTES.map((r) => [r.concretePath, r] as const))(
    '%s renderar sin egen sida, inte en redirect',
    async (_label, route) => {
      renderRoutes(route.concretePath);
      expect(await screen.findByTestId(`stub:${route.stub}`)).toBeInTheDocument();
      expect(screen.queryByTestId('stub:Index')).toBeNull();
    }
  );
});

// ---------------------------------------------------------------------------
// 4. Öppna rutter kräver inte auth
// ---------------------------------------------------------------------------
describe('öppna rutter — kräver inte auth', () => {
  it.each(OPEN_ROUTES.map((r) => [r.concretePath, r] as const))(
    '%s renderar sin sida utloggad',
    async (_label, route) => {
      renderRoutes(route.concretePath);
      expect(await screen.findByTestId(`stub:${route.stub}`)).toBeInTheDocument();
    }
  );
});

// ---------------------------------------------------------------------------
// 5. isLoading
// ---------------------------------------------------------------------------
describe('isLoading', () => {
  // Det AVGÖRANDE beviset här är att location.pathname INTE har ändrats —
  // inte frånvaro av stub-markörer och inte ens spinnerns närvaro. Bägge de
  // sistnämnda kan bli sanna av fel skäl: tas isLoading-grinden bort i BARA
  // ProtectedRoute faller utloggat+isLoading igenom till
  // `<Navigate to="/login" replace>`, och PublicRoute:s spinner (samma
  // klass ".animate-spin", inga stub:-markörer) döljer att en redirect
  // skedde. Ett borttaget isLoading-check ÄNDRAR pathname bort från den
  // begärda rutten — det gör inget av de andra symptomen pålitligt.
  // Spinner-assertionen behålls som komplement, men bär INTE beviset själv.
  it.each([
    ['/tickets', false],
    ['/tickets', true],
    ['/login', false],
    ['/login', true],
  ] as const)(
    'ingen redirect (pathname oförändrad) + spinner renderas för %s när isAuthenticated=%s och isLoading=true',
    async (path, isAuthenticated) => {
      authState.isAuthenticated = isAuthenticated;
      authState.isLoading = true;
      const { container } = renderWithLocationProbe(path);
      // Ge en ev. trasig guard en verklig chans att avslöja sig: om
      // isLoading-checken saknas hinner den lazy-laddade sidan (eller en
      // Navigate-redirect) manifestera sig här — annars är detta en no-op
      // eftersom en frisk guard aldrig ens startar den lazy-importen.
      await flushPendingLazyImports();

      expect(screen.getByTestId('location-pathname').textContent).toBe(path);
      expect(container.querySelectorAll('[data-testid^="stub:"]')).toHaveLength(0);
      expect(container.querySelector('.animate-spin')).not.toBeNull();
    }
  );
});

// ---------------------------------------------------------------------------
// 6. replace-semantik
// ---------------------------------------------------------------------------
describe('replace-semantik vid guard-redirect', () => {
  it('navigationType är REPLACE direkt efter redirect till /login', async () => {
    renderWithProbes(['/tickets']);
    await screen.findByTestId('stub:Login');
    expect(screen.getByTestId('nav-type').textContent).toBe('REPLACE');
  });

  it('bakåtnavigering efter redirect landar INTE på den skyddade rutten (ingen redirect-loop)', async () => {
    // /submit-ticket (ingen guard) följt av /tickets (skyddad, utloggad).
    // Med replace ersätts /tickets-posten av /login i historiken, så en
    // bakåtnavigering hoppar direkt till /submit-ticket. Om guarden i stället
    // hade använt push skulle bakåt landa på /tickets igen och OMEDELBART
    // redirecta till /login på nytt — samma synliga resultat (stub:Login).
    // Att vi i stället landar på stub:PublicTicketForm bevisar replace.
    renderWithProbes(['/submit-ticket', '/tickets'], 1);
    await screen.findByTestId('stub:Login');
    fireEvent.click(screen.getByTestId('go-back'));
    expect(await screen.findByTestId('stub:PublicTicketForm')).toBeInTheDocument();
    expect(screen.queryByTestId('stub:TicketList')).toBeNull();
    expect(screen.queryByTestId('stub:Login')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6b. returnTo — guard-redirect bevarar platsen via state.from
// ---------------------------------------------------------------------------
describe('returnTo — ProtectedRoute skickar med state.from vid redirect', () => {
  it('state.from = pathname (ingen query)', async () => {
    renderRoutes('/tickets');
    const login = await screen.findByTestId('stub:Login');
    expect(JSON.parse(login.getAttribute('data-state') ?? 'null')).toEqual({ from: '/tickets' });
  });

  it('state.from = pathname + search (bevarar query)', async () => {
    renderRoutes('/tickets/42?tab=comments');
    const login = await screen.findByTestId('stub:Login');
    expect(JSON.parse(login.getAttribute('data-state') ?? 'null')).toEqual({ from: '/tickets/42?tab=comments' });
  });
});

// ---------------------------------------------------------------------------
// 6c. returnTo — PublicRoute skickar redan inloggade vidare till sanerad plats
// ---------------------------------------------------------------------------
describe('returnTo — PublicRoute respekterar state.from/?returnTo= för redan inloggade', () => {
  it('inloggad + ?returnTo=/tickets/42 på /login → landar på TicketDetail', async () => {
    authState.isAuthenticated = true;
    renderRoutes('/login?returnTo=%2Ftickets%2F42');
    expect(await screen.findByTestId('stub:TicketDetail')).toBeInTheDocument();
  });

  it('inloggad + skadligt ?returnTo=//evil.com på /login → faller tillbaka till /', async () => {
    authState.isAuthenticated = true;
    renderRoutes('/login?returnTo=%2F%2Fevil.com');
    expect(await screen.findByTestId('stub:Index')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 7. Splat
// ---------------------------------------------------------------------------
describe('splat — okänd path', () => {
  it('okänd path (inloggad) → NotFound', async () => {
    authState.isAuthenticated = true;
    renderRoutes('/definitely/not/a/route/at/all');
    expect(await screen.findByTestId('stub:NotFound')).toBeInTheDocument();
  });

  it('djupt nästlad okänd path (utloggad, ingen guard på splat) → NotFound', async () => {
    renderRoutes('/a/b/c/d/e/f/g');
    expect(await screen.findByTestId('stub:NotFound')).toBeInTheDocument();
  });

  it('okänd path med query → NotFound', async () => {
    renderRoutes('/nope?x=1&y=2');
    expect(await screen.findByTestId('stub:NotFound')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 8. Statiska segment slår dynamiska
// ---------------------------------------------------------------------------
describe('statiska segment slår dynamiska (React Router-rankning)', () => {
  it('/tickets/new → TicketForm, inte TicketDetail', async () => {
    authState.isAuthenticated = true;
    renderRoutes('/tickets/new');
    expect(await screen.findByTestId('stub:TicketForm')).toBeInTheDocument();
    expect(screen.queryByTestId('stub:TicketDetail')).toBeNull();
  });

  it('/kb/new → KBArticleForm, inte KBArticleDetail', async () => {
    authState.isAuthenticated = true;
    renderRoutes('/kb/new');
    expect(await screen.findByTestId('stub:KBArticleForm')).toBeInTheDocument();
    expect(screen.queryByTestId('stub:KBArticleDetail')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. useParams
// ---------------------------------------------------------------------------
describe('useParams levereras korrekt', () => {
  const PARAM_CASES: Array<{ path: string; stub: string; expected: Record<string, string>; auth: boolean }> = [
    { path: '/tickets/42', stub: 'TicketDetail', expected: { id: '42' }, auth: true },
    { path: '/tickets/42/edit', stub: 'TicketForm', expected: { id: '42' }, auth: true },
    { path: '/companies/7', stub: 'CompanyDetail', expected: { id: '7' }, auth: true },
    { path: '/kb/9', stub: 'KBArticleDetail', expected: { id: '9' }, auth: true },
    { path: '/kb/9/edit', stub: 'KBArticleForm', expected: { id: '9' }, auth: true },
    { path: '/shared/tok-123', stub: 'SharedTicket', expected: { token: 'tok-123' }, auth: false },
    { path: '/kb/shared/kb-tok-9', stub: 'SharedKBArticle', expected: { token: 'kb-tok-9' }, auth: false },
    { path: '/reset-password/reset-tok-7', stub: 'ResetPassword', expected: { token: 'reset-tok-7' }, auth: false },
    // URL-kodat värde som ska avkodas av react-router:
    { path: '/shared/a%20b', stub: 'SharedTicket', expected: { token: 'a b' }, auth: false },
  ];

  it.each(PARAM_CASES.map((c) => [c.path, c] as const))('%s', async (_label, c) => {
    authState.isAuthenticated = c.auth;
    renderRoutes(c.path);
    const el = await screen.findByTestId(`stub:${c.stub}`);
    expect(JSON.parse(el.getAttribute('data-params') ?? '{}')).toEqual(c.expected);
  });
});

// ---------------------------------------------------------------------------
// 10. useSearchParams
// ---------------------------------------------------------------------------
describe('useSearchParams', () => {
  it('/tickets?status=open&q=disk levererar båda nycklarna', async () => {
    authState.isAuthenticated = true;
    renderRoutes('/tickets?status=open&q=disk');
    const el = await screen.findByTestId('stub:TicketList');
    expect(JSON.parse(el.getAttribute('data-searchparams') ?? '{}')).toEqual({
      status: 'open',
      q: 'disk',
    });
    expect(el.getAttribute('data-search')).toBe('?status=open&q=disk');
  });
});

// ---------------------------------------------------------------------------
// 11. /tickets vs /my-tickets
// ---------------------------------------------------------------------------
describe('/tickets vs /my-tickets', () => {
  it('båda renderar TicketList men sidan kan skilja dem åt via pathname', async () => {
    authState.isAuthenticated = true;
    renderRoutes('/tickets');
    const t1 = await screen.findByTestId('stub:TicketList');
    expect(t1.getAttribute('data-pathname')).toBe('/tickets');
    cleanup();

    renderRoutes('/my-tickets');
    const t2 = await screen.findByTestId('stub:TicketList');
    expect(t2.getAttribute('data-pathname')).toBe('/my-tickets');
  });
});

// ---------------------------------------------------------------------------
// 12. Remount via key={location.pathname}
// ---------------------------------------------------------------------------
describe('remount via key={location.pathname}', () => {
  it('navigering mellan /tickets och /my-tickets (samma komponent) monterar om sidan', async () => {
    authState.isAuthenticated = true;
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <nav>
            <Link to="/tickets" data-testid="nav-tickets">Ärenden</Link>
            <Link to="/my-tickets" data-testid="nav-my-tickets">Mina ärenden</Link>
          </nav>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const first = await screen.findByTestId('stub:TicketList');
    const firstMountId = first.getAttribute('data-mount-id');

    fireEvent.click(screen.getByTestId('nav-my-tickets'));
    const second = await screen.findByTestId('stub:TicketList');
    const secondMountId = second.getAttribute('data-mount-id');
    expect(secondMountId).not.toBe(firstMountId);

    fireEvent.click(screen.getByTestId('nav-tickets'));
    const third = await screen.findByTestId('stub:TicketList');
    expect(third.getAttribute('data-mount-id')).not.toBe(secondMountId);

    // Tre distinkta mount-id:n = tre riktiga mount-cykler, inte tre re-renders
    // av samma instans.
    expect(new Set([firstMountId, secondMountId, third.getAttribute('data-mount-id')]).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 13. Scroll vid navigering
// ---------------------------------------------------------------------------
describe('scroll vid navigering (ScrollToTopOnNavigate)', () => {
  it('POP (init) scrollar inte; PUSH scrollar; efterföljande POP scrollar inte igen', async () => {
    const scrollToSpy = vi.fn();
    vi.stubGlobal('scrollTo', scrollToSpy);
    authState.isAuthenticated = true;

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <BackButtonProbe />
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    );
    await screen.findByTestId('stub:TicketList');
    expect(scrollToSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('link-to-kb'));
    await screen.findByTestId('stub:KnowledgeBase');
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });

    fireEvent.click(screen.getByTestId('go-back'));
    await screen.findByTestId('stub:TicketList');
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 14. <Link> navigerar klientsidigt
// ---------------------------------------------------------------------------
describe('<Link> navigerar klientsidigt', () => {
  it('klick på <Link to="/kb"> landar på stub:KnowledgeBase', async () => {
    authState.isAuthenticated = true;
    renderRoutes('/tickets');
    await screen.findByTestId('stub:TicketList');
    fireEvent.click(screen.getByTestId('link-to-kb'));
    expect(await screen.findByTestId('stub:KnowledgeBase')).toBeInTheDocument();
    expect(screen.queryByTestId('stub:TicketList')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 15. SW-bryggan (SwNavigationBridge)
// ---------------------------------------------------------------------------
describe('SW-bryggan (SwNavigationBridge)', () => {
  it('giltigt sw-navigate-meddelande navigerar appen', async () => {
    const fakeSw = createFakeServiceWorker();
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: fakeSw });
    authState.isAuthenticated = true;
    renderRoutes('/tickets');
    await screen.findByTestId('stub:TicketList');

    act(() => {
      fakeSw.dispatch('message', { type: SW_NAVIGATE_MESSAGE, url: '/kb' });
    });

    expect(await screen.findByTestId('stub:KnowledgeBase')).toBeInTheDocument();
  });

  it('ogiltigt meddelande navigerar INTE', async () => {
    const fakeSw = createFakeServiceWorker();
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: fakeSw });
    authState.isAuthenticated = true;
    renderRoutes('/tickets');
    await screen.findByTestId('stub:TicketList');

    act(() => {
      fakeSw.dispatch('message', { type: 'not-sw-navigate', url: '/kb' });
    });

    expect(screen.queryByTestId('stub:KnowledgeBase')).toBeNull();
    expect(screen.getByTestId('stub:TicketList')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 16. Per-rutt ErrorBoundary (withBoundary, App.tsx:107-111)
// ---------------------------------------------------------------------------
describe('per-rutt ErrorBoundary (withBoundary)', () => {
  it('en krasch i EN sida fångas av dess boundary — appen dör inte, och navigering till en annan rutt fungerar sedan', async () => {
    // Dämpa Reacts (och ErrorBoundary:ns egen componentDidCatch-) förväntade
    // felloggning så just det här testet inte blir brus i testkörningen.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Byt ut EN stub mot en kastande variant direkt i registryt — spara
    // originalet så vi kan återställa det, annars läcker det till andra
    // tester som förlitar sig på en fungerande TicketDetail-stub.
    const originalTicketDetailStub = registry.TicketDetail;
    registry.TicketDetail = () => {
      throw new Error('krasch-stub för ErrorBoundary-testet');
    };

    try {
      authState.isAuthenticated = true;
      render(
        <QueryClientProvider client={makeQueryClient()}>
          <MemoryRouter initialEntries={['/tickets/42']}>
            <nav>
              <Link to="/tickets" data-testid="nav-tickets">Ärenden</Link>
            </nav>
            <AppRoutes />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // ErrorBoundary-fallbacken (src/components/ErrorBoundary.tsx) —
      // rubriken "Något gick fel" är dess route-nivå-fallback (inget
      // fallback-prop skickas in av withBoundary).
      expect(await screen.findByRole('heading', { name: 'Något gick fel' })).toBeInTheDocument();
      expect(screen.queryByTestId('stub:TicketDetail')).toBeNull();

      // Navigering till en annan, icke-kraschande rutt fungerar fortfarande
      // — boundaryn är scoped till DEN ruttens element (och remountas bort
      // helt av key={location.pathname} vid navigering), inte hela appen.
      fireEvent.click(screen.getByTestId('nav-tickets'));
      expect(await screen.findByTestId('stub:TicketList')).toBeInTheDocument();
    } finally {
      registry.TicketDetail = originalTicketDetailStub;
      consoleErrorSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 17. Täckningsvakt
// ---------------------------------------------------------------------------
describe('täckningsvakt — ROUTES-tabellen speglar App.tsx', () => {
  it('path-STRÄNGARNA i App.tsx matchar path-fälten i ROUTES här (inte bara antalet)', () => {
    // Ett rent antals-jämförelse missar en samtidig add+remove (antalet
    // förblir detsamma). Extrahera path-värdena och jämför MÄNGDERNA så
    // felmeddelandet pekar ut exakt vilken path som tillkommit/försvunnit.
    const pathsInApp = Array.from(appSource.matchAll(/<Route\s+path="([^"]+)"/g)).map((m) => m[1]);
    const pathsInRoutes = ROUTES.map((r) => r.path);

    const appSet = new Set(pathsInApp);
    const routesSet = new Set(pathsInRoutes);

    const addedInApp = [...appSet].filter((p) => !routesSet.has(p)).sort();
    const missingFromApp = [...routesSet].filter((p) => !appSet.has(p)).sort();

    expect(
      { addedInApp, missingFromApp },
      'App.tsx:s <Route path="..."> och ROUTES-tabellen i det här testet har olika path-mängder. ' +
        'addedInApp = paths som finns i App.tsx men saknas i ROUTES (ny rutt tillagd — lägg till den i ROUTES). ' +
        'missingFromApp = paths som finns i ROUTES men saknas i App.tsx (rutt borttagen — ta bort motsvarande rad ur ROUTES).'
    ).toEqual({ addedInApp: [], missingFromApp: [] });

    // Bevarar även antals-jämförelsen som ett sanity-larm mot en dubblett
    // (samma path angiven två gånger, vilket mängd-jämförelsen ovan inte
    // ensam skulle fånga).
    const matches = appSource.match(/<Route\s+path=/g) ?? [];
    expect(
      matches.length,
      `Antal <Route path=...> (${matches.length}) matchar inte antal rader i ROUTES (${ROUTES.length}) — trolig dubblett-path i App.tsx.`
    ).toBe(ROUTES.length);
  });
});
