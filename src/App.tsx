import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, matchPath, useLocation, useNavigate, useNavigationType } from "react-router";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ApiError } from "@/lib/api";
import { applyFontTheme, getStoredFontTheme, applyMode, getStoredMode } from "@/lib/appearance";
import { safeStorage } from "@/lib/safeStorage";
import { parseSwNavigateMessage } from "@/lib/swNavigation";
import { sanitizeReturnTo } from "@/lib/returnTo";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Layout } from "@/components/Layout";
import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const TicketList = lazy(() => import("./pages/TicketList"));
const TicketForm = lazy(() => import("./pages/TicketForm"));
const TicketDetail = lazy(() => import("./pages/TicketDetail"));
const Archive = lazy(() => import("./pages/Archive"));
const UserList = lazy(() => import("./pages/UserList"));
const Settings = lazy(() => import("./pages/Settings"));
const ArchitectureMap = lazy(() => import("./pages/ArchitectureMap"));
const Reports = lazy(() => import("./pages/Reports"));
const Login = lazy(() => import("./pages/Login"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const PublicTicketForm = lazy(() => import("./pages/PublicTicketForm"));
const SharedTicket = lazy(() => import("./pages/SharedTicket"));
const NotFound = lazy(() => import("./pages/NotFound"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const KBArticleDetail = lazy(() => import("./pages/KBArticleDetail"));
const KBArticleForm = lazy(() => import("./pages/KBArticleForm"));
const SharedKBArticle = lazy(() => import("./pages/SharedKBArticle"));
const PublicKnowledgeBase = lazy(() => import("./pages/PublicKnowledgeBase"));
const PublicKBArticle = lazy(() => import("./pages/PublicKBArticle"));
const CompanyList = lazy(() => import("./pages/CompanyList"));
const CompanyDetail = lazy(() => import("./pages/CompanyDetail"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
      refetchOnWindowFocus: false, // Don't refetch on window focus
      // Försök igen en gång vid nätverks-/serverfel, men aldrig vid klientfel (4xx):
      // ett 404/403/422 ger samma svar nästa gång.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 1,
    },
    mutations: {
      // Aldrig automatiskt: en POST som nådde servern men förlorade svaret skulle
      // annars skapas två gånger (dubbla ärenden/kommentarer).
      retry: 0,
    },
  },
});

const AppearanceInitializer = () => {
  useEffect(() => {
    applyFontTheme(getStoredFontTheme());
    applyMode(getStoredMode());
    // Migrate users who had daylight selected — fall back to default
    const storedTheme = safeStorage.getItem('theme');
    if (storedTheme === 'theme-daylight') {
      safeStorage.setItem('theme', 'theme-default');
      document.documentElement.classList.remove('theme-daylight');
      document.documentElement.classList.add('theme-default');
    }
  }, []);

  return null;
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Bevarar platsen via router-state så Login kan navigera hit tillbaka
    // efter lyckad inloggning (se sanitizeReturnTo för open-redirect-skyddet).
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  // Tvingat lösenordsbyte (t.ex. efter admin-återställning): inget annat i appen
  // är nåbart förrän lösenordet är bytt.
  if (user?.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
};

const PublicRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    // Redan inloggad och landar på en publik auth-rutt (t.ex. /login) —
    // skicka vidare dit ProtectedRoute:s redirect (state.from) eller
    // ?returnTo= pekade, inte alltid till /. Täcker racet där PublicRoute
    // hinner före Logins egen navigate, och fliken-redan-inloggad-fallet.
    const target = sanitizeReturnTo(
      (location.state as { from?: unknown } | null)?.from ?? new URLSearchParams(location.search).get('returnTo')
    );
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
};

const RouteFallback = () => (
  <div className="min-h-dvh flex items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

const PageSpinner = () => (
  <div className="flex min-h-[50dvh] items-center justify-center" role="status">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary motion-reduce:animate-none"></div>
    <span className="sr-only">Laddar…</span>
  </div>
);

/** Omsluter ett route-element med en scoped ErrorBoundary så att en krassch
 *  på en enskild route inte dödar hela navigeringen. */
const withBoundary = (element: ReactNode) => (
  <ErrorBoundary>{element}</ErrorBoundary>
);

const ROUTE_TITLES: ReadonlyArray<readonly [string, string]> = [
  ['/', 'Översikt'],
  ['/login', 'Logga in'],
  ['/forgot-password', 'Glömt lösenord'],
  ['/reset-password/:token', 'Återställ lösenord'],
  ['/change-password', 'Byt lösenord'],
  ['/submit-ticket', 'Skapa ärende'],
  ['/shared/:token', 'Delat ärende'],
  ['/kb/shared/:token', 'Delad artikel'],
  ['/kb/public/:token', 'Kunskapsbas'],
  ['/kb/public/:token/article/:articleId', 'Artikel'],
  ['/tickets', 'Ärenden'],
  ['/my-tickets', 'Mina ärenden'],
  ['/tickets/new', 'Nytt ärende'],
  ['/tickets/:id', 'Ärende'],
  ['/tickets/:id/edit', 'Redigera ärende'],
  ['/companies', 'Företag'],
  ['/companies/:id', 'Företag'],
  ['/archive', 'Arkiv'],
  ['/users', 'Kontakter'],
  ['/reports', 'Rapporter'],
  ['/architecture-map', 'Arkitekturkarta'],
  ['/settings', 'Inställningar'],
  ['/kb', 'Kunskapsbas'],
  ['/kb/new', 'Ny artikel'],
  ['/kb/:id', 'Artikel'],
  ['/kb/:id/edit', 'Redigera artikel'],
];

/** Sätter fliktiteln per route så att flikar, historik och skärmläsare kan skilja sidorna åt. */
const DocumentTitle = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const match = ROUTE_TITLES.find(([path]) => matchPath({ path, end: true }, pathname));
    document.title = `${match ? match[1] : 'Sidan hittades inte'} – IT-Ticket`;
  }, [pathname]);
  return null;
};

/**
 * App-skalet (sidofält, header, bottenfält) som layout-route: det monteras en
 * gång och överlever navigering mellan sidor. Bara sidinnehållet remountas per
 * pathname (key på boundaryn), så sidornas lokala state nollställs som förut.
 */
const AppShell = () => {
  const { pathname } = useLocation();
  const previousPathname = useRef(pathname);

  // Flytta fokus till innehållet vid sidbyte så tangentbords- och skärmläsar-
  // användare inte blir kvar i sidofältet. Inte vid första laddningen.
  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <Layout>
      <Suspense fallback={<PageSpinner />}>
        <ErrorBoundary key={pathname} inShell>
          <Outlet />
        </ErrorBoundary>
      </Suspense>
    </Layout>
  );
};

/** Scrollar till toppen vid framåtnavigering (PUSH/REPLACE).
 *  Vid back/forward (POP) låter vi browsern hantera scroll-position. */
const ScrollToTopOnNavigate = () => {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType !== 'POP') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [pathname, navigationType]);
  return null;
};

/**
 * Bridges service-worker notification clicks to in-app routing. The SW focuses
 * the existing window and posts an `sw-navigate` message (see swNavigation.ts);
 * here we route via React Router. This replaces WindowClient.navigate(), which
 * is unreliable in iOS standalone PWAs and caused clicks to land on the last
 * route (the ticket list) instead of the specific ticket.
 */
const SwNavigationBridge = () => {
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      const url = parseSwNavigateMessage(event.data);
      if (url) navigate(url);
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [navigate]);
  return null;
};

export const AppRoutes = () => {
  return (
    <ErrorBoundary>
    <Suspense fallback={<RouteFallback />}>
      <ScrollToTopOnNavigate />
      <DocumentTitle />
      <SwNavigationBridge />
      {/* Ingen route-nivå AnimatePresence: route-elementen definierar inga exit-
          varianter, så den animerade inget. Sidornas egna enter-animationer
          (motion.div initial/animate) fungerar via key={pathname}-remount i AppShell, och
          in-page-exit (TicketList/KnowledgeBase) har lokala AnimatePresence.
          Att slippa den statiska framer-importen lyfter motion-vendor ur den
          eager-preloadade startgrafen (laddas lazy med sidorna som behöver den). */}
      <Routes>
          <Route path="/login" element={withBoundary(<PublicRoute><Login /></PublicRoute>)} />
          <Route path="/forgot-password" element={withBoundary(<PublicRoute><ForgotPassword /></PublicRoute>)} />
          <Route path="/reset-password/:token" element={withBoundary(<PublicRoute><ResetPassword /></PublicRoute>)} />
          <Route path="/submit-ticket" element={withBoundary(<PublicTicketForm />)} />
          <Route path="/shared/:token" element={withBoundary(<SharedTicket />)} />
          <Route path="/kb/shared/:token" element={withBoundary(<SharedKBArticle />)} />
          <Route path="/kb/public/:token" element={withBoundary(<PublicKnowledgeBase />)} />
          <Route path="/kb/public/:token/article/:articleId" element={withBoundary(<PublicKBArticle />)} />
          <Route path="/change-password" element={withBoundary(<ProtectedRoute><ChangePassword /></ProtectedRoute>)} />
          <Route path="/architecture-map" element={withBoundary(<ProtectedRoute><ArchitectureMap /></ProtectedRoute>)} />
          <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tickets" element={<TicketList />} />
            <Route path="/my-tickets" element={<TicketList />} />
            <Route path="/tickets/new" element={<TicketForm />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/tickets/:id/edit" element={<TicketForm />} />
            <Route path="/companies" element={<CompanyList />} />
            <Route path="/companies/:id" element={<CompanyDetail />} />
            <Route path="/archive" element={<Archive />} />
            <Route path="/users" element={<UserList />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/kb" element={<KnowledgeBase />} />
            <Route path="/kb/new" element={<KBArticleForm />} />
            <Route path="/kb/:id" element={<KBArticleDetail />} />
            <Route path="/kb/:id/edit" element={<KBArticleForm />} />
          </Route>
          <Route path="*" element={withBoundary(<NotFound />)} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
};

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        // Förvalt tema är Forge (inte theme-default/Slate); de sju valbara temana
        // listas i `themes` nedan och i Inställningar → Allmänt.
        defaultTheme="theme-forge"
        enableSystem={false}
        themes={["theme-default", "theme-midnight", "theme-graphite", "theme-stone", "theme-linear", "theme-spotify", "theme-forge"]}
      >
        <AppearanceInitializer />
        <TooltipProvider>
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
